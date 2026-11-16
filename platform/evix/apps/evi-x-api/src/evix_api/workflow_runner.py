"""Fixed research-node executor with durable leases, external-call receipts and recovery.

PostgreSQL owns node claims, leases, state transitions and execution receipts.
No user-supplied Python, HTTP endpoints, process arguments or commands are executed.
"""
import asyncio
import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import time

from sqlalchemy import func, select, text as sql_text
from sqlalchemy.orm import Session as DBSession

from .contracts import ApiError, canonical, fingerprint, integer, questionnaire, text
from .models import Member, Project, User, Version, SurveyRelease, SurveyResponse, Service, Proposal, now, new_id
from .provider import FixtureProvider, LiveProvider, ProviderFailure, parse_proposal
from .security import config_view, decrypt, random_token
from .reports import ReportVersion, report_content
from .surveys import publishable_design, public_design, dataset_view as survey_dataset, release_view
from .latex import LatexCompiler, stop_process, WindowsJob
from . import silicon
from .workflow_models import (WorkflowRun, WorkflowNodeRun, WorkflowOutbox, WorkflowCall, DatasetVersion, WorkflowFile, ReportProvenance)
from .workflows import append_event, aggregate_status, catalog, dataset_descriptor, parse_csv, redact, MODEL_KINDS, executor_fingerprint, validate_graph

SUCCESS = {"succeeded"}
TERMINAL = {"succeeded", "failed", "blocked", "skipped", "cancelled", "rejected", "outcome_unknown"}
ACTIVE = {"queued", "claimed", "running"}
MAX_RESULT_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True)
class NodeClaim:
    outbox_id: str
    node_run_id: str
    user_id: str
    attempt: int
    lease_token: str
    lane: str


def valid_lease(node, token, statuses=("running",)):
    return node is not None and node.status in statuses and node.lease_token == token and node.lease_until is not None and node.lease_until > now()


def scoped(session, uid, worker=False):
    session.execute(sql_text("SELECT set_config('evix.user_id', :uid, true)"), {"uid": uid})
    if worker: session.execute(sql_text("SELECT set_config('evix.workflow_worker','on',true)"))


def config_for(run, node):
    raw = next(item for item in run.manifest["definition"]["nodes"] if item["id"] == node.node_id)
    spec = catalog()[1][node.kind]
    return {**{field["key"]: field["default"] for field in spec.get("configFields", []) if "default" in field}, **raw["config"]}


def node_inputs(run, node, by_id, spec):
    incoming = [e for e in run.manifest["definition"]["edges"] if e["target"] == node.node_id and e["kind"] != "reference"]
    if any(by_id[e["source"]].status not in TERMINAL for e in incoming): return None, None
    if any(by_id[e["source"]].status in ("failed", "blocked", "cancelled", "rejected", "outcome_unknown") for e in incoming): return None, "blocked"
    inputs = {}
    ports = {p["id"]: p for p in spec["inputs"]}
    for edge in incoming:
        source = by_id[edge["source"]]
        if edge["kind"] == "control":
            if source.status == "skipped": return None, "skipped"
            continue
        value = (source.result or {}).get("ports", {}).get(edge["sourcePort"])
        port = ports.get(edge["targetPort"])
        if port is None: return None, "blocked"
        if value is not None:
            if port.get("multiple"):
                inputs.setdefault(port["id"], []).append({"name": source.node_id, "value": value})
            else: inputs[port["id"]] = value
    for pid, port in ports.items():
        if port.get("required") and pid not in inputs: return None, "skipped"
    if any(edge["kind"] == "data" for edge in incoming) and not inputs:
        return None, "skipped"
    return inputs, None


def reconcile(session, run, settings):
    """Caller holds the run row lock. Schedule once; branch results control activation."""
    session.flush()
    nodes = session.scalars(select(WorkflowNodeRun).where(WorkflowNodeRun.run_id == run.id)).all()
    by_id, kinds = {n.node_id: n for n in nodes}, catalog(settings)[1]
    if run.cancel_requested:
        for node in nodes:
            if node.status not in TERMINAL and node.status != "running":
                node.status, node.finished_at, node.error_code = "cancelled", now(), "cancelled_by_user"
                append_event(session, run, "node_cancelled", node)
    else:
        active_compute = sum(n.status in ACTIVE and n.kind not in MODEL_KINDS for n in nodes)
        active_model = sum(n.status in ACTIVE and n.kind in MODEL_KINDS for n in nodes)
        for nid in run.manifest["nodeIds"]:
            node = by_id[nid]
            if node.status != "pending": continue
            inputs, terminal = node_inputs(run, node, by_id, kinds[node.kind])
            if terminal:
                node.status, node.finished_at, node.error_code = terminal, now(), "upstream_unavailable" if terminal == "blocked" else None
                append_event(session, run, "node_" + terminal, node); continue
            if inputs is None: continue
            is_model = node.kind in MODEL_KINDS
            if (is_model and active_model >= settings.workflow_parallel_model) or (not is_model and active_compute >= settings.workflow_parallel_compute): continue
            config = config_for(run, node)
            digest = fingerprint({"kind": node.kind, "config": config, "inputs": inputs, "frozen": run.manifest["frozen"].get(nid),
                                  "executorHash": run.manifest["executorHash"], "catalogHash": run.manifest["catalogHash"]})
            node.input_hash, node.inputs = digest, inputs
            node.attempt += 1; node.status = "queued"
            session.add(WorkflowOutbox(id=new_id(), project_id=run.project_id, run_id=run.id, node_run_id=node.id, user_id=run.user_id, attempt=node.attempt, available_at=now()))
            append_event(session, run, "node_queued", node, {"attempt": node.attempt, "inputHash": digest})
            if is_model: active_model += 1
            else: active_compute += 1
    status = aggregate_status(nodes, run.cancel_requested)
    if status != run.status:
        run.status = status; append_event(session, run, "run_status", payload={"status": status, "unknownCount": sum(n.status == "outcome_unknown" for n in nodes)})
    session.flush()


