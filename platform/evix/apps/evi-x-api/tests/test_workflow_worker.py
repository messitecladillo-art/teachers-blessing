"""Real PostgreSQL claim/restart tests; fixed Node and synthetic providers only."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import timedelta
import json
import os
from pathlib import Path
from queue import Queue
import subprocess
import sys
from threading import Event, Thread
import time
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from evix_api.models import now
from evix_api.settings import Settings
from evix_api.workflow_models import WorkflowRun, WorkflowNodeRun, WorkflowOutbox, WorkflowEvent, WorkflowCall
from evix_api.workflow_runner import NodeClaim, WorkflowRuntime
from evix_api.workflow_worker import PostgresConsumer
from .test_postgres import project
from .test_silicon import service_input
from .test_workflows import enable, n, e, graph, save, start, current, dataset


def first_release(settings):
    enable(settings)
    settings.workflow_execution_profile = "first_release"
    return settings


def expire(worker, claim):
    with worker.session(claim.user_id) as session:
        row = session.get(WorkflowNodeRun, claim.node_run_id)
        row.lease_until = now() - timedelta(seconds=1)
        session.commit()


def child_environment(settings, engine):
    with engine.connect() as connection:
        schema = connection.scalar(text("SELECT current_schema()"))
    values = settings.model_dump(mode="json")
    values["database_url"] = engine.url.update_query_dict({"options": "-csearch_path=" + schema + ",public"}).render_as_string(hide_password=False)
    env = {key: value for key, value in os.environ.items() if key.upper() in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC")}
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    for key, value in values.items():
        env["EVIX_" + key.upper()] = json.dumps(value, ensure_ascii=False) if isinstance(value, (list, dict, bool)) else str(value)
    return env


def killed_process(settings, engine, script, *, external=False):
    """Terminate an actual independent Python process after its durable marker."""
    process = subprocess.Popen([sys.executable, "-c", script], env=child_environment(settings, engine),
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    lines = Queue()
    def read():
        for line in process.stdout: lines.put(line.rstrip())
    reader = Thread(target=read, daemon=True); reader.start()
    try:
        line = lines.get(timeout=15)
        claim = NodeClaim(**json.loads(line))
        if external: assert lines.get(timeout=15) == "external_dispatched"
        process.kill()
        process.wait(timeout=10)
        assert process.returncode != 0
        return claim
    finally:
        if process.poll() is None: process.kill(); process.wait(timeout=10)
        reader.join(timeout=1)
        process.stdout.close(); process.stderr.close()


@pytest.mark.postgres
def test_first_release_has_no_broker_and_defers_execution_without_losing_drafts(harness, settings):
    _, login, _, _ = harness; first_release(settings)
    # Validate via Settings, rather than relying only on post-construction edits.
    rebuilt = Settings.model_validate(settings.model_dump())
    assert rebuilt.workflow_broker_url == "" and rebuilt.workflow_execution_profile == "first_release"
    client, _ = login(); p, _ = project(client); pid = p["id"]
    directory = client.get(f"/api/projects/{pid}/workflow/catalog").json()
    assert not {"collect", "condition", "survey_wait"} & {node["kind"] for node in directory["nodes"]}
    assert directory["edgeKinds"] == ["data", "reference"]
    value = graph([n("q", "question", text="保存研究问题"), n("next", "question", text="下一步"), n("later", "survey_wait")],
                  [e("q", "", "next", "", "control")])
    version = save(client, pid, value)
    assert client.get(f"/api/projects/{pid}/workflow").json()["definition"] == value
    checked = client.post(f"/api/projects/{pid}/workflow/validate", json={"definition": value}).json()
    assert {issue["nodeId"] for issue in checked["issues"] if issue["code"] == "capability_deferred" and "nodeId" in issue} == {"later"}
    assert any(issue["code"] == "capability_deferred" and "edgeId" in issue for issue in checked["issues"])
    result = client.post(f"/api/projects/{pid}/workflow/runs", json={"workflowVersionId": version["id"], "idempotencyKey": str(uuid4()), "mode": "all"})
    assert result.status_code == 422
    assert client.get(f"/api/projects/{pid}/workflow/runs").json()["runs"] == []


@pytest.mark.postgres
def test_concurrent_claims_are_unique_and_global_compute_model_limits_hold(harness, pg_engine, settings):
    _, login, _, provider = harness; first_release(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    service = client.post("/api/services", json=service_input()).json()
    version = save(client, pid, graph([n("q", "question", text="研究问题"), n("m", "model", prompt="解释安全材料")]))
    for _ in range(6): start(client, pid, version["id"], consent=True, serviceBindings={"m": {"serviceId": service["id"], "serviceRevision": 1}})
    workers = [WorkflowRuntime(settings, pg_engine, provider) for _ in range(8)]
    def claim_one(i):
        return workers[i % 8].claim_next("compute" if i % 2 == 0 else "model")
    with ThreadPoolExecutor(max_workers=8) as pool:
        claims = [claim for claim in pool.map(claim_one, range(16)) if claim]
    for lane in ("compute", "model"):
        while claim := workers[0].claim_next(lane): claims.append(claim)
    assert len({claim.node_run_id for claim in claims}) == len(claims) == 6
    assert sum(claim.lane == "compute" for claim in claims) == 4
    assert sum(claim.lane == "model" for claim in claims) == 2
    assert workers[0].claim_next("compute") is workers[0].claim_next("model") is None
    with workers[0].session(who["user"]["id"]) as session:
        assert sum(node.status == "claimed" for node in session.scalars(select(WorkflowNodeRun))) == 6
        assert sum(item.sent_at is not None for item in session.scalars(select(WorkflowOutbox))) == 6


@pytest.mark.postgres
def test_skip_locked_outbox_does_not_stall_other_runs(harness, pg_engine, settings):
    _, login, _, provider = harness; first_release(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    version = save(client, pid, graph([n("q", "question", text="独立任务")]))
    a, b = start(client, pid, version["id"]), start(client, pid, version["id"])
    worker = WorkflowRuntime(settings, pg_engine, provider)
    with worker.session(who["user"]["id"]) as locked:
        item = locked.scalar(select(WorkflowOutbox).where(WorkflowOutbox.run_id == a["id"]).with_for_update())
        claim = worker.claim_next("compute")
        assert claim is not None and claim.outbox_id != item.id
        worker.execute_claim(claim)
        assert current(client, pid, b["id"])["status"] == "succeeded"
        assert item.sent_at is None
    other = worker.claim_next("compute"); assert other is not None
    worker.execute_claim(other)
    assert current(client, pid, a["id"])["status"] == "succeeded"


@pytest.mark.postgres
def test_consumer_recovery_skips_locked_run_and_executes_independent_ready_work(harness, pg_engine, settings):
    _, login, _, provider = harness; first_release(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    version = save(client, pid, graph([n("q", "question", text="互不阻塞的任务")]))
    a, b = start(client, pid, version["id"]), start(client, pid, version["id"])
    worker = WorkflowRuntime(settings, pg_engine, provider)
    consumer = PostgresConsumer(worker)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with worker.session(who["user"]["id"]) as locked:
                locked.scalar(select(WorkflowRun).where(WorkflowRun.id == a["id"]).with_for_update())
                # Exercise the production tick, including its recovery sweep,
                # rather than only testing the lower-level outbox claim.
                future = pool.submit(consumer.tick)
                assert future.result(timeout=3) >= 1
                deadline = time.monotonic() + 5
                while current(client, pid, b["id"])["status"] != "succeeded" and time.monotonic() < deadline:
                    time.sleep(0.025)
                assert current(client, pid, b["id"])["status"] == "succeeded"
                assert current(client, pid, a["id"])["status"] == "queued"
        consumer.run_until_idle()
    finally: consumer.close()
    assert current(client, pid, a["id"])["status"] == "succeeded"


@pytest.mark.postgres
def test_locked_run_backlog_is_excluded_before_candidate_limit(harness, pg_engine, settings):
    _, login, _, provider = harness; first_release(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    version = save(client, pid, graph([n("q" + str(i), "question", text="队首研究任务") for i in range(4)]))
    blocked = [start(client, pid, version["id"])["id"] for _ in range(8)]
    newer = save(client, pid, graph([n("new", "question", text="可运行的新任务")]), revision=1)
    ready = start(client, pid, newer["id"])
    worker = WorkflowRuntime(settings, pg_engine, provider)
    with worker.session(who["user"]["id"]) as locked:
        locked.scalars(select(WorkflowRun).where(WorkflowRun.id.in_(blocked)).with_for_update()).all()
        # Thirty-two older due rows belong to locked runs. They must not fill
        # the candidate limit and starve this later, independently ready run.
        claim = worker.claim_next("compute")
        assert claim is not None
        with worker.session(who["user"]["id"]) as session:
            assert session.get(WorkflowNodeRun, claim.node_run_id).run_id == ready["id"]
        worker.execute_claim(claim)
        assert current(client, pid, ready["id"])["status"] == "succeeded"


@pytest.mark.postgres
def test_killed_between_claim_and_execute_recovers_new_attempt_and_fences_old_claim(harness, pg_engine, settings):
    _, login, _, provider = harness; first_release(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]
    version = save(client, pid, graph([n("q", "question", text="重启可恢复")]))
    run = start(client, pid, version["id"]); worker = WorkflowRuntime(settings, pg_engine, provider)
    script = "from dataclasses import asdict\nimport json,time\nfrom evix_api.workflow_worker import runtime\nc=runtime().claim_next('compute')\nprint(json.dumps(asdict(c)),flush=True)\ntime.sleep(120)\n"
    old = killed_process(settings, pg_engine, script)
    assert current(client, pid, run["id"])["nodes"][0]["status"] == "queued"
    expire(worker, old); assert worker.renew_claim(old) is False
    worker.recover(); newer = worker.claim_next("compute")
    assert newer.attempt == old.attempt + 1 and newer.lease_token != old.lease_token
    worker.execute_claim(old)
    with worker.session(old.user_id) as session: assert session.get(WorkflowNodeRun, old.node_run_id).status == "claimed"
    worker.execute_claim(newer)
    assert current(client, pid, run["id"])["status"] == "succeeded"


@pytest.mark.postgres
def test_duplicate_claim_delivery_runs_kernel_once_and_completes_once(harness, pg_engine, settings):
    _, login, _, provider = harness; first_release(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    version = save(client, pid, graph([n("q", "question", text="重复领取回执")]))
    run = start(client, pid, version["id"]); worker = WorkflowRuntime(settings, pg_engine, provider)
    claim = worker.claim_next("compute"); original, calls = worker.perform, []
    def counted(*args):
        calls.append(1); time.sleep(0.15); return original(*args)
    worker.perform = counted
    with ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(worker.execute_claim, [claim, claim]))
    assert len(calls) == 1 and current(client, pid, run["id"])["status"] == "succeeded"
    with worker.session(who["user"]["id"]) as session:
        events = session.scalars(select(WorkflowEvent).where(WorkflowEvent.run_id == run["id"])).all()
        assert sum(event.type == "node_running" for event in events) == sum(event.type == "node_succeeded" for event in events) == 1


@pytest.mark.postgres
def test_long_healthy_task_renews_lease_without_recovery_or_transaction_across_io(harness, pg_engine, settings):
    _, login, _, provider = harness; first_release(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    version = save(client, pid, graph([n("q", "question", text="持续计算")]))
    run = start(client, pid, version["id"])
    # Compress the clock only in this synthetic fault test. Settings validation
    # separately requires real deployments to use a 60–900 second lease.
    settings.workflow_lease_seconds = 2
    worker = WorkflowRuntime(settings, pg_engine, provider)
    original, calls, started = worker.perform, [], Event()
    def slow(*args):
        calls.append(1); started.set(); time.sleep(4.5); return original(*args)
    worker.perform = slow
    consumer = PostgresConsumer(worker, recovery_seconds=0.05)
    try:
        consumer.tick(); assert started.wait(5)
        # This write takes the same project/run domain locks and succeeds while
        # perform() waits, proving its database transaction has been released.
        assert client.put(f"/api/projects/{pid}/workflow/layout", json={"expectedLayoutRevision": 0, "idempotencyKey": str(uuid4()), "layout": {"positions": {"q": {"x": 10, "y": 20}}, "groups": []}}).status_code == 200
        consumer.run_until_idle(timeout=10)
    finally: consumer.close()
    final = current(client, pid, run["id"])
    assert final["status"] == "succeeded" and final["nodes"][0]["attempt"] == 1 and len(calls) == 1
    with worker.session(who["user"]["id"]) as session:
        assert not any(event.type == "node_recovered" for event in session.scalars(select(WorkflowEvent)))


@pytest.mark.postgres
def test_killed_after_external_dispatch_seals_unknown_without_provider_replay(harness, pg_engine, settings):
    _, login, _, provider = harness; first_release(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]
    service = client.post("/api/services", json=service_input()).json()
    version = save(client, pid, graph([n("m", "model", prompt="解释安全汇总")]))
    run = start(client, pid, version["id"], consent=True, serviceBindings={"m": {"serviceId": service["id"], "serviceRevision": 1}})
    script = "from dataclasses import asdict\nimport json,asyncio\nfrom evix_api.workflow_worker import runtime\nw=runtime()\nasync def blocked(*args):\n print('external_dispatched',flush=True)\n await asyncio.sleep(120)\nw.provider.answer=blocked\nc=w.claim_next('model')\nprint(json.dumps(asdict(c)),flush=True)\nw.execute_claim(c)\n"
    claim = killed_process(settings, pg_engine, script, external=True)
    worker = WorkflowRuntime(settings, pg_engine, provider)
    expire(worker, claim); worker.recover()
    consumer = PostgresConsumer(worker)
    try: consumer.run_until_idle()
    finally: consumer.close()
    final = current(client, pid, run["id"])
    assert final["status"] == "outcome_unknown" and final["unknownCount"] == 1 and provider.calls == 0
    with worker.session(claim.user_id) as session:
        rows = session.scalars(select(WorkflowCall)).all()
        assert len(rows) == 1 and rows[0].status == "outcome_unknown"


@pytest.mark.postgres
def test_standalone_worker_without_broker_runs_fixed_node_and_keeps_statistics_receipts(harness, pg_engine, settings):
    _, login, _, provider = harness; first_release(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]
    data = dataset(client, pid)
    version = save(client, pid, graph([n("d", "dataset", datasetVersionId=data["id"]), n("f", "frequency", x=0), n("n", "numeric", x=1)],
        [e("d", "dataset", "f", "dataset"), e("d", "dataset", "n", "dataset")]))
    run = start(client, pid, version["id"])
    result = subprocess.run([sys.executable, "-m", "evix_api.workflow_worker", "consume", "--once"], env=child_environment(settings, pg_engine),
                            stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert result.returncode == 0, result.stderr[:500]
    assert json.loads(result.stdout.strip())["transport"] == "postgres"
    # A second fresh process handles descendants scheduled by the first receipt.
    result = subprocess.run([sys.executable, "-m", "evix_api.workflow_worker", "consume", "--once"], env=child_environment(settings, pg_engine),
                            stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert result.returncode == 0, result.stderr[:500]
    final = current(client, pid, run["id"])
    assert final["status"] == "succeeded" and provider.calls == 0
    results = {node["nodeId"]: node["result"]["output"] for node in final["nodes"]}
    assert results["f"]["summary"]["n"] == results["n"]["summary"]["n"] == 3
