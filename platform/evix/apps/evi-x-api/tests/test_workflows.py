"""Actual PostgreSQL + fixed Node kernel integration; no SQLite or model charges."""
import asyncio
import copy
import hashlib
import json
from datetime import timedelta
from pathlib import Path
import shutil
import subprocess
from uuid import uuid4

import pytest
from sqlalchemy import select, text, update

from evix_api.contracts import ApiError, canonical, fingerprint
from evix_api.models import now, User, Member, SiliconRun
from evix_api.provider import ProviderFailure
from evix_api.workflow_models import WorkflowRun, WorkflowNodeRun, WorkflowCall, WorkflowVersion, DatasetVersion, WorkflowEvent, WorkflowOutbox, WorkflowFile, ReportProvenance
from evix_api.workflows import catalog, definition, parse_csv, validate_graph, redact, aggregate_status, executor_fingerprint
from evix_api.workflow_runner import WorkflowRuntime, forbid_raw_model_input
from .test_postgres import project
from .test_reports import content
from .test_silicon import service_input, entered, payload as silicon_payload, wait as silicon_wait
from .test_surveys import design as survey_design
from .test_surveys_postgres import anon_client

ROOT = Path(__file__).resolve().parents[3]


def n(nid, kind, **config):
    return {"id": nid, "kind": kind, "title": kind, "config": config}


def e(source, sport, target, tport, kind="data"):
    return {"id": f"{source}-{sport}-{target}-{tport}", "source": source, "sourcePort": sport, "target": target, "targetPort": tport, "kind": kind}


def graph(nodes, edges=()):
    return {"schemaVersion": "research-workflow/v1", "nodes": nodes, "edges": list(edges)}


def enable(settings):
    settings.workflow_enabled = True
    settings.workflow_execution_profile = "extended"
    settings.workflow_node_executable = shutil.which("node")
    settings.workflow_executor_path = str(ROOT / "apps/evi-x-platform/scripts/workflow-executor.mjs")
    return settings


def save(client, pid, value, revision=0):
    result = client.post(f"/api/projects/{pid}/workflow/versions", json={"idempotencyKey": str(uuid4()), "expectedRevision": revision, "definition": value})
    assert result.status_code == 201, result.text
    return result.json()


def start(client, pid, vid, **extra):
    result = client.post(f"/api/projects/{pid}/workflow/runs", json={"workflowVersionId": vid, "idempotencyKey": str(uuid4()), "mode": "all", **extra})
    assert result.status_code == 202, result.text
    return result.json()


def dataset(client, pid, value="group,score\nA,1\nA,2\nB,4\n", **extra):
    result = client.post(f"/api/projects/{pid}/datasets/versions", json={"idempotencyKey": str(uuid4()), "sourceName": "合成验收.csv", "classification": "simulated", "csv": value, **extra})
    assert result.status_code == 201, result.text
    return result.json()


def current(client, pid, rid):
    return client.get(f"/api/projects/{pid}/workflow/runs/{rid}").json()


def decide(client, pid, view, nid, action="approve", **values):
    node = next(n for n in view["nodes"] if n["nodeId"] == nid)
    result = client.post(f"/api/projects/{pid}/workflow/runs/{view['id']}/decisions", json={"idempotencyKey": str(uuid4()), "nodeId": nid,
        "expectedAttempt": node["attempt"], "inputHash": node["inputHash"], "action": action, "values": values})
    assert result.status_code == 200, result.text
    return result.json()


@pytest.mark.parametrize("value,delimiter", [('A,B\n,\nx,y', ','), ('A;B\n"";" "\nx;y', ';'), ('\ufeffA\tB\r\n\r\n"x\ny"\t""\r\n', '\t'), ('A,B\n"a""b",c\n\n', ',')])
def test_csv_parity_keeps_empty_records(value, delimiter):
    script = "import {parseSurveyCsv} from './lib/survey-analysis.ts';process.stdout.write(JSON.stringify(parseSurveyCsv(JSON.parse(process.argv[1]),process.argv[2])));"
    result = subprocess.run([shutil.which("node"), "--experimental-strip-types", "--input-type=module", "-e", script, json.dumps(value), delimiter],
                            cwd=ROOT / "apps/evi-x-platform", capture_output=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW)
    assert result.returncode == 0, result.stderr
    assert parse_csv(value, delimiter) == json.loads(result.stdout)