def authorize(session, run, settings, *, edit=True):
    user = session.get(User, run.user_id)
    if user is None or user.email not in settings.invited_emails: raise ApiError(403, "permission_revoked", "发起账户已失去访问权限。")
    project = session.get(Project, run.project_id)
    if project is None: raise ApiError(403, "permission_revoked", "项目访问权限已撤销。")
    member = session.get(Member, (project.team_id, run.user_id))
    if member is None or edit and member.role not in ("owner", "editor"):
        raise ApiError(403, "permission_revoked", "项目操作权限已撤销。")


def response(output, port, *, diagnostics=None):
    return {"output": output, "ports": {port: output}, "diagnostics": diagnostics or []}


def create_dataset(session, run, source_name, classification, content, origin=None):
    if origin:
        previous = session.scalar(select(DatasetVersion).where(DatasetVersion.origin_node_run_id == origin.id))
        if previous:
            if previous.origin_input_hash != origin.input_hash or previous.content_hash != fingerprint(content):
                raise ApiError(409, "input_hash_conflict", "已有数据成果与冻结输入不一致。")
            return dataset_descriptor(previous)
    row = DatasetVersion(id=new_id(), project_id=run.project_id, source_name=source_name, classification=classification,
                         content_hash=fingerprint(content), content=content, created_by=run.user_id,
                         origin_node_run_id=origin.id if origin else None, origin_input_hash=origin.input_hash if origin else None)
    session.add(row); session.flush()
    return dataset_descriptor(row)


def freeze_survey(session, run, node, settings, *, reached=True):
    release_input = (node.inputs or {}).get("release", {})
    release_id = release_input.get("id") or release_input.get("releaseId")
    session.execute(sql_text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(fingerprint(["survey", release_id])[:15], 16)})
    release = session.scalar(select(SurveyRelease).where(SurveyRelease.id == release_id, SurveyRelease.project_id == run.project_id).with_for_update())
    if release is None: raise ApiError(404, "release_unavailable", "问卷发布版本不存在。")
    design = session.get(Version, release.version_id).design
    rows = session.scalars(select(SurveyResponse).where(SurveyResponse.release_id == release.id).order_by(SurveyResponse.created_at, SurveyResponse.id)).all()
    result = survey_dataset(release, design, rows)
    # Public releases contain two metadata columns and visibility flags. They
    # are preserved, never dropped or remapped implicitly.
    table = parse_csv(result["csv"]) if rows else {"headers": [c["column"] for c in result["columns"]], "rows": [], "skippedBlankLines": 0, "delimiter": ","}
    mapping = {"design": design, "assignments": [{"questionId": q["id"], "column": q["variable"], "representation": "code"} for q in design["questions"]], "confirmed": True}
    value = create_dataset(session, run, design["title"], "actual" if release.classification == "actual" else "simulated",
                           {"table": table, "mapping": mapping, "design": design, "releaseId": release.id,
                            "releaseVersionId": release.version_id, "watermark": rows[-1].id if rows else None,
                            "targetReached": reached, "rowCount": len(rows), "routing": {"policy": "exclude", "confirmed": True}})
    node.result, node.status, node.finished_at = response(value, "dataset"), "succeeded", now()
    append_event(session, run, "dataset_frozen", node, {"datasetRef": value["datasetRef"], "rowCount": len(rows), "targetReached": reached})


def poll_wait(session, run, node, settings):
    if node.status not in ("waiting_data", "wait_expired"): return
    config = config_for(run, node)
    waiting = (node.result or {}).get("waiting", {})
    target = waiting.get("targetCount", config.get("targetCount"))
    deadline = waiting.get("deadline", config.get("deadline"))
    release_input = (node.inputs or {}).get("release", {})
    rid = release_input.get("id") or release_input.get("releaseId")
    release = session.scalar(select(SurveyRelease).where(SurveyRelease.id == rid, SurveyRelease.project_id == run.project_id))
    if release is None:
        node.status, node.error_code, node.finished_at = "failed", "release_unavailable", now(); return
    count = (node.result or {}).get("waiting", {}).get("responseCount")
    if count != release.response_count:
        node.result = {**(node.result or {}), "waiting": {**waiting, "responseCount": release.response_count}}
        append_event(session, run, "collection_progress", node, {"responseCount": release.response_count, "targetCount": target})
    if deadline:
        try: expired = datetime.fromisoformat(deadline.replace("Z", "+00:00")) <= now()
        except (ValueError, TypeError): raise ApiError(422, "invalid_deadline", "回收期限须包含时区。") from None
        if expired:
            if node.status != "wait_expired":
                node.status, node.error_code = "wait_expired", "collection_deadline"
                append_event(session, run, "wait_expired", node, {"responseCount": release.response_count, "targetCount": target})
            return
    if target and release.response_count >= integer(target, 1, 5000):
        freeze_survey(session, run, node, settings); return


