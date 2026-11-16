"""Project workflows: immutable manifests, typed graphs and durable task receipts."""
import asyncio
import csv
import io
import json
import math
from datetime import timedelta, timezone
from pathlib import Path
import re
from urllib.parse import quote

from fastapi import Depends, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, text as sql_text
from sqlalchemy.orm import Session as DBSession

from .contracts import ApiError, body, canonical, fingerprint, integer, object_fields, text, uuid_string
from .models import Project, Service, Version, SurveyRelease, now, new_id
from .reports import ReportVersion
from .workflow_models import (WorkflowVersion, WorkflowLayout, WorkflowView, DatasetVersion, WorkflowRun,
                              WorkflowNodeRun, WorkflowEvent, WorkflowOutbox, WorkflowFile, WorkflowGraphProposal, ReportProvenance)

SCHEMA = "research-workflow/v1"
EMPTY = {"schemaVersion": SCHEMA, "nodes": [], "edges": []}
EMPTY_LAYOUT = {"positions": {}, "groups": []}
MAX_NODES, MAX_EDGES, MAX_EXECUTION = 200, 500, 50
MODEL_KINDS = {"model", "questionnaire_generate", "silicon", "defense"}
DEFERRED_KINDS = {"condition", "collect", "survey_wait"}
ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
RESERVED = {"__proto__", "constructor", "prototype"}


def iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value else None


def catalog(settings=None):
    path = Path(settings.workflow_catalog_path) if settings and settings.workflow_catalog_path else Path(__file__).resolve().parents[4] / "packages/evi-x-shared/src/workflow-catalog.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value, {item["kind"]: item for item in value["nodes"]}
    except (OSError, ValueError, KeyError, TypeError):
        raise ApiError(503, "catalog_unavailable", "研究节点目录尚未就绪。") from None


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value) or value in RESERVED:
        raise ApiError(422, "invalid_graph", "节点或端口标识无效。")
    return value


def definition(value, kinds):
    object_fields(value, ("schemaVersion", "nodes", "edges"))
    if value["schemaVersion"] != SCHEMA or not isinstance(value["nodes"], list) or not isinstance(value["edges"], list):
        raise ApiError(422, "invalid_graph", "流程格式无效。")
    if len(value["nodes"]) > MAX_NODES or len(value["edges"]) > MAX_EDGES or len(canonical(value).encode("utf-8")) > 500000:
        raise ApiError(413, "graph_too_large", "流程超过200个节点或500条连线。")
    ids = set()
    for node in value["nodes"]:
        object_fields(node, ("id", "kind", "title", "config"), ("disabled",))
        identifier(node["id"]); text(node["title"], 160)
        if node["id"] in ids or node["kind"] not in kinds or not isinstance(node["config"], dict) or len(canonical(node["config"]).encode("utf-8")) > 100000:
            raise ApiError(422, "invalid_graph", "节点类型、配置或标识无效。")
        if "disabled" in node and type(node["disabled"]) is not bool:
            raise ApiError()
        # Workflow definitions must never persist credentials or raw answer rows.
        if forbidden_config(node["config"]):
            raise ApiError(422, "sensitive_config", "流程配置不能包含密钥或原始答卷，请使用数据版本引用。")
        safe_config(node["config"])
        if config_issues(node, kinds[node["kind"]], False):
            raise ApiError(422, "invalid_config", "节点配置字段或数值格式不正确。")
        ids.add(node["id"])
    edges = set()
    for edge in value["edges"]:
        object_fields(edge, ("id", "source", "sourcePort", "target", "targetPort", "kind"))
        for key in ("id", "source", "target"):
            identifier(edge[key])
        if edge["id"] in edges or edge["source"] not in ids or edge["target"] not in ids or edge["kind"] not in ("data", "control", "reference"):
            raise ApiError(422, "invalid_graph", "连线引用了未知节点。")
        for key in ("sourcePort", "targetPort"):
            text(edge[key], 64)
        edges.add(edge["id"])
    return value


def forbidden_config(value):
    if isinstance(value, dict):
        return any(k in RESERVED or k.lower().replace("_", "") in ("apikey", "secret", "token", "authorization", "password", "ciphertext", "csv", "rows", "answers", "responses", "rawanswers", "rawresponses")
                   or forbidden_config(v) for k, v in value.items())
    if isinstance(value, list):
        return any(forbidden_config(v) for v in value)
    return False


def safe_config(value, depth=0):
    if depth > 16: raise ApiError(422, "invalid_config", "节点配置嵌套过深。")
    if value is None or type(value) is bool: return
    if isinstance(value, str): text(value, 120000); return
    if type(value) in (int, float):
        if not math.isfinite(value) or abs(value) > 1e12: raise ApiError()
        return
    if isinstance(value, list):
        if len(value) > 5000: raise ApiError()
        for item in value: safe_config(item, depth + 1)
        return
    if isinstance(value, dict):
        for item in value.values(): safe_config(item, depth + 1)
        return
    raise ApiError()