def test_graph_drafts_cycles_required_ports_types_and_sensitive_data():
    kinds = catalog()[1]
    value = graph([n("q", "question", text="研究问题"), n("model", "model", prompt="解释")], [e("q", "text", "model", "text")])
    assert validate_graph(value, kinds)["valid"]
    invalid = graph([n("a", "numeric", x=1), n("b", "numeric", x=1)], [e("a", "result", "b", "dataset"), e("b", "result", "a", "dataset")])
    assert definition(invalid, kinds) == invalid  # Draft may contain a cycle.
    errors = validate_graph(invalid, kinds)["issues"]
    assert {i["code"] for i in errors} == {"cycle", "port_type"}
    review = graph([n("q", "question", text="问题"), n("r", "review")], [e("q", "text", "r", "value")])
    assert validate_graph(review, kinds)["valid"]  # Declared accepted types.
    with pytest.raises(ApiError): definition(graph([n("q", "question", apiKey="secret")]), kinds)
    with pytest.raises(ApiError): definition(graph([n("q", "question", rows=[["private"]])]), kinds)
    assert aggregate_status(["succeeded", "outcome_unknown", "running"]) == "outcome_unknown"
    assert aggregate_status(["succeeded", "failed"]) == "partial"
    assert aggregate_status(["succeeded", "waiting_input"]) == "waiting"
    assert aggregate_status(["succeeded", "skipped"]) == "succeeded"


def test_raw_model_boundary_and_public_results_keep_aggregate_rows():
    aggregate = {"kind": "result", "data": {"rows": [["A", 2, 66.67]], "headers": ["类别", "人数", "%"]}}
    forbid_raw_model_input(aggregate)
    assert redact(aggregate) == aggregate
    private = {"kind": "dataset", "table": {"rows": [["private"]]}, "csv": "private", "datasetRef": {"id": "ref"}}
    assert "private" not in canonical(redact(private))
    for value in [private, {"data": {"pairs": [[1, 2]]}}, {"x": {"rows": [["raw"]]}}]:
        with pytest.raises(ApiError): forbid_raw_model_input(value)


@pytest.mark.postgres
def test_workflow_cas_retry_layout_independence_and_rls(harness, pg_engine):
    _, login, _, _ = harness
    client, who = login(); outsider, _ = login("b@example.test")
    p, team = project(client); pid = p["id"]; base = f"/api/projects/{pid}/workflow"
    empty = client.get(base).json()
    assert empty["revision"] == 0 and empty["layoutRevision"] == 0
    value = graph([n("q", "question", text="研究问题😀")])
    body = {"expectedRevision": 0, "definition": value, "idempotencyKey": str(uuid4())}
    saved = client.post(base + "/versions", json=body)
    assert saved.status_code == 201, saved.text
    assert client.post(base + "/versions", json=body).json() == saved.json()
    assert client.post(base + "/versions", json={**body, "idempotencyKey": str(uuid4())}).status_code == 409
    pos = {"positions": {"q": {"x": 22, "y": -14}}, "groups": []}
    assert client.put(base + "/layout", json={"layout": pos, "expectedLayoutRevision": 0, "idempotencyKey": str(uuid4())}).status_code == 200
    assert client.get(base).json()["revision"] == 1
    assert outsider.get(base).status_code == 404
    with pg_engine.connect() as conn: assert conn.execute(select(WorkflowVersion)).all() == []
    d = dataset(client, pid)
    assert outsider.get(f"/api/projects/{pid}/datasets/versions/{d['id']}").status_code == 404
    with pg_engine.begin() as conn:
        conn.execute(text("SELECT set_config('evix.user_id',:uid,true)"), {"uid": who["user"]["id"]})
        assert conn.execute(update(DatasetVersion).values(source_name="tamper")).rowcount == 0