def apply_decision(session, run, node, action, values, settings, actor_id):
    if not isinstance(values, dict): raise ApiError()
    if action in ("reject", "cancel"):
        node.status, node.error_code, node.finished_at = "rejected", "rejected_by_user", now(); return
    if node.kind == "survey_wait":
        if action == "lock_current": freeze_survey(session, run, node, settings, reached=False); return
        if action == "continue":
            target = values.get("targetCount")
            deadline = values.get("deadline")
            if target is not None: integer(target, 1, 5000)
            if deadline:
                try:
                    parsed = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
                    if parsed.tzinfo is None or parsed <= now(): raise ValueError()
                except (ValueError, TypeError): raise ApiError(422, "invalid_deadline", "请选择未来且带时区的截止时间。") from None
            node.result = {**(node.result or {}), "waiting": {"targetCount": target, "deadline": deadline, "continuedBy": actor_id}}
            node.status, node.error_code = "waiting_data", None
            poll_wait(session, run, node, settings); return
    if action not in ("approve", "apply", "publish"):
        raise ApiError(422, "invalid_decision", "请选择有效的人工决定。")
    config = config_for(run, node)
    if node.kind == "survey_publish":
        source = (node.inputs or {}).get("questionnaire", {})
        project = session.scalar(select(Project).where(Project.id == run.project_id).with_for_update())
        version_id = source.get("versionId") or source.get("artifactVersionId")
        if source.get("proposed"):
            expected = source.get("inputRevision")
            if project.questionnaire_revision != expected: raise ApiError(409, "stale_proposal", "问卷已有新版本，请在编辑器核对提案。")
            design = questionnaire(source.get("design"))
            q = Version(id=new_id(), project_id=run.project_id, revision=expected + 1, created_by=actor_id, design=design, design_hash=fingerprint(design), source_proposal_id=source.get("proposalId"))
            session.add(q); project.questionnaire_revision += 1; project.revision += 1; session.flush(); version_id = q.id
        q = session.scalar(select(Version).where(Version.id == version_id, Version.project_id == run.project_id))
        if q is None: raise ApiError(409, "unsaved_questionnaire", "请先确认并保存问卷版本。")
        release = session.scalar(select(SurveyRelease).where(SurveyRelease.project_id == run.project_id, SurveyRelease.version_id == q.id))
        if release is None:
            design = publishable_design(q.design)
            release = SurveyRelease(id=new_id(), project_id=run.project_id, version_id=q.id, questionnaire_revision=q.revision,
                                    token=random_token(), public_design=public_design(design), classification="synthetic" if settings.mode == "local_test" else "actual",
                                    revision=1, status="open", response_count=0, response_bytes=0, created_at=now())
            session.add(release); session.flush()
        node.result = response({"kind": "release", **release_view(release)}, "release")
    elif node.kind == "report":
        project = session.scalar(select(Project).where(Project.id == run.project_id).with_for_update())
        previous = session.scalar(select(ReportVersion).where(ReportVersion.project_id == run.project_id).order_by(ReportVersion.revision.desc()).limit(1))
        proposal = (node.result or {}).get("proposal", {})
        expected = proposal.get("expectedRevision", 0)
        if expected != (previous.revision if previous else 0): raise ApiError(409, "stale_proposal", "报告已有新版本，请核对当前草稿。")
        content = report_content(values.get("content") or proposal.get("content"))
        version = ReportVersion(id=new_id(), project_id=run.project_id, revision=expected + 1, content=content, content_hash=fingerprint(content), created_by=actor_id)
        session.add(version); session.flush()
        provenance = {"runId": run.id, "nodeId": node.node_id, "inputHash": node.input_hash, "inputs": redact(node.inputs), "previous": proposal.get("previousProvenance")}
        evidence_class = classification([node.inputs, {"classification": proposal.get("classification", "unknown")}])
        session.add(ReportProvenance(report_version_id=version.id, project_id=run.project_id, classification=evidence_class, source=provenance))
        node.result = response({"kind": "report", "content": content, "versionId": version.id, "revision": version.revision, "hash": version.content_hash,
                                "classification": evidence_class, "source": provenance}, "report")
    elif node.kind == "claim":
        content = values.get("text", config.get("text", "")); text(content, 12000, 1)
        node.result = response({"kind": "text", "text": content, "classification": classification(node.inputs), "scope": values.get("scope", config.get("scope", "")),
                                "source": {"runId": run.id, "nodeId": node.node_id, "inputHash": node.input_hash}, "approvedBy": actor_id}, "text")
    elif node.kind == "review":
        value = (node.inputs or {}).get("value")
        approved = {**value, "approvedBy": actor_id, "approvalInputHash": node.input_hash} if isinstance(value, dict) and value.get("kind") == "result" else {"kind": "result", "classification": classification(value), "value": value,
                                "hash": fingerprint(value), "approvedBy": actor_id, "inputHash": node.input_hash}
        node.result = response(approved, "value")
        if isinstance(value, dict) and value.get("kind") in ("questionnaire", "report", "chart", "text", "material"):
            node.result["ports"][value["kind"]] = {**value, "approvedBy": actor_id, "approvalInputHash": node.input_hash}
    else: raise ApiError(422, "invalid_decision", "这个节点不接受此决定。")
    node.status, node.finished_at = "succeeded", now()


def classification(value):
    if isinstance(value, dict):
        own = value.get("classification") or value.get("datasetRef", {}).get("classification")
        if own == "simulated": return "simulated"
        if any(classification(v) == "simulated" for v in value.values()): return "simulated"
        if own == "unknown" or any(classification(v) == "unknown" for v in value.values()): return "unknown"
    elif isinstance(value, list) and any(classification(v) == "simulated" for v in value): return "simulated"
    elif isinstance(value, list) and any(classification(v) == "unknown" for v in value): return "unknown"
    return "actual"


def forbid_raw_model_input(value, parent=""):
    if isinstance(value, dict):
        if value.get("kind") == "dataset" or any(key in value for key in ("table", "originalTable", "csv", "answers", "responses", "pairs", "distributions", "eligibleIndices", "rowIndices")) or ("rows" in value and parent != "data"):
            raise ApiError(422, "raw_answers_forbidden", "模型节点仅接受材料、汇总统计和证据。")
        for key, item in value.items(): forbid_raw_model_input(item, key)
    elif isinstance(value, list):
        for item in value: forbid_raw_model_input(item, parent)