def config_issues(node, spec, for_run):
    config, issues = node["config"], []
    allowed = {f["key"] for f in spec.get("configFields", [])} | {"legacySource"}
    if any(k not in allowed for k in config): issues.append({"code": "unknown_config", "message": "节点包含未登记配置字段。"})
    for field in spec.get("configFields", []):
        value = config.get(field["key"])
        if value is None or value == "":
            if for_run and field.get("required"): issues.append({"code": "missing_config", "message": "请配置：" + field["label"]})
            continue
        kind = field["type"]
        valid = ((kind == "text" and isinstance(value, str) and len(value.encode("utf-16-le")) // 2 <= field.get("maxLength", 120000))
                 or (kind == "number" and type(value) in (float, int) and math.isfinite(value) and field.get("min", -1e12) <= value <= field.get("max", 1e12))
                 or (kind == "boolean" and type(value) is bool) or kind == "json"
                 or (kind == "select" and isinstance(value, str) and value in field.get("options", [])))
        if not valid: issues.append({"code": "invalid_config", "message": "配置格式不正确：" + field["label"]})
    if for_run:
        kind = node["kind"]
        if kind in ("frequency", "numeric", "grouped", "crosstab", "pearson", "spearman"):
            x, y = config.get("x"), config.get("y")
            if type(x) is not int or not 0 <= x <= 79: issues.append({"code": "missing_variable", "message": "请选择有效变量X。"})
            if kind not in ("frequency", "numeric") and (type(y) is not int or not 0 <= y <= 79 or y == x): issues.append({"code": "missing_variable", "message": "请选择另一个有效变量Y。"})
        if kind == "alpha":
            scale = config.get("scale") or {}
            if not isinstance(scale, dict) or not isinstance(scale.get("columns"), list) or not 2 <= len(scale["columns"]) <= 30 or not isinstance(scale.get("construct"), str) or not scale["construct"].strip():
                issues.append({"code": "missing_scale", "message": "请选择2–30个量表题项并填写共同构念。"})
        if (kind == "questionnaire" or kind == "report" and config.get("binding") == "pinned") and config.get("binding") != "head" and not config.get("artifactVersionId") and not config.get("artifactId"):
            issues.append({"code": "missing_artifact", "message": "请选择精确成果版本。"})
    return [{**i, "nodeId": node["id"]} for i in issues]


def validate_graph(value, kinds, selected=None, profile="extended"):
    definition(value, kinds)
    nodes = {n["id"]: n for n in value["nodes"] if not n.get("disabled") and n["kind"] != "note"}
    if selected is not None:
        if not isinstance(selected, list) or not selected or len(set(selected)) != len(selected) or any(n not in nodes for n in selected):
            raise ApiError(422, "invalid_selection", "请选择有效的研究节点。")
        planned = set(selected)
        changed = True
        while changed:
            changed = False
            for edge in value["edges"]:
                if edge["kind"] != "reference" and edge["target"] in planned and edge["source"] in nodes and edge["source"] not in planned:
                    planned.add(edge["source"]); changed = True
        nodes = {key: n for key, n in nodes.items() if key in planned}
    issues, incoming, outgoing = [], {key: [] for key in nodes}, {key: [] for key in nodes}
    if profile == "first_release":
        for key, node in nodes.items():
            if node["kind"] in DEFERRED_KINDS:
                issues.append({"code": "capability_deferred", "message": "此节点暂不参与后台执行；调查回收请在调查页面完成。", "nodeId": key})
    relationships = set()
    for edge in value["edges"]:
        if edge["kind"] == "reference" or edge["target"] not in nodes:
            continue
        if profile == "first_release" and edge["kind"] == "control":
            issues.append({"code": "capability_deferred", "message": "执行先后连线将在后续批次开放，请使用有明确数据端口的连接。", "edgeId": edge["id"]})
        relationship = (edge["kind"], edge["source"], edge["sourcePort"], edge["target"], edge["targetPort"])
        if relationship in relationships: issues.append({"code": "duplicate_edge", "message": "相同的输入输出关系不能重复连接。", "edgeId": edge["id"]})
        relationships.add(relationship)
        if edge["source"] not in nodes:
            issues.append({"code": "disabled_dependency", "message": "必要输入来自已停用节点或注释。", "edgeId": edge["id"], "nodeId": edge["target"]}); continue
        incoming[edge["target"]].append(edge); outgoing[edge["source"]].append(edge)
        if edge["kind"] == "data":
            outputs = {p["id"]: p for p in kinds[nodes[edge["source"]]["kind"]]["outputs"]}
            inputs = {p["id"]: p for p in kinds[nodes[edge["target"]]["kind"]]["inputs"]}
            source, target = outputs.get(edge["sourcePort"]), inputs.get(edge["targetPort"])
            if not source or not target or source["type"] not in ([target["type"]] + target.get("accepts", [])):
                issues.append({"code": "port_type", "message": "连线端口的数据类型不匹配。", "edgeId": edge["id"], "nodeId": edge["target"]})
    for key, node in nodes.items():
        spec = kinds[node["kind"]]
        for port in spec["inputs"]:
            matches = [e for e in incoming[key] if e["kind"] == "data" and e["targetPort"] == port["id"]]
            if port.get("required") and not matches:
                issues.append({"code": "missing_input", "message": "请连接必要输入：" + port["id"], "nodeId": key})
            if len(matches) > 1 and not port.get("multiple"):
                issues.append({"code": "multiple_input", "message": "这个输入端口只接受一个来源。", "nodeId": key})
        issues.extend(config_issues(node, spec, True))
        if node["kind"] == "report" and not node["config"].get("artifactVersionId") and not node["config"].get("artifactId") and node["config"].get("binding") != "head" and not any(e["kind"] == "data" for e in incoming[key]):
            issues.append({"code": "missing_input", "message": "请连接报告材料、结论或图表，或选择报告版本。", "nodeId": key})
        def grouped_output(nid, seen=None):
            seen = (seen or set()) | {nid}
            origin = nodes.get(nid)
            if origin is None: return False
            if origin["kind"] == "collect": return True
            return origin["kind"] == "review" and any(e["kind"] == "data" and e["target"] == nid and e["targetPort"] == "value" and e["source"] not in seen and grouped_output(e["source"], seen) for e in value["edges"])
        if node["kind"] in ("chart", "condition") and any(e["kind"] == "data" and e["targetPort"] == "result" and grouped_output(e["source"]) for e in incoming[key]) and (not isinstance(node["config"].get("resultName"), str) or not node["config"]["resultName"].strip()):
            issues.append({"code": "result_selection_required", "message": "请选择命名结果组中的一个成员。", "nodeId": key})
    degree = {key: len(incoming[key]) for key in nodes}
    order, ready = [], [key for key in nodes if degree[key] == 0]
    while ready:
        key = ready.pop(0); order.append(key)
        for edge in outgoing[key]:
            degree[edge["target"]] -= 1
            if degree[edge["target"]] == 0:
                ready.append(edge["target"])
    for key, count in degree.items():
        if count:
            issues.append({"code": "cycle", "message": "执行连线存在循环，请断开循环中的连接。", "nodeId": key})
    if len(nodes) > MAX_EXECUTION:
        issues.append({"code": "execution_limit", "message": "单次运行最多50个节点，请选择部分流程。"})
    if not nodes: issues.append({"code": "empty_workflow", "message": "请添加或选择至少一个可执行节点。"})
    return {"valid": not issues, "issues": issues, "nodeIds": order}


def layout(value):
    object_fields(value, ("positions", "groups"), ("revision",))
    if not isinstance(value["positions"], dict) or len(value["positions"]) > MAX_NODES or not isinstance(value["groups"], list) or len(value["groups"]) > 100:
        raise ApiError()
    for key, pos in value["positions"].items():
        identifier(key); object_fields(pos, ("x", "y"))
        if any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 10000000 for v in pos.values()):
            raise ApiError()
    ids, members = set(), set()
    for group in value["groups"]:
        object_fields(group, ("id", "title", "nodeIds", "collapsed"))
        identifier(group["id"]); text(group["title"], 160)
        if group["id"] in ids or type(group["collapsed"]) is not bool or not isinstance(group["nodeIds"], list) or len(set(group["nodeIds"])) != len(group["nodeIds"]):
            raise ApiError()
        for nid in group["nodeIds"]:
            identifier(nid)
            if nid in members: raise ApiError()
            members.add(nid)
        ids.add(group["id"])
    return {"positions": value["positions"], "groups": value["groups"]}