@pytest.mark.postgres
def test_real_parallel_stats_chart_and_single_current_receipt(harness, pg_engine, settings):
    app, login, _, provider = harness; enable(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    d = dataset(client, pid)
    value = graph([n("d", "dataset", datasetVersionId=d["id"]), n("f", "frequency", x=0), n("num", "numeric", x=1), n("chart", "chart", chartKind="table", theme="blue")],
                  [e("d", "dataset", "f", "dataset"), e("d", "dataset", "num", "dataset"), e("f", "result", "chart", "result")])
    version = save(client, pid, value); run = start(client, pid, version["id"])
    worker = WorkflowRuntime(settings, pg_engine, provider)
    worker.drain_for_test()
    final = current(client, pid, run["id"])
    assert final["status"] == "succeeded", final
    results = {n["nodeId"]: n for n in final["nodes"]}
    assert results["f"]["result"]["output"]["data"]["n"] == 3
    assert results["f"]["result"]["output"]["data"]["rows"][0][1] == 2
    assert "svg" in results["chart"]["result"]["output"]
    assert "table" not in results["d"]["result"]["output"]
    before = len(final["events"])
    # Repeated queue message cannot recompute or append success twice.
    with worker.session(who["user"]["id"]) as session:
        item = session.scalar(select(WorkflowNodeRun).where(WorkflowNodeRun.run_id == run["id"], WorkflowNodeRun.node_id == "f"))
        worker.execute(item.id, session.get(WorkflowRun, run["id"]).user_id, item.attempt)
    assert len(current(client, pid, run["id"])["events"]) == before
    single = start(client, pid, version["id"], mode="single", selectedNodeIds=["chart"], upstreamRunId=run["id"])
    worker.drain_for_test(); assert current(client, pid, single["id"])["status"] == "succeeded"
    missing = client.post(f"/api/projects/{pid}/workflow/runs", json={"workflowVersionId": version["id"], "idempotencyKey": str(uuid4()), "mode": "single", "selectedNodeIds": ["chart"]})
    assert missing.status_code == 409 and missing.json()["error"]["code"] == "upstream_results_required"


@pytest.mark.postgres
def test_selected_run_branch_skip_collect_no_deadlock(harness, pg_engine, settings):
    _, login, _, provider = harness; enable(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]; d = dataset(client, pid)
    value = graph([n("d", "dataset", datasetVersionId=d["id"]), n("f", "frequency", x=0), n("c", "condition", metric="有效样本", op="gte", value=1),
                   n("yes", "chart", chartKind="table"), n("no", "chart", chartKind="table"), n("extra", "numeric", x=1)],
                  [e("d", "dataset", "f", "dataset"), e("f", "result", "c", "result"), e("c", "true", "yes", "result"), e("c", "false", "no", "result"), e("d", "dataset", "extra", "dataset")])
    # Obtain exact metric label from the fixed kernel; the catalog does not guess it.
    value["nodes"][2]["config"]["metric"] = "有效类别数"
    version = save(client, pid, value)
    run = start(client, pid, version["id"], mode="selected", selectedNodeIds=["yes", "no"])
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test(); final = current(client, pid, run["id"])
    nodes = {n["nodeId"]: n for n in final["nodes"]}
    assert final["status"] == "succeeded", final
    assert nodes["c"]["status"] == "succeeded"
    assert sorted([nodes["yes"]["status"], nodes["no"]["status"]]) == ["skipped", "succeeded"]
    assert "extra" not in nodes


@pytest.mark.postgres
def test_manual_approval_version_binding_and_report_exports(harness, pg_engine, settings):
    _, login, _, provider = harness; enable(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]
    value = graph([n("q", "question", text="现有汇总证据"), n("report", "report"), n("word", "word"), n("ppt", "ppt"), n("latex", "latex")],
                  [e("q", "text", "report", "text"), e("report", "report", "word", "report"), e("report", "report", "ppt", "report"), e("report", "report", "latex", "report")])
    version = save(client, pid, value); run = start(client, pid, version["id"])
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test(); waiting = current(client, pid, run["id"])
    assert waiting["status"] == "waiting"
    report = next(n for n in waiting["nodes"] if n["nodeId"] == "report")
    stale = client.post(f"/api/projects/{pid}/workflow/runs/{run['id']}/decisions", json={"idempotencyKey": str(uuid4()), "nodeId": "report", "expectedAttempt": report["attempt"], "inputHash": "0" * 64, "action": "approve"})
    assert stale.status_code == 409
    decide(client, pid, waiting, "report", content=content())
    worker.drain_for_test(); final = current(client, pid, run["id"])
    assert final["status"] == "succeeded", final
    for node in final["nodes"]:
        if node["kind"] not in ("word", "ppt", "latex"): continue
        output = node["result"]["output"]; file = client.get(output["downloadUrl"])
        assert file.status_code == 200 and hashlib.sha256(file.content).hexdigest() == output["hash"]
        assert "base64" not in output


@pytest.mark.postgres
def test_model_outcome_unknown_restart_no_replay_and_personal_key(harness, pg_engine, settings):
    _, login, _, provider = harness; enable(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    service = client.post("/api/services", json=service_input()).json()
    value = graph([n("q", "question", text="安全材料"), n("m", "model", prompt="解释汇总")], [e("q", "text", "m", "text")])
    version = save(client, pid, value)
    calls = 0
    async def unknown(*args):
        nonlocal calls; calls += 1; raise ProviderFailure("provider_timeout", unknown=True)
    provider.answer = unknown
    run = start(client, pid, version["id"], consent=True, serviceBindings={"m": {"serviceId": service["id"], "serviceRevision": 1}})
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test()
    assert current(client, pid, run["id"])["status"] == "outcome_unknown" and calls == 1
    worker.recover(); worker.drain_for_test(); assert calls == 1
    with worker.session(who["user"]["id"]) as session:
        row = session.scalar(select(WorkflowCall)); assert row.status == "outcome_unknown"
        assert "synthetic-private-model-key" not in canonical(row.output)


@pytest.mark.postgres
def test_lease_recovery_duplicate_outbox_and_revocation(harness, pg_engine, settings):
    _, login, _, provider = harness; enable(settings)
    client, who = login(); p, team = project(client); pid = p["id"]
    value = graph([n("q", "question", text="研究问题")]); version = save(client, pid, value); run = start(client, pid, version["id"])
    worker = WorkflowRuntime(settings, pg_engine, provider)
    with worker.session(who["user"]["id"]) as session:
        node = session.scalar(select(WorkflowNodeRun).where(WorkflowNodeRun.run_id == run["id"]))
        node.status, node.lease_token, node.lease_until = "running", str(uuid4()), now() - timedelta(seconds=1); session.commit()
    worker.recover(); worker.drain_for_test(); assert current(client, pid, run["id"])["status"] == "succeeded"
    revoked = start(client, pid, version["id"])
    with pg_engine.begin() as conn:
        conn.execute(text("DELETE FROM memberships WHERE team_id=:team AND user_id=:uid"), {"team": team, "uid": who["user"]["id"]})
    worker.drain_for_test(); assert client.get(f"/api/projects/{pid}/workflow/runs/{revoked['id']}").status_code == 404
    with worker.session(who["user"]["id"]) as session:
        row = session.scalar(select(WorkflowNodeRun).where(WorkflowNodeRun.run_id == revoked["id"]))
        assert row.status == "failed" and row.error_code == "permission_revoked"


@pytest.mark.postgres
def test_graph_ai_proposal_idempotency_confirmation_and_no_auto_apply(harness):
    _, login, _, provider = harness
    client, _ = login(); p, _ = project(client); pid = p["id"]
    service = client.post("/api/services", json=service_input()).json()
    value = graph([n("q", "question", text="研究问题")]); save(client, pid, value)
    data = {"idempotencyKey": str(uuid4()), "prompt": "补充分析分支", "definition": value, "serviceId": service["id"], "serviceRevision": 1, "expectedRevision": 1, "consent": True}
    result = client.post(f"/api/projects/{pid}/workflow/proposals", json=data)
    assert result.status_code == 201, result.text
    assert result.json()["status"] == "ready" and result.json()["baseRevision"] == 1
    assert client.post(f"/api/projects/{pid}/workflow/proposals", json=data).json() == result.json()
    assert provider.calls == 1
    assert client.get(f"/api/projects/{pid}/workflow").json()["revision"] == 1


@pytest.mark.postgres
def test_questionnaire_review_publish_wait_immutable_snapshot_and_replay(harness, pg_engine, settings):
    app, login, _, provider = harness; enable(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]
    q = client.post(f"/api/projects/{pid}/questionnaire/versions", json={"idempotencyKey": str(uuid4()), "expectedRevision": 0, "design": survey_design()})
    assert q.status_code == 201, q.text
    value = graph([n("q", "questionnaire", binding="pinned", artifactVersionId=q.json()["id"]), n("review", "review"), n("publish", "survey_publish"), n("wait", "survey_wait", targetCount=2), n("f", "frequency", x=2)],
                  [e("q", "questionnaire", "review", "value"), e("review", "questionnaire", "publish", "questionnaire"), e("publish", "release", "wait", "release"), e("wait", "dataset", "f", "dataset")])
    version = save(client, pid, value); run = start(client, pid, version["id"])
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test()
    decide(client, pid, current(client, pid, run["id"]), "review")
    worker.drain_for_test(); waiting = current(client, pid, run["id"])
    assert waiting["status"] == "waiting"
    decide(client, pid, waiting, "publish", action="publish")
    worker.drain_for_test(); view = current(client, pid, run["id"])
    release = next(node for node in view["nodes"] if node["nodeId"] == "publish")["result"]["output"]
    with anon_client(app, settings) as public:
        target = f"/api/surveys/{release['token']}/responses"
        for answers in ({"choice": "yes", "score": 4}, {"choice": "no"}):
            result = public.post(target, json={"idempotencyKey": str(uuid4()), "answers": answers})
            assert result.status_code == 201, result.text
        worker.recover(); worker.drain_for_test(); final = current(client, pid, run["id"])
        assert final["status"] == "succeeded", final
        frozen = next(node for node in final["nodes"] if node["nodeId"] == "wait")["result"]["output"]["datasetRef"]
        original = client.get(f"/api/projects/{pid}/datasets/versions/{frozen['id']}").json()
        assert original["rowCount"] == 2 and original["content"]["mapping"]["confirmed"] is True
        later = public.post(target, json={"idempotencyKey": str(uuid4()), "answers": {"choice": "yes", "score": 2}})
        assert later.status_code == 201
        worker.recover()
        assert client.get(f"/api/projects/{pid}/datasets/versions/{frozen['id']}").json() == original
    stream = client.get(f"/api/projects/{pid}/workflow/runs/{run['id']}/events?afterSequence=1")
    assert stream.status_code == 200 and "node_succeeded" in stream.text and '"sequence":1,' not in stream.text
    assert '"table"' not in stream.text and '"answers"' not in stream.text


@pytest.mark.postgres
def test_result_review_report_provenance_pinned_reload_and_native_edit(harness, pg_engine, settings):
    _, login, _, provider = harness; enable(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]; d = dataset(client, pid)
    value = graph([n("d", "dataset", datasetVersionId=d["id"]), n("f", "frequency", x=0), n("review", "review"), n("chart", "chart", chartKind="table"), n("report", "report", binding="proposal"), n("word", "word")],
                  [e("d", "dataset", "f", "dataset"), e("f", "result", "review", "value"), e("review", "value", "chart", "result"), e("review", "value", "report", "result"), e("report", "report", "word", "report")])
    version = save(client, pid, value); run = start(client, pid, version["id"])
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test()
    decide(client, pid, current(client, pid, run["id"]), "review"); worker.drain_for_test()
    waiting = current(client, pid, run["id"]); assert waiting["status"] == "waiting", waiting
    report = next(node for node in waiting["nodes"] if node["nodeId"] == "report")
    assert report["result"]["proposal"]["classification"] == "simulated"
    decide(client, pid, waiting, "report"); worker.drain_for_test(); final = current(client, pid, run["id"])
    assert final["status"] == "succeeded", final
    descriptor = next(node for node in final["nodes"] if node["nodeId"] == "report")["result"]["output"]
    assert descriptor["classification"] == "simulated"
    revised = copy.deepcopy(descriptor["content"]); revised["title"] = "保留证据分类的修订稿"
    saved = client.post(f"/api/projects/{pid}/report/versions", json={"idempotencyKey": str(uuid4()), "expectedRevision": 1, "content": revised})
    assert saved.status_code == 201, saved.text
    with worker.session(who["user"]["id"]) as session:
        assert session.get(ReportProvenance, saved.json()["id"]).classification == "simulated"
    pinned = graph([n("r", "report", binding="head"), n("review", "review"), n("w", "word")], [e("r", "report", "review", "value"), e("review", "report", "w", "report")])
    newer = save(client, pid, pinned, revision=1); again = start(client, pid, newer["id"])
    worker.drain_for_test(); decide(client, pid, current(client, pid, again["id"]), "review"); worker.drain_for_test()
    reopened = current(client, pid, again["id"])
    assert reopened["status"] == "succeeded" and all(node["result"]["output"]["classification"] == "simulated" for node in reopened["nodes"])


@pytest.mark.postgres
def test_silicon_registered_dataset_classification_and_model_summary_only(harness, pg_engine, settings):
    _, login, _, provider = harness; enable(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]
    q = client.post(f"/api/projects/{pid}/questionnaire/versions", json={"idempotencyKey": str(uuid4()), "expectedRevision": 0, "design": survey_design()}).json()
    service = client.post("/api/services", json=service_input()).json()
    personas = [{"id": f"p-{i}", "code": f"S-{i}", "traits": {"group": "合成组"}, "background": "合成验收"} for i in range(2)]
    value = graph([n("q", "questionnaire", binding="pinned", artifactVersionId=q["id"]), n("p", "persona", personas=personas), n("s", "silicon", count=2), n("f", "frequency", x=0), n("m", "model", prompt="解释汇总统计")],
                  [e("q", "questionnaire", "s", "questionnaire"), e("p", "persona", "s", "persona"), e("s", "dataset", "f", "dataset"), e("f", "result", "m", "result")])
    version = save(client, pid, value)
    run = start(client, pid, version["id"], consent=True, serviceBindings={nid: {"serviceId": service["id"], "serviceRevision": 1} for nid in ("s", "m")})
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test(); final = current(client, pid, run["id"])
    assert final["status"] == "succeeded", final
    assert provider.calls == 3
    silicon_result = next(node for node in final["nodes"] if node["nodeId"] == "s")["result"]["output"]
    assert silicon_result["datasetRef"]["classification"] == "simulated" and "table" not in silicon_result
    assert next(node for node in final["nodes"] if node["nodeId"] == "m")["result"]["output"]["classification"] == "simulated"


@pytest.mark.postgres
def test_cancel_side_effect_fence(harness, pg_engine, settings):
    _, login, _, provider = harness; enable(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    version = save(client, pid, graph([n("q", "question", text="研究问题")]))
    run = start(client, pid, version["id"]); worker = WorkflowRuntime(settings, pg_engine, provider)
    first = worker.pending_messages(); assert len(first) == 1
    client.post(f"/api/projects/{pid}/workflow/runs/{run['id']}/cancel", json={"idempotencyKey": str(uuid4())})
    with worker.session(who["user"]["id"]) as session:
        node = session.get(WorkflowNodeRun, first[0][1]); token = str(uuid4())
        node.status, node.lease_token = "running", token; session.commit()
    with pytest.raises(ApiError):
        worker.persist_files(run["id"], "q", who["user"]["id"], {"output": {"kind": "file", "filename": "late.txt", "source": "late"}, "ports": {}}, first[0][1], token)
    with worker.session(who["user"]["id"]) as session: assert session.scalars(select(WorkflowFile)).all() == []


@pytest.mark.postgres
@pytest.mark.parametrize("kind", ["word", "silicon"])
def test_crash_after_artifact_persistence_reuses_file_or_dataset_and_paid_receipts(harness, pg_engine, settings, kind):
    _, login, _, provider = harness; enable(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    if kind == "word":
        report = client.post(f"/api/projects/{pid}/report/versions", json={"idempotencyKey": str(uuid4()), "expectedRevision": 0, "content": content()}).json()
        value = graph([n("r", "report", binding="pinned", artifactVersionId=report["id"]), n("target", "word")], [e("r", "report", "target", "report")])
        bindings = {}
    else:
        q = client.post(f"/api/projects/{pid}/questionnaire/versions", json={"idempotencyKey": str(uuid4()), "expectedRevision": 0, "design": survey_design()}).json()
        service = client.post("/api/services", json=service_input()).json()
        personas = [{"id": "p1", "code": "S1", "traits": {}, "background": "合成验收"}]
        value = graph([n("q", "questionnaire", binding="pinned", artifactVersionId=q["id"]), n("p", "persona", personas=personas), n("target", "silicon", count=1)],
                      [e("q", "questionnaire", "target", "questionnaire"), e("p", "persona", "target", "persona")])
        bindings = {"target": {"serviceId": service["id"], "serviceRevision": 1}}
    version = save(client, pid, value); run = start(client, pid, version["id"], serviceBindings=bindings, consent=True)
    worker = WorkflowRuntime(settings, pg_engine, provider)
    original = worker.persist_files if kind == "word" else worker.simulated
    crashed = False
    def crash(*args, **kwargs):
        nonlocal crashed
        result = original(*args, **kwargs)
        is_target = kind == "silicon" or isinstance(result.get("output"), dict) and result["output"].get("kind") == "file"
        if is_target and not crashed:
            crashed = True; raise KeyboardInterrupt("synthetic crash after immutable artifact commit")
        return result
    if kind == "word": worker.persist_files = crash
    else: worker.simulated = crash
    with pytest.raises(KeyboardInterrupt): worker.drain_for_test()
    with worker.session(who["user"]["id"]) as session:
        node = session.scalar(select(WorkflowNodeRun).where(WorkflowNodeRun.run_id == run["id"], WorkflowNodeRun.node_id == "target"))
        row = session.scalar(select(WorkflowFile).where(WorkflowFile.run_id == run["id"])) if kind == "word" else session.scalar(select(DatasetVersion).where(DatasetVersion.origin_node_run_id == node.id))
        original_id = row.id
        node.lease_until = now() - timedelta(seconds=1); session.commit()
    worker.recover(); worker.drain_for_test(); final = current(client, pid, run["id"])
    assert final["status"] == "succeeded", final
    output = next(node for node in final["nodes"] if node["nodeId"] == "target")["result"]["output"]
    assert (output["id"] if kind == "word" else output["datasetRef"]["id"]) == original_id
    assert provider.calls == (1 if kind == "silicon" else 0)
    with worker.session(who["user"]["id"]) as session:
        rows = session.scalars(select(WorkflowFile).where(WorkflowFile.run_id == run["id"])).all() if kind == "word" else session.scalars(select(DatasetVersion).where(DatasetVersion.origin_node_run_id == node.id)).all()
        assert len(rows) == 1


@pytest.mark.postgres
def test_unknown_external_receipt_survives_revocation_after_dispatch(harness, pg_engine, settings):
    _, login, _, provider = harness; enable(settings)
    client, who = login(); p, team = project(client); pid = p["id"]
    service = client.post("/api/services", json=service_input()).json()
    value = graph([n("m", "model", prompt="解释研究方法")]); version = save(client, pid, value)
    async def unknown(*args):
        with pg_engine.begin() as conn:
            conn.execute(text("SELECT set_config('evix.user_id',:uid,true)"), {"uid": who["user"]["id"]})
            conn.execute(text("DELETE FROM memberships WHERE team_id=:team AND user_id=:uid"), {"team": team, "uid": who["user"]["id"]})
        raise ProviderFailure("provider_timeout", unknown=True)
    provider.answer = unknown
    run = start(client, pid, version["id"], consent=True, serviceBindings={"m": {"serviceId": service["id"], "serviceRevision": 1}})
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test()
    with worker.session(who["user"]["id"]) as session:
        node = session.scalar(select(WorkflowNodeRun).where(WorkflowNodeRun.run_id == run["id"]))
        assert node.status == "outcome_unknown" and session.get(WorkflowRun, run["id"]).status == "outcome_unknown"
        assert session.scalar(select(WorkflowCall).where(WorkflowCall.node_run_id == node.id)).status == "outcome_unknown"


@pytest.mark.postgres
def test_legacy_silicon_mixed_success_unknown_never_ready(entered):
    _, open_client, provider = entered
    client, _ = open_client(); p, _ = project(client); pid = p["id"]
    service = client.post("/api/services", json=service_input()).json()
    original = provider.answer
    calls = 0
    async def mixed(*args):
        nonlocal calls; calls += 1
        if calls == 2: raise ProviderFailure("provider_timeout", unknown=True)
        return await original(*args)
    provider.answer = mixed
    data = silicon_payload(services=[{"serviceId": service["id"], "serviceRevision": 1}], scenarios=[], expectedCalls=3)
    path = f"/api/projects/{pid}/silicon-runs"
    response = client.post(path, json=data); assert response.status_code == 202, response.text
    done = silicon_wait(client, path + "/" + response.json()["id"])
    assert done["status"] == "outcome_unknown" and any(r["status"] == "ok" for r in done["responses"])
    assert any(r["status"] == "outcome_unknown" for r in done["responses"])


@pytest.mark.postgres
def test_inactive_optional_model_branch_skips_without_paid_call_and_other_branch_continues(harness, pg_engine, settings):
    _, login, _, provider = harness; enable(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]; d = dataset(client, pid)
    service = client.post("/api/services", json=service_input()).json()
    value = graph([n("d", "dataset", datasetVersionId=d["id"]), n("f", "frequency", x=0), n("c", "condition", metric="有效类别数", op="gte", value=100), n("m", "model", prompt="仅在真分支解释"), n("r", "report", binding="proposal"), n("chart", "chart", chartKind="table")],
                  [e("d", "dataset", "f", "dataset"), e("f", "result", "c", "result"), e("c", "true", "m", "result"), e("c", "true", "r", "result"), e("c", "false", "chart", "result")])
    version = save(client, pid, value); run = start(client, pid, version["id"], consent=True, serviceBindings={"m": {"serviceId": service["id"], "serviceRevision": 1}})
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test(); final = current(client, pid, run["id"])
    assert final["status"] == "succeeded", final
    assert provider.calls == 0 and {node["nodeId"] for node in final["nodes"] if node["status"] == "skipped"} == {"m", "r"}


@pytest.mark.postgres
def test_parallel_failure_blocks_only_dependents_and_collect_preserves_named_samples(harness, pg_engine, settings):
    _, login, _, provider = harness; enable(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]; d = dataset(client, pid)
    value = graph([n("d", "dataset", datasetVersionId=d["id"]), n("bad", "frequency", x=79), n("n", "numeric", x=1), n("dependent", "chart", chartKind="table")],
                  [e("d", "dataset", "bad", "dataset"), e("d", "dataset", "n", "dataset"), e("bad", "result", "dependent", "result")])
    version = save(client, pid, value); run = start(client, pid, version["id"])
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test(); final = current(client, pid, run["id"])
    assert final["status"] == "partial" and {node["nodeId"]: node["status"] for node in final["nodes"]} == {"d": "succeeded", "bad": "failed", "n": "succeeded", "dependent": "blocked"}
    value = graph([n("d", "dataset", datasetVersionId=d["id"]), n("f", "frequency", x=0), n("n", "numeric", x=1), n("all", "collect"), n("chart", "chart", chartKind="table"), n("r", "report", binding="proposal")],
                  [e("d", "dataset", "f", "dataset"), e("d", "dataset", "n", "dataset"), e("f", "result", "all", "results"), e("n", "result", "all", "results"), e("all", "result", "chart", "result"), e("all", "result", "r", "result")])
    preflight = validate_graph(value, catalog()[1]); assert any(issue["code"] == "result_selection_required" for issue in preflight["issues"])
    value["nodes"][4]["config"]["resultName"] = "n"
    newer = save(client, pid, value, revision=1); grouped = start(client, pid, newer["id"]); worker.drain_for_test()
    view = current(client, pid, grouped["id"]); members = next(node for node in view["nodes"] if node["nodeId"] == "all")["result"]["output"]
    assert members["summary"]["count"] == 2 and [member["n"] for member in members["summary"]["samples"]] == [3, 3]
    proposal = next(node for node in view["nodes"] if node["nodeId"] == "r")["result"]["proposal"]
    assert "f：有效样本 3" in proposal["content"]["report"][-1]["body"] and "n：有效样本 3" in proposal["content"]["report"][-1]["body"]
    decide(client, pid, view, "r"); worker.drain_for_test(); assert current(client, pid, grouped["id"])["status"] == "succeeded"


@pytest.mark.postgres
def test_collection_expiry_requires_decision_then_manual_lock(harness, pg_engine, settings):
    app, login, _, provider = harness; enable(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]
    q = client.post(f"/api/projects/{pid}/questionnaire/versions", json={"idempotencyKey": str(uuid4()), "expectedRevision": 0, "design": survey_design()}).json()
    value = graph([n("q", "questionnaire", binding="pinned", artifactVersionId=q["id"]), n("publish", "survey_publish"), n("wait", "survey_wait", targetCount=1, deadline=(now() - timedelta(seconds=1)).isoformat())],
                  [e("q", "questionnaire", "publish", "questionnaire"), e("publish", "release", "wait", "release")])
    version = save(client, pid, value); run = start(client, pid, version["id"]); worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test()
    decide(client, pid, current(client, pid, run["id"]), "publish"); worker.drain_for_test(); view = current(client, pid, run["id"])
    release = next(node for node in view["nodes"] if node["nodeId"] == "publish")["result"]["output"]
    with anon_client(app, settings) as public:
        assert public.post(f"/api/surveys/{release['token']}/responses", json={"idempotencyKey": str(uuid4()), "answers": {"choice": "no"}}).status_code == 201
    worker.recover(); view = current(client, pid, run["id"])
    assert next(node for node in view["nodes"] if node["nodeId"] == "wait")["status"] == "wait_expired"
    decide(client, pid, view, "wait", action="continue", targetCount=2, deadline=(now() + timedelta(hours=1)).isoformat())
    view = current(client, pid, run["id"]); assert view["status"] == "waiting"
    decide(client, pid, view, "wait", action="lock_current"); final = current(client, pid, run["id"])
    assert final["status"] == "succeeded"
    ref = next(node for node in final["nodes"] if node["nodeId"] == "wait")["result"]["output"]["datasetRef"]
    frozen = client.get(f"/api/projects/{pid}/datasets/versions/{ref['id']}").json()
    assert frozen["rowCount"] == 1 and frozen["content"]["targetReached"] is False


@pytest.mark.postgres
def test_executor_build_change_blocks_resume_instead_of_recomputing(harness, pg_engine, settings, monkeypatch):
    _, login, _, provider = harness; enable(settings)
    client, _ = login(); p, _ = project(client); pid = p["id"]
    version = save(client, pid, graph([n("q", "question", text="冻结执行器")]))
    run = start(client, pid, version["id"])
    monkeypatch.setattr("evix_api.workflow_runner.executor_fingerprint", lambda settings: "0" * 64)
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test()
    final = current(client, pid, run["id"])
    assert final["status"] == "failed" and final["nodes"][0]["errorCode"] == "executor_revision_changed"


@pytest.mark.postgres
def test_questionnaire_generation_is_native_proposal_without_overwriting_editor(harness, pg_engine, settings):
    from evix_api.models import Proposal
    _, login, _, provider = harness; enable(settings)
    client, who = login(); p, _ = project(client); pid = p["id"]
    service = client.post("/api/services", json=service_input(capabilities=["questionnaire"])).json()
    version = save(client, pid, graph([n("q", "question", text="消费者为何选择这家店？"), n("g", "questionnaire_generate", prompt="拟调查消费者到店选择")], [e("q", "text", "g", "text")]))
    run = start(client, pid, version["id"], consent=True, serviceBindings={"g": {"serviceId": service["id"], "serviceRevision": 1}})
    worker = WorkflowRuntime(settings, pg_engine, provider); worker.drain_for_test(); final = current(client, pid, run["id"])
    assert final["status"] == "succeeded", final
    output = next(node for node in final["nodes"] if node["nodeId"] == "g")["result"]["output"]
    assert output["proposed"] is True and output["inputRevision"] == 0 and provider.calls == 1
    with worker.session(who["user"]["id"]) as session:
        proposal = session.get(Proposal, output["proposalId"])
        assert proposal.status == "ready" and proposal.design == output["design"]
    assert client.get(f"/api/projects/{pid}/questionnaire").json()["questionnaire"] is None