def run_node_process(settings, kind, config, inputs):
    payload = canonical({"kind": kind, "config": config, "inputs": inputs}).encode("utf-8")
    if len(payload) > MAX_RESULT_BYTES: raise ApiError(413, "executor_input_limit", "执行输入超过容量。")
    executable, script = settings.workflow_node_executable, settings.workflow_executor_path
    if not Path(executable).is_file() or not Path(script).is_file(): raise ApiError(503, "worker_unavailable", "执行器不可用。")
    with tempfile.TemporaryDirectory(prefix="evix-workflow-") as folder:
        directory, process, job = Path(folder), None, WindowsJob() if os.name == "nt" else None
        env = {name: os.environ[name] for name in ("SystemRoot", "WINDIR", "LANG", "LC_ALL") if name in os.environ}
        env.update({"PATH": str(Path(executable).parent), "TMP": folder, "TEMP": folder, "TMPDIR": folder})
        try:
            with (directory / "output.json").open("wb") as output, (directory / "error.log").open("wb") as errors, (directory / "input.json").open("wb") as source:
                source.write(payload)
            with (directory / "input.json").open("rb") as source, (directory / "output.json").open("wb") as output, (directory / "error.log").open("wb") as errors:
                process = subprocess.Popen([executable, "--experimental-strip-types", "--max-old-space-size=512", script], stdin=source, stdout=output, stderr=errors,
                                           env=env, cwd=Path(script).parent.parent, shell=False,
                                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0, start_new_session=os.name != "nt")
                if job: job.assign(process)
                deadline = time.monotonic() + settings.workflow_node_seconds
                while process.poll() is None:
                    if time.monotonic() >= deadline: raise ApiError(504, "executor_timeout", "固定计算超过时间上限。")
                    if (directory / "output.json").stat().st_size > MAX_RESULT_BYTES or (directory / "error.log").stat().st_size > 1048576:
                        raise ApiError(413, "executor_output_limit", "执行输出超过容量。")
                    time.sleep(.025)
            raw = (directory / "output.json").read_bytes()
            if len(raw) > MAX_RESULT_BYTES: raise ApiError(413, "executor_output_limit", "执行输出超过容量。")
            from .contracts import strict_json
            result = strict_json(raw.decode("utf-8"))
            if process.returncode or not isinstance(result, dict) or "error" in result:
                error = result.get("error", {}) if isinstance(result, dict) else {}
                code = error.get("code", "executor_failed")
                raise ApiError(422, code if isinstance(code, str) and len(code) <= 64 else "executor_failed", "节点计算未完成，请检查配置。")
            if "output" not in result or not isinstance(result.get("ports"), dict): raise ApiError(502, "invalid_executor_result", "执行器返回格式无效。")
            return result
        except (OSError, ValueError, subprocess.SubprocessError):
            raise ApiError(503, "worker_unavailable", "固定执行器启动失败。") from None
        finally:
            try:
                if process: stop_process(process)
            finally:
                if job: job.close()