def parse_csv(value, delimiter=","):
    """Byte-for-byte parsing semantics of parseSurveyCsv, including empty records."""
    text(value, 2000000, 1)
    if len(value.encode("utf-8")) > 2000000: raise ApiError(413, "dataset_too_large", "数据文件超过2 MB。")
    if delimiter not in (",", "\t", ";"): raise ApiError(422, "invalid_csv", "请选择逗号、分号或制表符。")
    value = value[1:] if value.startswith("\ufeff") else value
    records, row, field, quoted, closed, touched, skipped = [], [], "", False, False, False, 0
    def field_end():
        nonlocal field, closed
        text(field, 2000); row.append(field); field = ""; closed = False
        if len(row) > 80: raise ApiError(422, "dataset_limits", "最多支持80列。")
    def row_end():
        nonlocal row, touched, skipped
        if not touched and not row and not field: skipped += 1; return
        field_end(); records.append(row); row = []; touched = False
        if len(records) > 5001 or len(records) * len(records[0]) > 200000 + len(records[0]):
            raise ApiError(422, "dataset_limits", "最多5000行及20万个数据单元格。")
    i = 0
    while i < len(value):
        c = value[i]
        if quoted:
            if c == '"':
                if i + 1 < len(value) and value[i + 1] == '"': field += '"'; i += 1
                else: quoted, closed = False, True
            else: field += c
        elif c == delimiter: field_end(); touched = True
        elif c in ("\n", "\r"):
            row_end()
            if c == "\r" and i + 1 < len(value) and value[i + 1] == "\n": i += 1
        elif closed: raise ApiError(422, "invalid_csv", "CSV引号后存在多余字符。")
        elif c == '"':
            if field: raise ApiError(422, "invalid_csv", "CSV引号位置无效。")
            quoted, touched = True, True
        else: field += c; touched = True
        if len(field) > 2000: raise ApiError(422, "dataset_limits", "单元格超过2000字。")
        i += 1
    if quoted: raise ApiError(422, "invalid_csv", "CSV双引号尚未闭合。")
    if touched or row or field or closed: row_end()
    if len(records) < 2: raise ApiError(422, "invalid_csv", "至少需要表头和一条答卷。")
    whitespace = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
    headers = [cell.strip(whitespace) for cell in records[0]]
    for h in headers: text(h, 120, 1)
    if len(set(headers)) != len(headers) or any(len(r) != len(headers) for r in records[1:]):
        raise ApiError(422, "invalid_csv", "表头重复或答卷行宽与表头不一致。")
    return {"headers": headers, "rows": records[1:], "skippedBlankLines": skipped, "delimiter": delimiter}


def executor_fingerprint(settings):
    """Bind the fixed entrypoint's local module graph and locked dependencies."""
    import hashlib
    root = Path(__file__).resolve().parents[4]
    pending = [Path(settings.workflow_executor_path).resolve(), Path(settings.workflow_catalog_path).resolve() if settings.workflow_catalog_path else root / "packages/evi-x-shared/src/workflow-catalog.json"]
    seen, files = set(), {}
    for name in ("package-lock.json", "apps/evi-x-platform/package.json"):
        p = root / name
        if p.is_file(): pending.append(p)
    for name in ("workflow_runner.py", "workflows.py", "contracts.py", "provider.py", "reports.py", "silicon.py", "latex.py", "security.py"):
        pending.append(Path(__file__).parent / name)
    pending.extend([root / "apps/evi-x-api/uv.lock", root / "apps/evi-x-api/pyproject.toml"])
    while pending:
        path = pending.pop().resolve()
        if path in seen: continue
        if not path.is_relative_to(root) or not path.is_file() or path.is_symlink():
            raise ApiError(503, "executor_unavailable", "执行器依赖不在已登记项目范围内。")
        seen.add(path); data = path.read_bytes()
        files[path.relative_to(root).as_posix()] = hashlib.sha256(data).hexdigest()
        if path.suffix in (".ts", ".tsx", ".js", ".mjs"):
            for _, target in re.findall(r"(?:from\s*|import\s*\(\s*|import\s*)(['\"])([^'\"]+)\1", data.decode("utf-8")):
                if not target.startswith("."): continue
                candidate = path.parent / target
                options = [candidate, *[Path(str(candidate) + ext) for ext in (".ts", ".tsx", ".js", ".mjs", ".json")]]
                resolved = next((p for p in options if p.is_file()), None)
                if resolved is None: raise ApiError(503, "executor_unavailable", "执行器模块尚未就绪。")
                pending.append(resolved)
    return fingerprint(files)


def dataset_view(row, full=False):
    result = {"id": row.id, "hash": row.content_hash, "rowCount": len(row.content["table"]["rows"]), "columns": row.content["table"]["headers"],
              "classification": row.classification, "sourceName": row.source_name, "createdAt": iso(row.created_at)}
    if full: result["content"] = row.content
    return result


def dataset_descriptor(row):
    return {"kind": "dataset", "datasetRef": {"id": row.id, "hash": row.content_hash, "classification": row.classification, "sourceName": row.source_name}, **row.content}


def redact(value, parent=""):
    """Only result summaries cross events; immutable raw tables remain private input refs."""
    if isinstance(value, dict):
        return {k: redact(v, k) for k, v in value.items() if k not in ("table", "originalTable", "csv", "answers", "responses", "pdfBase64", "contentBase64", "base64", "apiKey", "ciphertext", "inputs", "eligibleIndices", "rowIndices", "pairs", "distributions") and (k != "rows" or parent == "data")}
    if isinstance(value, list): return [redact(v, parent) for v in value]
    return value


def run_view(run, nodes, events=None):
    result = {"id": run.id, "projectId": run.project_id, "workflowVersionId": run.workflow_version_id, "status": run.status,
              "createdAt": iso(run.created_at), "updatedAt": iso(run.updated_at), "unknownCount": sum(n.status == "outcome_unknown" for n in nodes),
              "nodes": [{"nodeId": n.node_id, "kind": n.kind, "status": "queued" if n.status == "claimed" else n.status, "attempt": n.attempt,
                         "inputHash": n.input_hash, "result": redact(n.result), "errorCode": n.error_code,
                         "startedAt": iso(n.started_at), "finishedAt": iso(n.finished_at)} for n in nodes]}
    if events is not None: result["events"] = [event_view(e) for e in events]
    return result


def event_view(event):
    return {"sequence": event.sequence, "nodeId": event.node_id, "type": event.type, "at": iso(event.created_at), "payload": redact(event.payload)}


def append_event(session, run, event_type, node=None, payload=None):
    run.event_sequence += 1; run.updated_at = now()
    session.add(WorkflowEvent(project_id=run.project_id, run_id=run.id, sequence=run.event_sequence,
                              node_id=node.node_id if node else None, type=event_type, payload=redact(payload or {})))


def aggregate_status(nodes, cancelled=False):
    states = [n.status if hasattr(n, "status") else n for n in nodes]
    if "outcome_unknown" in states: return "outcome_unknown"
    if "running" in states: return "running"
    if any(s in ("queued", "claimed") for s in states): return "queued"
    if any(s in ("waiting_input", "waiting_data", "wait_expired") for s in states): return "waiting"
    if "pending" in states: return "queued"
    if cancelled or "cancelled" in states: return "cancelled"
    failures = any(s in ("failed", "blocked", "rejected") for s in states)
    if failures: return "partial" if "succeeded" in states else "failed"
    return "succeeded" if states else "failed"