class WorkflowRuntime:
    def __init__(self, settings, engine, provider=None):
        self.settings, self.engine = settings, engine
        self.provider = provider or (FixtureProvider() if settings.provider_mode == "fixture" else LiveProvider())
        self.compiler = LatexCompiler(settings)

    def session(self, uid):
        session = DBSession(self.engine, expire_on_commit=False); scoped(session, uid, True); return session

    def claim_next(self, lane):
        """Persist dispatch and a fenced node lease in one short transaction.

        A capacity lock serializes only claim/count checks, never calculation or
        provider I/O. All worker processes sharing a schema observe one 4/2 cap.
        Outbox/run/node locks use SKIP LOCKED so a busy run cannot stall others.
        """
        if lane not in ("compute", "model"): raise ValueError("Unknown workflow lane")
        with self.session("") as session:
            if not session.scalar(sql_text("SELECT pg_try_advisory_xact_lock(hashtextextended(current_database() || '/' || current_schema() || '/evix_capacity/' || :lane, 0))"), {"lane": lane}):
                return None
            lane_filter = WorkflowNodeRun.kind.in_(MODEL_KINDS) if lane == "model" else WorkflowNodeRun.kind.not_in(MODEL_KINDS)
            maximum = self.settings.workflow_parallel_model if lane == "model" else self.settings.workflow_parallel_compute
            active = session.scalar(select(func.count()).select_from(WorkflowNodeRun).where(WorkflowNodeRun.status.in_(("claimed", "running")), lane_filter))
            if active >= maximum: return None
            candidates = session.scalars(select(WorkflowOutbox).join(WorkflowNodeRun, WorkflowNodeRun.id == WorkflowOutbox.node_run_id)
                .join(WorkflowRun, WorkflowRun.id == WorkflowOutbox.run_id)
                .where(WorkflowOutbox.available_at <= now(), WorkflowNodeRun.status == "queued", WorkflowNodeRun.attempt == WorkflowOutbox.attempt, lane_filter)
                .order_by(WorkflowOutbox.available_at, WorkflowOutbox.id).limit(32).with_for_update(of=(WorkflowOutbox, WorkflowRun), skip_locked=True)).all()
            for item in candidates:
                run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == item.run_id).with_for_update(skip_locked=True))
                if run is None: continue
                node = session.scalar(select(WorkflowNodeRun).where(WorkflowNodeRun.id == item.node_run_id).with_for_update(skip_locked=True).execution_options(populate_existing=True))
                if node is None or node.status != "queued" or node.attempt != item.attempt or run.user_id != item.user_id: continue
                scoped(session, item.user_id, True)
                if run.cancel_requested:
                    reconcile(session, run, self.settings); session.commit(); return None
                try: authorize(session, run, self.settings)
                except ApiError as error:
                    node.status, node.error_code, node.finished_at = "failed", error.code, now()
                    reconcile(session, run, self.settings); session.commit(); return None
                token = new_id()
                node.status, node.started_at = "claimed", None
                node.lease_token, node.lease_until = token, now() + timedelta(seconds=self.settings.workflow_lease_seconds)
                item.sent_at = now()
                append_event(session, run, "node_claimed", node, {"attempt": node.attempt, "transport": "postgres"})
                claim = NodeClaim(item.id, node.id, item.user_id, node.attempt, token, lane)
                session.commit(); return claim
        return None

    def renew_claim(self, claim):
        """An expired, cancelled or replaced token can never renew itself."""
        with self.session(claim.user_id) as session:
            node = session.get(WorkflowNodeRun, claim.node_run_id)
            if node is None: return False
            run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == node.run_id).with_for_update(skip_locked=True))
            if run is None: return None  # Busy transaction: retry, do not extend blindly.
            node = session.scalar(select(WorkflowNodeRun).where(WorkflowNodeRun.id == claim.node_run_id).with_for_update().execution_options(populate_existing=True))
            if node.attempt != claim.attempt or not valid_lease(node, claim.lease_token, ("claimed", "running")) or run.cancel_requested: return False
            try: authorize(session, run, self.settings)
            except ApiError: return False
            node.lease_until = now() + timedelta(seconds=self.settings.workflow_lease_seconds)
            session.commit(); return True

    def execute_claim(self, claim):
        self.execute(claim.node_run_id, claim.user_id, claim.attempt, lease_token=claim.lease_token)

    def execute(self, node_run_id, user_id, expected_attempt, *, lease_token=None):
        """Duplicate delivery loses the row-lock/lease race and performs no work."""
        with self.session(user_id) as session:
            node = session.get(WorkflowNodeRun, node_run_id)
            if node is None: return
            run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == node.run_id).with_for_update())
            node = session.scalar(select(WorkflowNodeRun).where(WorkflowNodeRun.id == node_run_id).with_for_update().execution_options(populate_existing=True))
            if run.user_id != user_id or node.attempt != expected_attempt: return
            if lease_token is None and node.status != "queued" or lease_token is not None and not valid_lease(node, lease_token, ("claimed",)): return
            if run.cancel_requested:
                if lease_token is not None:
                    node.status, node.error_code, node.finished_at = "cancelled", "cancelled_by_user", now()
                    node.lease_token, node.lease_until = None, None
                    append_event(session, run, "node_cancelled", node)
                reconcile(session, run, self.settings); session.commit(); return
            try: authorize(session, run, self.settings)
            except ApiError as error:
                node.status, node.error_code, node.finished_at = "failed", error.code, now()
                node.lease_token, node.lease_until = None, None
                reconcile(session, run, self.settings); session.commit(); return
            token = lease_token or new_id()
            if lease_token is None:
                node.lease_token, node.lease_until = token, now() + timedelta(seconds=self.settings.workflow_lease_seconds)
            node.status, node.started_at = "running", now()
            append_event(session, run, "node_running", node, {"attempt": node.attempt})
            reconcile(session, run, self.settings)
            session.commit()
            config, inputs, manifest = config_for(run, node), node.inputs or {}, run.manifest
            kind, run_id, node_id = node.kind, run.id, node.node_id
        output, error, state = None, None, "succeeded"
        try:
            if self.settings.workflow_execution_profile == "first_release" and not validate_graph(manifest["definition"], catalog(self.settings)[1], manifest["nodeIds"], "first_release")["valid"]:
                raise ApiError(422, "capability_deferred", "当前运行包含尚未开放的执行能力。")
            if executor_fingerprint(self.settings) != manifest["executorHash"] or fingerprint(catalog(self.settings)[0]) != manifest["catalogHash"]:
                raise ApiError(409, "executor_revision_changed", "执行器版本已变化，请使用原执行版本恢复或创建新运行。")
            output, state = self.perform(run_id, node_run_id, user_id, token, kind, node_id, config, inputs, manifest)
        except ProviderFailure as failure:
            error, state = failure.code, "outcome_unknown" if failure.unknown else "failed"
        except ApiError as failure: error, state = failure.code, "failed"
        except Exception: error, state = "executor_failure", "failed"
        with self.session(user_id) as session:
            run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == run_id).with_for_update())
            node = session.scalar(select(WorkflowNodeRun).where(WorkflowNodeRun.id == node_run_id).with_for_update())
            if not valid_lease(node, token): return
            try: authorize(session, run, self.settings)
            except ApiError as failure: output, state, error = None, "outcome_unknown" if state == "outcome_unknown" else "failed", failure.code
            if run.cancel_requested and state not in ("outcome_unknown",):
                output, state, error = None, "cancelled", "cancelled_by_user"
            node.result, node.status, node.error_code = output, state, error
            node.lease_token, node.lease_until = None, None
            node.finished_at = None if state in ("waiting_input", "waiting_data", "wait_expired") else now()
            append_event(session, run, "node_" + state, node, {"result": output, "errorCode": error})
            if state == "waiting_data": poll_wait(session, run, node, self.settings)
            reconcile(session, run, self.settings); session.commit()

    def perform(self, run_id, nrid, uid, token, kind, nid, config, inputs, manifest):
        if kind in MODEL_KINDS:
            if kind == "silicon": return self.simulated(run_id, nrid, uid, token, config, inputs, manifest), "succeeded"
            forbid_raw_model_input(inputs)
            prompt = config.get("prompt", "") + "\n输入版本：" + canonical(inputs)
            text(prompt, 60000, 1)
            if kind == "questionnaire_generate":
                raw = self.external(nrid, uid, token, manifest["services"][nid], "questionnaire", prompt, None)
                design = parse_proposal(raw)
                # Preserve a native proposal row so the existing editor can load
                # and apply it. Its base head is frozen at run creation.
                with self.session(uid) as session:
                    run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == run_id).with_for_update()); authorize(session, run, self.settings)
                    live = session.get(WorkflowNodeRun, nrid)
                    if not valid_lease(live, token) or run.cancel_requested:
                        raise ApiError(409, "run_cancelled", "运行已取消或租约失效。")
                    base = manifest.get("questionnaireRevision", 0)
                    proposal = session.scalar(select(Proposal).where(Proposal.user_id == uid, Proposal.project_id == run.project_id, Proposal.idempotency_key == nrid))
                    if proposal is None:
                        proposal = Proposal(id=new_id(), user_id=uid, project_id=run.project_id, service_id=manifest["services"][nid]["serviceId"],
                                        service_revision=manifest["services"][nid]["serviceRevision"], input_revision=base,
                                        idempotency_key=nrid, payload_hash=fingerprint(prompt), status="ready", design=design, dispatched_at=now(), finished_at=now())
                        session.add(proposal)
                    session.commit()
                return response({"kind": "questionnaire", "design": design, "proposed": True, "proposalId": proposal.id, "inputRevision": base, "hash": fingerprint(design)}, "questionnaire"), "succeeded"
            raw = self.external(nrid, uid, token, manifest["services"][nid], kind, prompt, {"mode": "workflow_text", "questions": []})
            text(raw, 12000)
            return response({"kind": "text", "text": raw, "proposed": True, "classification": classification(inputs), "hash": fingerprint(raw),
                             "source": {"runId": run_id, "nodeId": nid, "inputHash": fingerprint(inputs)}}, "text"), "succeeded"
        if kind in ("dataset", "questionnaire", "material", "report"):
            with self.session(uid) as session:
                run = session.get(WorkflowRun, run_id); authorize(session, run, self.settings)
                frozen = manifest["frozen"].get(nid, {})
                if kind == "dataset":
                    row = session.get(DatasetVersion, frozen["datasetVersionId"])
                    if row is None or row.content_hash != frozen["hash"]: raise ApiError(409, "input_hash_conflict", "数据版本已变化。")
                    return response(dataset_descriptor(row), "dataset"), "succeeded"
                if kind == "questionnaire":
                    version = session.get(Version, frozen["versionId"])
                    if version is None or version.design_hash != frozen["hash"]: raise ApiError(409, "input_hash_conflict", "问卷版本已变化。")
                    return response({"kind": "questionnaire", "versionId": version.id, "revision": version.revision, "hash": version.design_hash, "design": version.design}, "questionnaire"), "succeeded"
                if kind == "material":
                    # Material content is an explicitly supplied citation/text;
                    # never claim an unavailable attachment has been inspected.
                    value = config.get("text", ""); text(value, 12000, 1)
                    return response({"kind": "material", "text": value, "source": config.get("source", ""), "hash": fingerprint(config)}, "material"), "succeeded"
                if frozen:
                    version = session.get(ReportVersion, frozen["versionId"])
                    if version is None or version.content_hash != frozen["hash"]: raise ApiError(409, "input_hash_conflict", "报告版本已变化。")
                    return response({"kind": "report", "versionId": version.id, "revision": version.revision, "hash": version.content_hash, "content": version.content,
                                     "classification": frozen.get("classification", "unknown"), "source": frozen.get("source", {})}, "report"), "succeeded"
                previous = session.scalar(select(ReportVersion).where(ReportVersion.project_id == run.project_id).order_by(ReportVersion.revision.desc()).limit(1))
                content = self.report_proposal(inputs, previous)
                previous_evidence = session.get(ReportProvenance, previous.id) if previous else None
                prior = {"versionId": previous.id, "classification": previous_evidence.classification if previous_evidence else "unknown", "source": previous_evidence.source if previous_evidence else {}} if previous else None
                return {"proposal": {"kind": "report", "content": content, "expectedRevision": previous.revision if previous else 0, "inputHash": fingerprint(inputs),
                                     "classification": classification([inputs, prior]), "previousProvenance": prior}}, "waiting_input"
        if kind in ("review", "claim", "survey_publish", "survey_wait"):
            if kind == "survey_wait":
                target, deadline = config.get("targetCount"), config.get("deadline")
                if target is not None: integer(target, 1, 5000)
                if deadline:
                    try:
                        parsed = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
                        if parsed.tzinfo is None: raise ValueError()
                    except (ValueError, TypeError): raise ApiError(422, "invalid_deadline", "回收期限须包含时区。") from None
                return {"waiting": {"targetCount": target, "deadline": deadline}}, "waiting_data"
            return {"proposal": {"kind": kind, "inputHash": fingerprint(inputs), "summary": redact(inputs), "text": config.get("text", "")}}, "waiting_input"
        if kind == "pdf":
            file = inputs.get("file", {})
            source = file.get("source") or file.get("text")
            if not isinstance(source, str): raise ApiError(422, "latex_source_required", "PDF节点需要LaTeX源码版本。")
            start, end = source.find("% BODY START\n"), source.find("% BODY END")
            if start < 0 or end < start: raise ApiError(422, "latex_source_required", "源码不是已注册报告模板。")
            body = source[start + len("% BODY START\n"):end]
            settings = file.get("options") or {"part": "main", "includeCover": True, "includeToc": True, "firstLineChars": 2, "numberPages": True}
            result = self.compiler.compile(file.get("title", "研究报告"), file.get("subtitle", ""), body, settings)
            if result["status"] != "compiled": raise ApiError(503 if result["status"] == "unavailable" else 422, "latex_" + result["status"], "PDF编译未完成，请查看LaTeX工作台。")
            artifact = {"kind": "file", "filename": "研究报告.pdf", "mime": "application/pdf", "base64": result["pdfBase64"], "sourceHash": result["sourceHash"], "diagnostics": result["diagnostics"], "classification": file.get("classification", "unknown")}
            return self.persist_files(run_id, nid, uid, response(artifact, "file"), nrid, token), "succeeded"
        if kind == "chart":
            source_result = inputs.get("result", {})
            if isinstance(source_result.get("results"), list):
                source_result = next((member.get("value", {}) for member in source_result["results"] if member.get("name") == config.get("resultName")), {})
            ref = source_result.get("source", {}).get("datasetRef", {})
            if ref.get("id"):
                with self.session(uid) as session:
                    run = session.get(WorkflowRun, run_id); authorize(session, run, self.settings)
                    row = session.get(DatasetVersion, ref["id"])
                    if row and row.project_id == run.project_id and row.content_hash == ref.get("hash"):
                        inputs = {**inputs, "__dataset": dataset_descriptor(row)}
        result = run_node_process(self.settings, kind, config, inputs)
        if kind == "latex":
            content = inputs.get("report", {}).get("content", {})
            descriptor = {**result["output"], "title": content.get("title", "研究报告"), "subtitle": content.get("subtitle", ""),
                          "options": content.get("reportFormat", {}).get("options", {"part": "main", "includeCover": True, "includeToc": True, "firstLineChars": 2, "numberPages": True})}
            result = {**result, "output": descriptor, "ports": {"file": descriptor}}
        return self.persist_files(run_id, nid, uid, result, nrid, token), "succeeded"

    def external(self, nrid, uid, token, binding, call_key, message, spec):
        """Store dispatched marker before I/O; unknown markers prohibit replay."""
        with self.session(uid) as session:
            node = session.get(WorkflowNodeRun, nrid)
            run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == node.run_id).with_for_update())
            authorize(session, run, self.settings)
            if not valid_lease(node, token) or run.cancel_requested:
                raise ApiError(409, "run_cancelled", "运行已取消或租约失效。")
            old = session.scalar(select(WorkflowCall).where(WorkflowCall.node_run_id == nrid, WorkflowCall.call_key == call_key).with_for_update())
            if old:
                if old.status == "completed": return old.output["text"]
                raise ProviderFailure(old.error_code or "provider_timeout", unknown=old.status in ("dispatched", "outcome_unknown"))
            service = session.scalar(select(Service).where(Service.id == binding["serviceId"], Service.user_id == uid, Service.deleted.is_(False)).with_for_update())
            if service is None: raise ApiError(403, "service_revoked", "个人模型服务已撤销。")
            if service.revision != binding["serviceRevision"]: raise ApiError(409, "service_revision_changed", "模型配置已变化。")
            key, config = decrypt(self.settings, service), config_view(service)
            if key in message: raise ApiError(422, "sensitive_input", "模型输入包含服务密钥。")
            receipt = WorkflowCall(id=new_id(), project_id=run.project_id, node_run_id=nrid, call_key=call_key, status="dispatched",
                                   service_id=service.id, service_revision=service.revision, input_hash=fingerprint(message))
            session.add(receipt); node.lease_until = now() + timedelta(seconds=self.settings.workflow_lease_seconds); session.commit()
        raw, failure = None, None
        async def ask():
            async with asyncio.timeout(self.settings.silicon_call_seconds):
                return await self.provider(config, key, message) if spec is None else await self.provider.answer(config, key, message, spec)
        try:
            raw = asyncio.run(ask())
            if not isinstance(raw, str) or key in raw: raise ProviderFailure("invalid_response")
        except ProviderFailure as error: failure = error
        except (TimeoutError, asyncio.CancelledError): failure = ProviderFailure("provider_timeout", unknown=True)
        except Exception: failure = ProviderFailure("provider_failure", unknown=True)
        finally: key = ""
        with self.session(uid) as session:
            node = session.get(WorkflowNodeRun, nrid)
            run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == node.run_id).with_for_update())
            receipt = session.scalar(select(WorkflowCall).where(WorkflowCall.id == receipt.id).with_for_update())
            if receipt.status == "dispatched" and valid_lease(node, token):
                receipt.status = "outcome_unknown" if failure and failure.unknown else "failed" if failure else "completed"
                receipt.error_code, receipt.output, receipt.finished_at = failure.code if failure else None, {"text": raw} if raw is not None else None, now()
            else:
                # A lease sweeper may already have sealed outcome_unknown. A
                # late response is retained for reconciliation, never applied.
                receipt.output = {"text": raw, "late": True} if raw is not None else receipt.output
                if receipt.status == "dispatched":
                    receipt.status, receipt.error_code, receipt.finished_at = "outcome_unknown", "interrupted_call", now()
            session.commit()
        if failure: raise failure
        return raw

    def simulated(self, run_id, nrid, uid, token, config, inputs, manifest):
        q = inputs.get("questionnaire", {}).get("design")
        questionnaire(q)
        persona_value = inputs.get("persona", {})
        candidates = persona_value.get("personas") or persona_value.get("data") or []
        if isinstance(candidates, dict): candidates = candidates.get("personas", [])
        if not isinstance(candidates, list) or not candidates: raise ApiError(422, "persona_required", "请配置样本人设。")
        count = integer(config.get("count", len(candidates)), 1, min(200, self.settings.silicon_max_calls))
        if count > len(candidates): raise ApiError(422, "persona_count", "样本数量超过已配置的人设，请补充人设。")
        binding = manifest["services"][next(n["id"] for n in manifest["definition"]["nodes"] if n["kind"] == "silicon" and n["id"] == self.node_id(nrid, uid))]
        rows = []
        for index, persona in enumerate(candidates[:count]):
            if not isinstance(persona, dict): raise ApiError()
            clean = {"id": str(persona.get("id", index)), "code": str(persona.get("code", index + 1)),
                     "traits": persona.get("traits", {}), "background": persona.get("background", "")}
            if not isinstance(clean["traits"], dict): raise ApiError()
            attrs = [{"key": key, "label": key} for key in clean["traits"]]
            plan = {"design": q, "attributes": attrs, "memory": "carry", "shuffleOptions": False}
            spec = {"mode": "carry", "questions": [silicon.question_spec(item) for item in q["questions"]]}
            prompt = silicon.carry_prompt(plan, clean, None) + "\n" + config.get("prompt", "")
            raw = self.external(nrid, uid, token, binding, "persona:" + str(index), prompt, spec)
            answers = silicon.assemble_carry(q, silicon.parse_carry(raw, q))
            rows.append(["" if a.get("value") is None else ";".join(a["value"]) if isinstance(a["value"], list) else str(a["value"]) for a in answers])
        with self.session(uid) as session:
            run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == run_id).with_for_update()); authorize(session, run, self.settings)
            node = session.get(WorkflowNodeRun, nrid)
            if not valid_lease(node, token) or run.cancel_requested: raise ApiError(409, "run_cancelled", "运行已取消或租约失效。")
            value = create_dataset(session, run, q["title"] + " · 硅基样本", "simulated", {"table": {"headers": [item["variable"] for item in q["questions"]], "rows": rows, "skippedBlankLines": 0, "delimiter": ","},
                "mapping": {"design": q, "assignments": [{"questionId": item["id"], "column": item["variable"], "representation": "code"} for item in q["questions"]], "confirmed": True}, "design": q, "routing": {"policy": "exclude", "confirmed": True}}, origin=node)
            session.commit(); return response(value, "dataset")

    def node_id(self, nrid, uid):
        with self.session(uid) as session: return session.get(WorkflowNodeRun, nrid).node_id

    def persist_files(self, run_id, nid, uid, result, nrid, token):
        output = result.get("output", {})
        if not isinstance(output, dict) or output.get("kind") != "file": return result
        payload = output.get("base64") or output.get("contentBase64")
        source = output.get("source") or output.get("text")
        if not payload and not isinstance(source, str): return result
        try: data = base64.b64decode(payload, validate=True) if payload else source.encode("utf-8")
        except (ValueError, TypeError): raise ApiError(422, "invalid_export", "导出文件内容无效。") from None
        if not 0 < len(data) <= 12 * 1024 * 1024: raise ApiError(413, "export_limit", "导出文件超过12 MiB。")
        with self.session(uid) as session:
            run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == run_id).with_for_update()); authorize(session, run, self.settings)
            live = session.get(WorkflowNodeRun, nrid)
            if run.cancel_requested or not valid_lease(live, token): raise ApiError(409, "run_cancelled", "运行已取消或租约失效。")
            filename = str(output.get("filename") or output.get("name") or "export.bin"); text(filename, 160, 1)
            file = session.scalar(select(WorkflowFile).where(WorkflowFile.run_id == run_id, WorkflowFile.node_id == nid))
            if file:
                if file.input_hash != live.input_hash: raise ApiError(409, "input_hash_conflict", "导出成果的冻结输入不一致。")
            else:
                file = WorkflowFile(id=new_id(), project_id=run.project_id, run_id=run_id, node_id=nid, filename=filename,
                                    mime=output.get("mime") or output.get("mediaType") or "application/octet-stream", content_hash=hashlib.sha256(data).hexdigest(), content=data, input_hash=live.input_hash)
                session.add(file)
            session.commit()
        descriptor = {**{k: v for k, v in output.items() if k not in ("base64", "contentBase64")}, "id": file.id, "hash": file.content_hash,
                      "downloadUrl": f"/api/projects/{run.project_id}/workflow/files/{file.id}", "size": len(file.content)}
        return {**result, "output": descriptor, "ports": {"file": descriptor}}

    def report_proposal(self, inputs, previous):
        content = __import__("copy").deepcopy(previous.content) if previous else {"version": 1, "title": "研究报告", "subtitle": "", "accent": "teal", "report": [], "slides": []}
        incoming = inputs.get("text", {})
        text_content = incoming.get("text", "") if isinstance(incoming, dict) else str(incoming)
        evidence = inputs.get("result", {})
        if not text_content:
            if isinstance(evidence.get("results"), list):
                text_content = "\n".join(str(member.get("name", "")) + "：有效样本 " + str(member.get("value", {}).get("data", {}).get("n", "待核对")) + "；" +
                    "；".join(str(metric.get("label", "")) + "：" + ("未定义" if metric.get("value") is None else str(metric["value"])) for metric in member.get("value", {}).get("data", {}).get("metrics", []) if isinstance(metric, dict))
                    for member in evidence["results"] if isinstance(member, dict))
            summary = evidence.get("summary")
            if not text_content and isinstance(summary, dict):
                metrics = summary.get("metrics", [])
                text_content = "有效样本：" + str(summary.get("n", "待核对")) + "。" + "；".join(str(item.get("label", "")) + "：" + ("未定义" if item.get("value") is None else str(item["value"])) for item in metrics if isinstance(item, dict))
            elif not text_content: text_content = summary if isinstance(summary, str) and summary else "请根据当前证据撰写本节内容。"
        source = canonical(redact({"text": incoming.get("source") if isinstance(incoming, dict) else None, "result": evidence.get("source"), "chart": inputs.get("chart", {}).get("source")}))[:1500]
        content["report"].append({"id": new_id(), "title": "研究发现", "body": text_content[:12000], "source": source})
        if not content["slides"]:
            content["slides"] = [{"id": new_id(), "title": content["title"], "body": text_content[:1800], "aside": "", "notes": "", "layout": "cover"}]
        return report_content(content)

    def recover(self):
        """Restart recovery: requeue pure jobs, seal uncertain external calls, wake waits."""
        with DBSession(self.engine, expire_on_commit=False) as discovery:
            discovery.execute(sql_text("SELECT set_config('evix.workflow_worker','on',true)"))
            ids = discovery.execute(select(WorkflowRun.id, WorkflowRun.user_id).where(WorkflowRun.status.in_(("running", "queued", "waiting", "outcome_unknown")))).all()
        for rid, uid in ids:
            with self.session(uid) as session:
                run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == rid).with_for_update(skip_locked=True))
                if run is None: continue
                nodes = session.scalars(select(WorkflowNodeRun).where(WorkflowNodeRun.run_id == rid)).all()
                try: authorize(session, run, self.settings)
                except ApiError:
                    for n in nodes:
                        if n.status not in TERMINAL:
                            calls = session.scalars(select(WorkflowCall).where(WorkflowCall.node_run_id == n.id, WorkflowCall.status == "dispatched")).all()
                            n.status = "outcome_unknown" if calls else "failed"
                            n.error_code, n.finished_at = "permission_revoked", now()
                            for call in calls: call.status, call.error_code, call.finished_at = "outcome_unknown", "provider_failure", now()
                    reconcile(session, run, self.settings); session.commit(); continue
                for node in nodes:
                    if node.status in ("claimed", "running") and node.lease_until and node.lease_until <= now():
                        calls = session.scalars(select(WorkflowCall).where(WorkflowCall.node_run_id == node.id, WorkflowCall.status.in_(("dispatched", "outcome_unknown")))).all()
                        node.lease_token, node.lease_until = None, None
                        if calls:
                            node.status, node.error_code, node.finished_at = "outcome_unknown", "interrupted_call", now()
                            for call in calls:
                                if call.status == "dispatched": call.status, call.error_code, call.finished_at = "outcome_unknown", "provider_failure", now()
                            append_event(session, run, "node_outcome_unknown", node)
                        else:
                            # Completed model receipts are reused by external();
                            # only work with no outstanding call can be recovered.
                            node.status, node.error_code = "pending", None
                            append_event(session, run, "node_recovered", node)
                    if node.status in ("waiting_data", "wait_expired"): poll_wait(session, run, node, self.settings)
                reconcile(session, run, self.settings); session.commit()

    def pending_messages(self, limit=100):
        with DBSession(self.engine, expire_on_commit=False) as session:
            session.execute(sql_text("SELECT set_config('evix.workflow_worker','on',true)"))
            rows = session.execute(select(WorkflowOutbox.id, WorkflowOutbox.node_run_id, WorkflowOutbox.user_id, WorkflowOutbox.attempt)
                                   .join(WorkflowNodeRun, WorkflowNodeRun.id == WorkflowOutbox.node_run_id)
                                   .where(WorkflowOutbox.available_at <= now(), WorkflowNodeRun.status == "queued", WorkflowNodeRun.attempt == WorkflowOutbox.attempt,
                                          (WorkflowOutbox.sent_at.is_(None) | (WorkflowOutbox.sent_at < now() - timedelta(seconds=30))))
                                   .order_by(WorkflowOutbox.available_at).limit(limit)).all()
            return rows

    def acknowledge_dispatch(self, outbox_id):
        with DBSession(self.engine) as session:
            session.execute(sql_text("SELECT set_config('evix.workflow_worker','on',true)"))
            item = session.get(WorkflowOutbox, outbox_id)
            if item: item.sent_at = now(); session.commit()

    def drain_for_test(self, maximum=200):
        """Explicit synchronous synthetic-test helper; API never calls this."""
        if self.settings.mode != "local_test": raise ValueError("Test drain is local_test only")
        for _ in range(maximum):
            claim = self.claim_next("compute") or self.claim_next("model")
            if claim is None: return
            self.execute_claim(claim)
        raise RuntimeError("Synthetic workflow did not settle within bound")