def register_workflows(app, *, settings, auth, db, owned_project, operation):
    def latest(session, pid):
        return session.scalar(select(WorkflowVersion).where(WorkflowVersion.project_id == pid).order_by(WorkflowVersion.revision.desc()).limit(1))

    def scoped_run(session, user, pid, rid, edit=False, lock=False):
        owned_project(session, user, pid, edit=edit); uuid_string(rid)
        query = select(WorkflowRun).where(WorkflowRun.id == rid, WorkflowRun.project_id == pid)
        run = session.scalar(query.with_for_update() if lock else query)
        if run is None: raise ApiError(404, "not_found", "运行记录不存在。")
        return run

    def detail(session, run):
        return run_view(run, session.scalars(select(WorkflowNodeRun).where(WorkflowNodeRun.run_id == run.id).order_by(WorkflowNodeRun.node_id)).all(),
                        session.scalars(select(WorkflowEvent).where(WorkflowEvent.run_id == run.id).order_by(WorkflowEvent.sequence.desc()).limit(100)).all()[::-1])

    @app.get("/api/projects/{project_id}/workflow/catalog")
    def node_catalog(project_id: str, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id)
        value = catalog(settings)[0]
        if settings.workflow_execution_profile == "first_release":
            value = {**value, "nodes": [node for node in value["nodes"] if node["kind"] not in DEFERRED_KINDS]}
        return {**value, "executionEnabled": settings.workflow_enabled, "executionProfile": settings.workflow_execution_profile,
                "deferredKinds": sorted(DEFERRED_KINDS) if settings.workflow_execution_profile == "first_release" else [],
                "edgeKinds": ["data", "reference"] if settings.workflow_execution_profile == "first_release" else ["data", "control", "reference"],
                "limits": {"nodes": MAX_NODES, "edges": MAX_EDGES, "runNodes": MAX_EXECUTION}}

    @app.get("/api/projects/{project_id}/workflow")
    def get_workflow(project_id: str, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id)
        version, positions = latest(session, project_id), session.get(WorkflowLayout, project_id)
        preference = session.get(WorkflowView, (project_id, user.id))
        return {"id": version.id if version else None, "revision": version.revision if version else 0,
                "definition": version.definition if version else EMPTY, "layout": positions.layout if positions else EMPTY_LAYOUT,
                "layoutRevision": positions.revision if positions else 0, "view": preference.view if preference else None}

    @app.post("/api/projects/{project_id}/workflow/versions", status_code=201)
    async def save_workflow(project_id: str, request: Request, user=Depends(auth), session=Depends(db)):
        data = await body(request, ("expectedRevision", "idempotencyKey", "definition"), ("sourceProposalId",), limit=600000)
        owned_project(session, user, project_id, edit=True, lock=True)
        op, repeated = operation(session, user, "workflow:" + project_id, data)
        if repeated: return op.response
        previous = latest(session, project_id)
        if integer(data["expectedRevision"], 0) != (previous.revision if previous else 0):
            raise ApiError(409, "revision_conflict", "流程已有新版本，请保留当前草稿并核对。")
        if data.get("sourceProposalId"):
            uuid_string(data["sourceProposalId"])
            proposal = session.scalar(select(WorkflowGraphProposal).where(WorkflowGraphProposal.id == data["sourceProposalId"], WorkflowGraphProposal.project_id == project_id, WorkflowGraphProposal.user_id == user.id).with_for_update())
            if proposal is None or proposal.status != "ready" or proposal.base_revision != data["expectedRevision"]:
                raise ApiError(409, "stale_proposal", "提案绑定的流程版本已变化，请核对当前草稿。")
        value = definition(data["definition"], catalog(settings)[1])
        item = WorkflowVersion(id=new_id(), project_id=project_id, revision=data["expectedRevision"] + 1, definition=value, content_hash=fingerprint(value), created_by=user.id)
        session.add(item); session.flush()
        if data.get("sourceProposalId"): proposal.status = "applied"
        op.response = {"id": item.id, "revision": item.revision, "definition": item.definition, "hash": item.content_hash}
        session.commit(); return op.response

    @app.get("/api/projects/{project_id}/workflow/versions")
    def versions(project_id: str, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id)
        items = session.scalars(select(WorkflowVersion).where(WorkflowVersion.project_id == project_id).order_by(WorkflowVersion.revision.desc()).limit(100)).all()
        return {"versions": [{"id": v.id, "revision": v.revision, "createdAt": iso(v.created_at), "hash": v.content_hash} for v in items]}

    @app.get("/api/projects/{project_id}/workflow/versions/{version_id}")
    def get_version(project_id: str, version_id: str, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id); uuid_string(version_id)
        item = session.scalar(select(WorkflowVersion).where(WorkflowVersion.id == version_id, WorkflowVersion.project_id == project_id))
        if item is None: raise ApiError(404, "not_found", "流程版本不存在。")
        return {"id": item.id, "revision": item.revision, "definition": item.definition, "hash": item.content_hash}

    @app.put("/api/projects/{project_id}/workflow/layout")
    async def save_layout(project_id: str, request: Request, user=Depends(auth), session=Depends(db)):
        data = await body(request, ("expectedLayoutRevision", "idempotencyKey", "layout"), limit=100000)
        owned_project(session, user, project_id, edit=True, lock=True)
        op, repeated = operation(session, user, "workflow-layout:" + project_id, data)
        if repeated: return op.response
        old = session.get(WorkflowLayout, project_id)
        if integer(data["expectedLayoutRevision"], 0) != (old.revision if old else 0):
            raise ApiError(409, "layout_conflict", "画布布局已有更新，当前布局已保留。")
        value = layout(data["layout"])
        if old is None:
            old = WorkflowLayout(project_id=project_id, revision=0, layout=value); session.add(old)
        old.layout, old.revision = value, old.revision + 1
        op.response = {"layoutRevision": old.revision, "layout": value}; session.commit(); return op.response

    @app.patch("/api/projects/{project_id}/workflow/view")
    async def save_view(project_id: str, request: Request, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id)
        data = await body(request, ("viewport", "selectedNodeIds", "motion", "transparency"), limit=10000)
        object_fields(data["viewport"], ("x", "y", "zoom"))
        if any(type(v) not in (float, int) or not math.isfinite(v) for v in data["viewport"].values()) or not .1 <= data["viewport"]["zoom"] <= 4:
            raise ApiError()
        if data["motion"] not in ("standard", "reduced", "off") or type(data["transparency"]) not in (int, float) or not 0 <= data["transparency"] <= 1 or not isinstance(data["selectedNodeIds"], list) or len(data["selectedNodeIds"]) > MAX_NODES:
            raise ApiError()
        for nid in data["selectedNodeIds"]: identifier(nid)
        old = session.get(WorkflowView, (project_id, user.id))
        if old: old.view = data
        else: session.add(WorkflowView(project_id=project_id, user_id=user.id, view=data))
        session.commit(); return {"view": data}

    @app.post("/api/projects/{project_id}/workflow/validate")
    async def validate(project_id: str, request: Request, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id)
        data = await body(request, ("definition",), ("selectedNodeIds",), limit=600000)
        return validate_graph(data["definition"], catalog(settings)[1], data.get("selectedNodeIds"), settings.workflow_execution_profile)

    def proposal_view(item):
        return {"id": item.id, "status": item.status, "definition": item.definition, "baseRevision": item.base_revision,
                "errorCode": item.error_code, "createdAt": iso(item.created_at)}

    @app.post("/api/projects/{project_id}/workflow/proposals", status_code=201)
    async def propose(project_id: str, request: Request, user=Depends(auth), session=Depends(db)):
        from .provider import ProviderFailure
        from .security import decrypt, config_view
        from .contracts import strict_json
        data = await body(request, ("idempotencyKey", "prompt", "definition", "serviceId", "serviceRevision"), ("consent", "expectedRevision"), limit=600000)
        project, _ = owned_project(session, user, project_id, edit=True, lock=True)
        key_id = uuid_string(data["idempotencyKey"])
        digest = fingerprint(data)
        old = session.scalar(select(WorkflowGraphProposal).where(WorkflowGraphProposal.user_id == user.id, WorkflowGraphProposal.project_id == project_id, WorkflowGraphProposal.idempotency_key == key_id))
        if old:
            if old.input_hash != digest: raise ApiError(409, "idempotency_conflict", "操作标识已用于其他提案。")
            if old.status == "dispatched" and old.created_at < now() - timedelta(seconds=settings.proposal_stale_seconds):
                old.status, old.error_code, old.finished_at = "outcome_unknown", "interrupted_call", now(); session.commit()
            return proposal_view(old)
        if data.get("consent") is not True: raise ApiError(422, "consent_required", "请确认向所选个人模型发送本次流程需求。")
        head = latest(session, project_id); revision = head.revision if head else 0
        if "expectedRevision" in data and integer(data["expectedRevision"], 0) != revision: raise ApiError(409, "revision_conflict", "流程版本已变化。")
        definition(data["definition"], catalog(settings)[1]); text(data["prompt"], 8000, 1); uuid_string(data["serviceId"])
        service = session.scalar(select(Service).where(Service.id == data["serviceId"], Service.user_id == user.id, Service.deleted.is_(False)).with_for_update())
        if service is None: raise ApiError(404, "not_found", "个人模型服务不存在。")
        if service.revision != integer(data["serviceRevision"], 1): raise ApiError(409, "revision_conflict", "服务版本已变化。")
        if "research" not in service.capabilities: raise ApiError(422, "capability_unavailable", "服务未启用研究能力。")
        recent = session.scalars(select(WorkflowGraphProposal).where(WorkflowGraphProposal.user_id == user.id, WorkflowGraphProposal.created_at > now() - timedelta(hours=1))).all()
        if len(recent) >= 12 or any(p.status == "dispatched" for p in recent):
            raise ApiError(429, "proposal_limit", "请先等待当前提案完成，或稍后再生成。")
        spec = {"mode": "workflow_graph", "definition": data["definition"]}
        message = "设计研究流程提案。仅使用以下注册目录，保留现有节点ID，不输出密钥、原始答卷或自定义代码。只输出JSON {\"definition\":流程}。需求：" + data["prompt"] + "\n当前流程：" + canonical(data["definition"]) + "\n注册目录：" + canonical(catalog(settings)[0])
        config, key = config_view(service), decrypt(settings, service)
        if key in message: raise ApiError(422, "sensitive_input", "流程需求包含服务密钥。")
        item = WorkflowGraphProposal(id=new_id(), project_id=project_id, user_id=user.id, idempotency_key=key_id, input_hash=digest,
                                     base_revision=revision, service_id=service.id, service_revision=service.revision, status="dispatched")
        session.add(item); session.commit()
        graph, failure = None, None
        try:
            async with asyncio.timeout(45): raw = await app.state.provider.answer(config, key, message, spec)
            if not isinstance(raw, str) or key in raw: raise ProviderFailure("invalid_response")
            value = object_fields(strict_json(raw), ("definition",))
            graph = definition(value["definition"], catalog(settings)[1])
        except ProviderFailure as error: failure = error
        except ApiError: failure = ProviderFailure("invalid_response")
        except (TimeoutError, asyncio.CancelledError): failure = ProviderFailure("provider_timeout", unknown=True)
        except Exception: failure = ProviderFailure("provider_failure", unknown=True)
        finally: key = ""
        session.execute(sql_text("SELECT set_config('evix.user_id',:uid,true)"), {"uid": user.id})
        current = session.scalar(select(WorkflowGraphProposal).where(WorkflowGraphProposal.id == item.id).with_for_update())
        if current and current.status == "dispatched":
            current.status = "outcome_unknown" if failure and failure.unknown else "failed" if failure else "ready"
            current.definition, current.error_code, current.finished_at = graph, failure.code if failure else None, now(); session.commit()
        current_user = auth(request, session); owned_project(session, current_user, project_id)
        return proposal_view(current)

    @app.get("/api/projects/{project_id}/workflow/proposals/{proposal_id}")
    def get_proposal(project_id: str, proposal_id: str, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id); uuid_string(proposal_id)
        item = session.scalar(select(WorkflowGraphProposal).where(WorkflowGraphProposal.id == proposal_id, WorkflowGraphProposal.project_id == project_id, WorkflowGraphProposal.user_id == user.id))
        if item is None: raise ApiError(404, "not_found", "流程提案不存在。")
        if item.status == "dispatched" and item.created_at < now() - timedelta(seconds=settings.proposal_stale_seconds):
            item.status, item.error_code, item.finished_at = "outcome_unknown", "interrupted_call", now(); session.commit()
        return proposal_view(item)

    @app.post("/api/projects/{project_id}/datasets/versions", status_code=201)
    async def upload_dataset(project_id: str, request: Request, user=Depends(auth), session=Depends(db)):
        data = await body(request, ("idempotencyKey", "sourceName", "classification", "csv"), ("mapping", "routing", "missingCodes", "identity", "delimiter"), limit=4 * 1024 * 1024)
        owned_project(session, user, project_id, edit=True, lock=True)
        op, repeated = operation(session, user, "dataset:" + project_id, data)
        if repeated: return op.response
        text(data["sourceName"], 160, 1)
        if data["classification"] not in ("actual", "simulated"): raise ApiError()
        content = {"table": parse_csv(data["csv"], data.get("delimiter", ",")), **{k: data[k] for k in ("mapping", "routing", "missingCodes", "identity") if k in data}}
        if "identity" in data:
            identity = object_fields(data["identity"], ("sourceHash", "interpretationHash", "parser", "encoding", "delimiter", "headers", "rows"))
            expected = {"sourceHash": __import__("hashlib").sha256(data["csv"].encode("utf-8")).hexdigest(), "parser": "survey-csv/v1", "encoding": "utf-8",
                        "delimiter": content["table"]["delimiter"], "headers": content["table"]["headers"], "rows": len(content["table"]["rows"])}
            if identity != {**expected, "interpretationHash": fingerprint(expected)}:
                raise ApiError(422, "dataset_identity_mismatch", "上传内容与数据解析身份不一致，请以当前UTF-8文件重新绑定。")
        row = DatasetVersion(id=new_id(), project_id=project_id, source_name=data["sourceName"], classification=data["classification"],
                             content_hash=fingerprint(content), content=content, created_by=user.id)
        session.add(row); session.flush(); op.response = dataset_view(row); session.commit(); return op.response

    @app.get("/api/projects/{project_id}/datasets/versions")
    def datasets(project_id: str, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id)
        return {"versions": [dataset_view(v) for v in session.scalars(select(DatasetVersion).where(DatasetVersion.project_id == project_id).order_by(DatasetVersion.created_at.desc()).limit(100)).all()]}

    @app.get("/api/projects/{project_id}/datasets/versions/{version_id}")
    def dataset(project_id: str, version_id: str, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id); uuid_string(version_id)
        row = session.scalar(select(DatasetVersion).where(DatasetVersion.id == version_id, DatasetVersion.project_id == project_id))
        if row is None: raise ApiError(404, "not_found", "数据版本不存在。")
        return dataset_view(row, True)

    @app.post("/api/projects/{project_id}/workflow/runs", status_code=202)
    async def start(project_id: str, request: Request, user=Depends(auth), session=Depends(db)):
        data = await body(request, ("workflowVersionId", "idempotencyKey", "mode"), ("selectedNodeIds", "serviceBindings", "consent", "expectedRevision", "upstreamRunId"), limit=100000)
        project, _ = owned_project(session, user, project_id, edit=True, lock=True)
        op, repeated = operation(session, user, "workflow-run:" + project_id, data)
        if repeated: return detail(session, session.get(WorkflowRun, op.response["id"]))
        if not settings.workflow_enabled or not Path(settings.workflow_executor_path).is_file() or not Path(settings.workflow_node_executable).is_file():
            raise ApiError(503, "worker_unavailable", "后台研究执行器尚未配置。")
        uuid_string(data["workflowVersionId"])
        version = session.scalar(select(WorkflowVersion).where(WorkflowVersion.id == data["workflowVersionId"], WorkflowVersion.project_id == project_id))
        if version is None: raise ApiError(404, "not_found", "流程版本不存在。")
        current = latest(session, project_id)
        if "expectedRevision" in data and integer(data["expectedRevision"], 1) != current.revision:
            raise ApiError(409, "revision_conflict", "流程版本已变化。")
        if data["mode"] not in ("all", "selected", "single"): raise ApiError()
        selected = data.get("selectedNodeIds") if data["mode"] != "all" else None
        if data["mode"] == "single" and (not isinstance(selected, list) or len(selected) != 1): raise ApiError()
        result = validate_graph(version.definition, catalog(settings)[1], selected, settings.workflow_execution_profile)
        if not result["valid"] or not result["nodeIds"]:
            raise ApiError(422, "invalid_workflow", "请先修正流程检查中的问题。")
        node_ids, bindings = set(result["nodeIds"]), data.get("serviceBindings", {})
        if not isinstance(bindings, dict) or set(bindings) - node_ids: raise ApiError()
        reusable, prior_run = {}, None
        if data["mode"] == "single" and len(node_ids) > 1:
            if not data.get("upstreamRunId"):
                raise ApiError(409, "upstream_results_required", "单节点运行需要已有上游结果；请选择已有运行，或明确运行所需前置节点。")
            uuid_string(data["upstreamRunId"])
            prior_run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == data["upstreamRunId"], WorkflowRun.project_id == project_id, WorkflowRun.workflow_version_id == version.id, WorkflowRun.user_id == user.id))
            if prior_run is None: raise ApiError(409, "upstream_results_required", "已有上游运行不属于当前流程版本。")
            reusable = {n.node_id: n for n in session.scalars(select(WorkflowNodeRun).where(WorkflowNodeRun.run_id == prior_run.id, WorkflowNodeRun.node_id.in_(node_ids - set(selected)))).all()}
            if set(reusable) != node_ids - set(selected) or any(n.status != "succeeded" or not n.result for n in reusable.values()):
                raise ApiError(409, "upstream_results_required", "必要上游结果尚未完成，不能隐式重跑模型或批准节点。")
        frozen, service_refs = {}, {}
        for node in version.definition["nodes"]:
            if node["id"] not in node_ids: continue
            config, nid, kind = node["config"], node["id"], node["kind"]
            if kind in MODEL_KINDS:
                if nid in reusable:
                    service_refs[nid] = prior_run.manifest["services"][nid]
                    continue
                if data.get("consent") is not True:
                    raise ApiError(422, "consent_required", "请确认本次模型调用的输入、用途和服务。")
                ref = object_fields(bindings.get(nid), ("serviceId", "serviceRevision")); uuid_string(ref["serviceId"])
                service = session.scalar(select(Service).where(Service.id == ref["serviceId"], Service.user_id == user.id, Service.deleted.is_(False)).with_for_update())
                required = "questionnaire" if kind == "questionnaire_generate" else "defense" if kind == "defense" else "research"
                if service is None: raise ApiError(404, "not_found", "个人模型服务不存在。")
                if integer(ref["serviceRevision"], 1) != service.revision: raise ApiError(409, "revision_conflict", "个人模型服务版本已变化。")
                if required not in service.capabilities: raise ApiError(422, "capability_unavailable", "个人模型服务未启用所需能力。")
                service_refs[nid] = {"serviceId": service.id, "serviceRevision": service.revision, "ownerId": user.id}
            if kind == "dataset":
                uuid_string(config.get("datasetVersionId"))
                dataset_row = session.scalar(select(DatasetVersion).where(DatasetVersion.id == config["datasetVersionId"], DatasetVersion.project_id == project_id))
                if dataset_row is None: raise ApiError(404, "not_found", "数据版本不存在，请先上传并用于后台运行。")
                frozen[nid] = {"datasetVersionId": dataset_row.id, "hash": dataset_row.content_hash}
            if kind == "questionnaire":
                qid = config.get("artifactVersionId") or config.get("artifactId")
                q = session.scalar(select(Version).where(Version.project_id == project_id, Version.id == qid)) if qid else session.scalar(select(Version).where(Version.project_id == project_id, Version.revision == project.questionnaire_revision))
                if q is None: raise ApiError(409, "unsaved_questionnaire", "请先保存问卷，再建立版本引用。")
                frozen[nid] = {"versionId": q.id, "revision": q.revision, "hash": q.design_hash}
            if kind == "report" and (config.get("artifactVersionId") or config.get("artifactId") or config.get("binding") == "head"):
                rid = config.get("artifactVersionId") or config.get("artifactId")
                r = session.scalar(select(ReportVersion).where(ReportVersion.id == rid, ReportVersion.project_id == project_id)) if rid else session.scalar(select(ReportVersion).where(ReportVersion.project_id == project_id).order_by(ReportVersion.revision.desc()).limit(1))
                if r is None: raise ApiError(404, "not_found", "报告版本不存在。")
                provenance = session.get(ReportProvenance, r.id)
                frozen[nid] = {"versionId": r.id, "revision": r.revision, "hash": r.content_hash,
                               "classification": provenance.classification if provenance else "unknown", "source": provenance.source if provenance else {}}
            if kind == "survey_wait" and config.get("releaseId"):
                release = session.scalar(select(SurveyRelease).where(SurveyRelease.id == config["releaseId"], SurveyRelease.project_id == project_id))
                if release is None: raise ApiError(404, "not_found", "问卷发布版本不存在。")
                frozen[nid] = {"releaseId": release.id, "versionId": release.version_id, "questionnaireRevision": release.questionnaire_revision}
        executor_hash = executor_fingerprint(settings)
        if prior_run and (any(prior_run.manifest["frozen"].get(key) != value for key, value in frozen.items()) or prior_run.manifest["executorHash"] != executor_hash or prior_run.manifest["catalogHash"] != fingerprint(catalog(settings)[0])):
            raise ApiError(409, "stale_upstream", "上游输入或执行版本已变化，请重新选择有效结果。")
        run = WorkflowRun(id=new_id(), project_id=project_id, workflow_version_id=version.id, user_id=user.id, status="queued", cancel_requested=False,
                          manifest={"definition": version.definition, "nodeIds": result["nodeIds"], "selectedNodeIds": selected,
                                    "mode": data["mode"], "frozen": frozen, "services": service_refs, "executorHash": executor_hash,
                                    "catalogHash": fingerprint(catalog(settings)[0]), "consent": data.get("consent") is True,
                                    "questionnaireRevision": project.questionnaire_revision}, event_sequence=0)
        session.add(run); session.flush()
        for nid in result["nodeIds"]:
            kind = next(n["kind"] for n in version.definition["nodes"] if n["id"] == nid)
            prior = reusable.get(nid)
            session.add(WorkflowNodeRun(id=new_id(), project_id=project_id, run_id=run.id, node_id=nid, kind=kind,
                                       status="succeeded" if prior else "pending", attempt=1 if prior else 0,
                                       input_hash=prior.input_hash if prior else None, inputs=prior.inputs if prior else None,
                                       result=prior.result if prior else None, finished_at=now() if prior else None))
        session.flush(); append_event(session, run, "run_created", payload={"nodeIds": result["nodeIds"], "workflowRevision": version.revision})
        from .workflow_runner import reconcile
        reconcile(session, run, settings)
        op.response = {"id": run.id}; session.commit(); return detail(session, run)

    @app.get("/api/projects/{project_id}/workflow/runs")
    def runs(project_id: str, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id)
        items = session.scalars(select(WorkflowRun).where(WorkflowRun.project_id == project_id).order_by(WorkflowRun.created_at.desc()).limit(30)).all()
        return {"runs": [detail(session, r) for r in items]}

    @app.get("/api/projects/{project_id}/workflow/runs/{run_id}")
    def run(project_id: str, run_id: str, user=Depends(auth), session=Depends(db)):
        return detail(session, scoped_run(session, user, project_id, run_id))

    @app.get("/api/projects/{project_id}/workflow/runs/{run_id}/events")
    async def events(project_id: str, run_id: str, request: Request, afterSequence: int = 0, user=Depends(auth), session=Depends(db)):
        scoped_run(session, user, project_id, run_id); integer(afterSequence, 0)
        # This bounded SSE response releases DB transactions between polls. The
        # client reconnects with the last sequence; cookie and membership are
        # revalidated each time and during every iteration.
        session.rollback()
        async def stream():
            cursor = afterSequence
            for _ in range(30):
                if await request.is_disconnected(): return
                with DBSession(app.state.engine, expire_on_commit=False) as fresh:
                    current = auth(request, fresh)
                    active = scoped_run(fresh, current, project_id, run_id)
                    batch = fresh.scalars(select(WorkflowEvent).where(WorkflowEvent.run_id == run_id, WorkflowEvent.sequence > cursor).order_by(WorkflowEvent.sequence).limit(200)).all()
                    for item in batch:
                        cursor = item.sequence
                        yield "id: " + str(cursor) + "\nevent: workflow\ndata: " + canonical(event_view(item)) + "\n\n"
                    terminal = active.status in ("succeeded", "failed", "partial", "cancelled", "outcome_unknown")
                if terminal: return
                yield ": heartbeat\n\n"
                await asyncio.sleep(1)
        return StreamingResponse(stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"})

    @app.post("/api/projects/{project_id}/workflow/runs/{run_id}/cancel")
    async def cancel(project_id: str, run_id: str, request: Request, user=Depends(auth), session=Depends(db)):
        data = await body(request, ("idempotencyKey",), limit=1024)
        run = scoped_run(session, user, project_id, run_id, edit=True, lock=True)
        op, repeated = operation(session, user, "workflow-cancel:" + run.id, data)
        if repeated: return detail(session, run)
        run.cancel_requested = True
        from .workflow_runner import reconcile
        reconcile(session, run, settings); append_event(session, run, "cancel_requested")
        op.response = {"id": run.id}; session.commit(); return detail(session, run)

    @app.post("/api/projects/{project_id}/workflow/runs/{run_id}/decisions")
    async def decision(project_id: str, run_id: str, request: Request, user=Depends(auth), session=Depends(db)):
        data = await body(request, ("idempotencyKey", "nodeId", "expectedAttempt", "action"), ("inputHash", "values"), limit=600000)
        run = scoped_run(session, user, project_id, run_id, edit=True, lock=True)
        op, repeated = operation(session, user, "workflow-decision:" + run.id, data)
        if repeated: return detail(session, run)
        node = session.scalar(select(WorkflowNodeRun).where(WorkflowNodeRun.run_id == run.id, WorkflowNodeRun.node_id == data["nodeId"]).with_for_update())
        if node is None: raise ApiError(404, "not_found", "节点不存在。")
        if integer(data["expectedAttempt"], 1) != node.attempt or data.get("inputHash") != node.input_hash:
            raise ApiError(409, "stale_decision", "节点输入或尝试已变化，请重新查看后决定。")
        if node.status not in ("waiting_input", "waiting_data", "wait_expired"):
            raise ApiError(409, "decision_unavailable", "节点当前不等待人工决定。")
        if run.cancel_requested: raise ApiError(409, "run_cancelled", "运行已取消。")
        from .workflow_runner import apply_decision, reconcile
        apply_decision(session, run, node, data["action"], data.get("values", {}), settings, user.id)
        append_event(session, run, "decision", node, {"action": data["action"], "actorId": user.id, "inputHash": node.input_hash})
        reconcile(session, run, settings); op.response = {"id": run.id}; session.commit(); return detail(session, run)

    @app.get("/api/projects/{project_id}/workflow/files/{file_id}")
    def download(project_id: str, file_id: str, user=Depends(auth), session=Depends(db)):
        owned_project(session, user, project_id); uuid_string(file_id)
        item = session.scalar(select(WorkflowFile).where(WorkflowFile.id == file_id, WorkflowFile.project_id == project_id))
        if item is None: raise ApiError(404, "not_found", "成果文件不存在。")
        return Response(item.content, media_type=item.mime, headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(item.filename), "X-Content-SHA256": item.content_hash})
