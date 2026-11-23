"""Mind Map & Draw.io XML Engine API (create, AI SSE generate, update, import/export .drawio)."""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import get_conn, log_telemetry, new_id, upsert_artifact
from core.llm_gateway import extract_json_payload, stream_llm
from core.sse import sse_event
from engines.mindmap_engine import (
    auto_layout_mindmap,
    build_mindmap_from_topic,
    compile_drawio_xml,
    parse_drawio_xml_to_graph,
)
from engines.pedagogy_kb import format_pedagogy_rag_context, load_pedagogy_corpus, retrieve_pedagogy_insights

router = APIRouter(prefix="/api/mindmap", tags=["mindmap"])

_MINDMAP_SYSTEM_PROMPT = """你是集成于「师承智境」的跨学科知识图谱与思维导图架构师（兼容 Draw.io mxGraphModel 标准）。
请针对用户的主题、学科与细分分支，设计一张结构深刻、含直观模型、推演骨架、反例警示与跨学科耦合连线的清晰思维导图。

必须严格输出合法 JSON：
{
  "title": "中心主标题（<=22字）",
  "layout": "mindmap_lr",
  "nodes": [
    {"id": "n_root", "label": "中心核心命题", "parent_id": null, "level": 0, "side": "center", "category": "root", "note": "核心机制简述"},
    {"id": "n_b1", "label": "一级核心原理", "parent_id": "n_root", "level": 1, "side": "right", "category": "principle", "note": "..."},
    {"id": "n_b1_1", "label": "二级原理细节", "parent_id": "n_b1", "level": 2, "side": "right", "category": "intuition", "note": "..."},
    {"id": "n_b2", "label": "一级易错与边界", "parent_id": "n_root", "level": 1, "side": "right", "category": "pitfall", "note": "..."},
    {"id": "n_b3", "label": "一级推演路径", "parent_id": "n_root", "level": 1, "side": "left", "category": "socratic", "note": "..."},
    {"id": "n_b4", "label": "一级跨学科迁移", "parent_id": "n_root", "level": 1, "side": "left", "category": "interdisciplinary", "note": "..."}
  ],
  "cross_links": [
    {"id": "cl_1", "source": "n_b1_1", "target": "n_b4", "label": "同构机制映射"}
  ]
}
规则：
1. 生成 12~18 个节点，每个一级分支下挂 2~3 个二级节点，`side` 在 `"left"` 和 `"right"` 间大致均衡。
2. 节点 `label` 精炼在 4~18 字以内，`note` 写 1 句深度阐释或公式。
3. 至少包含 1 条跨分支 `cross_links` 体现跨学科或反例互证联系。"""


class MindMapFromTopicReq(BaseModel):
    topic_id: str = ""
    custom_title: str = ""
    subject: str = "通用学科"
    domain_id: str = ""
    branch: str = ""
    graph_payload: dict[str, Any] | None = None


class MindMapGenerateReq(BaseModel):
    topic: str
    subject: str = "数学"
    domain: str = ""
    branch: str = ""


class MindMapUpdateReq(BaseModel):
    graph: dict[str, Any] | None = None
    drawio_xml: str | None = None


class MindMapImportReq(BaseModel):
    filename: str = "imported.drawio"
    xml_content: str
    subject: str = "跨学科综合"


def _row_to_mindmap(row: Any) -> dict[str, Any]:
    d = dict(row)
    d["graph"] = json.loads(d.pop("graph_json") or "{}")
    return d


def _persist_mindmap(
    *,
    map_id: str,
    title: str,
    subject: str,
    domain_id: str,
    branch: str,
    graph: dict[str, Any],
    artifact_id: str | None = None,
) -> dict[str, Any]:
    laid = auto_layout_mindmap({**graph, "title": title})
    xml_str, file_path = compile_drawio_xml(laid, map_id)
    art = upsert_artifact(
        artifact_id or None,
        title=f"思维导图：{title}",
        category="drawio",
        module="tutor",
        filename=file_path.name,
        file_path=str(file_path),
        mime_type="application/xml",
        size_bytes=file_path.stat().st_size,
        verified_status="verified",
        meta={"mindmap_id": map_id, "node_count": len(laid.get("nodes") or [])},
    )
    now = time.time()
    with get_conn() as conn:
        existing = conn.execute("SELECT created_at FROM mindmaps WHERE id = ?", (map_id,)).fetchone()
        created = existing["created_at"] if existing else now
        conn.execute(
            """
            INSERT OR REPLACE INTO mindmaps
            (id, title, subject, domain_id, branch, graph_json, drawio_xml, artifact_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                map_id,
                title,
                subject,
                domain_id,
                branch,
                json.dumps(laid, ensure_ascii=False),
                xml_str,
                art["id"],
                created,
                now,
            ),
        )
    return {
        "id": map_id,
        "title": title,
        "subject": subject,
        "domain_id": domain_id,
        "branch": branch,
        "graph": laid,
        "drawio_xml": xml_str,
        "artifact_id": art["id"],
        "artifact": art,
    }


@router.get("/list")
async def list_mindmaps() -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM mindmaps ORDER BY updated_at DESC").fetchall()
    return {"ok": True, "mindmaps": [_row_to_mindmap(r) for r in rows]}


@router.post("/from-topic")
async def create_mindmap_from_topic(req: MindMapFromTopicReq) -> dict[str, Any]:
    if req.graph_payload:
        graph = req.graph_payload
        title = str(req.custom_title or graph.get("title") or "自定义思维导图")
        subject = req.subject
        domain_id = req.domain_id
        branch = req.branch
    elif req.topic_id:
        topics = {t["id"]: t for t in load_pedagogy_corpus()}
        topic = topics.get(req.topic_id)
        if not topic:
            raise HTTPException(status_code=404, detail="未找到指定学科专题")
        graph = build_mindmap_from_topic(topic, custom_title=req.custom_title)
        title = graph["title"]
        subject = topic.get("subject", req.subject)
        domain_id = topic.get("domain_id", req.domain_id)
        branch = topic.get("branch", req.branch)
    else:
        title = req.custom_title or "中心思维导图"
        graph = {
            "title": title,
            "layout": "mindmap_lr",
            "nodes": [
                {"id": "n_root", "label": title, "parent_id": None, "level": 0, "side": "center", "category": "root", "note": ""},
                {"id": "n_b1", "label": "核心原理", "parent_id": "n_root", "level": 1, "side": "right", "category": "principle", "note": ""},
                {"id": "n_b2", "label": "易错反例", "parent_id": "n_root", "level": 1, "side": "right", "category": "pitfall", "note": ""},
                {"id": "n_b3", "label": "直观模型", "parent_id": "n_root", "level": 1, "side": "left", "category": "intuition", "note": ""},
                {"id": "n_b4", "label": "跨学科映射", "parent_id": "n_root", "level": 1, "side": "left", "category": "interdisciplinary", "note": ""},
            ],
            "cross_links": [{"id": "cl_1", "source": "n_b3", "target": "n_b4", "label": "跨域联想"}],
        }
        subject = req.subject
        domain_id = req.domain_id
        branch = req.branch

    map_id = new_id("mmap")
    rec = _persist_mindmap(
        map_id=map_id,
        title=title,
        subject=subject,
        domain_id=domain_id,
        branch=branch,
        graph=graph,
    )
    return {"ok": True, "mindmap": rec}


@router.post("/generate")
async def generate_mindmap_stream(req: MindMapGenerateReq) -> StreamingResponse:
    async def event_gen():
        t0 = time.time()
        yield sse_event("stage", {"stage": "retrieving", "message": "正在整理知识结构与分支关系…"})
        matches = retrieve_pedagogy_insights(req.topic, subject=req.subject, domain_id=req.domain, branch=req.branch, limit=2)
        rag_block = format_pedagogy_rag_context(matches)

        prompt = f"中心主题：{req.topic}\n学科：{req.subject}\n"
        if req.domain or req.branch:
            prompt += f"分类：{req.domain} · {req.branch}\n"
        if rag_block:
            prompt += f"\n{rag_block}\n"

        full_text = ""
        try:
            async for chunk in stream_llm(system_prompt=_MINDMAP_SYSTEM_PROMPT, user_prompt=prompt):
                if chunk["type"] == "thinking":
                    yield sse_event("thinking", {"delta": chunk["delta"]})
                elif chunk["type"] == "text":
                    yield sse_event("text", {"delta": chunk["delta"]})
                elif chunk["type"] == "done":
                    full_text = chunk["text"]

            yield sse_event("stage", {"stage": "compiling", "message": "正在排版并保存思维导图…"})
            graph = extract_json_payload(full_text)
            map_id = new_id("mmap")
            title = str(graph.get("title") or req.topic)[:36]
            rec = _persist_mindmap(
                map_id=map_id,
                title=title,
                subject=req.subject,
                domain_id=req.domain,
                branch=req.branch,
                graph=graph,
            )
            log_telemetry("tutor", "mindmap_generate", duration_ms=int((time.time() - t0) * 1000), verified_ok=True)
            yield sse_event("result", {"mindmap": rec})
        except Exception as exc:
            log_telemetry("tutor", "mindmap_error", verified_ok=False, meta={"error": str(exc)})
            yield sse_event("error", {"message": f"思维导图生成失败：{exc}"})

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.put("/{map_id}")
async def update_mindmap(map_id: str, req: MindMapUpdateReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (map_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="思维导图不存在")
    existing = _row_to_mindmap(row)

    if req.drawio_xml:
        graph = parse_drawio_xml_to_graph(req.drawio_xml, fallback_title=existing["title"])
    elif req.graph:
        graph = req.graph
    else:
        raise HTTPException(status_code=400, detail="请提供 graph 或 drawio_xml")

    title = str(graph.get("title") or existing["title"])
    rec = _persist_mindmap(
        map_id=map_id,
        title=title,
        subject=existing["subject"],
        domain_id=existing["domain_id"],
        branch=existing["branch"],
        graph=graph,
        artifact_id=existing["artifact_id"],
    )
    return {"ok": True, "mindmap": rec}


@router.post("/import-xml")
async def import_drawio_xml(req: MindMapImportReq) -> dict[str, Any]:
    try:
        fallback = req.filename.rsplit(".", 1)[0] or "导入思维导图"
        graph = parse_drawio_xml_to_graph(req.xml_content, fallback_title=fallback)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Draw.io XML 解析失败：{exc}") from exc

    map_id = new_id("mmap")
    rec = _persist_mindmap(
        map_id=map_id,
        title=str(graph.get("title") or fallback),
        subject=req.subject,
        domain_id="interdisciplinary",
        branch="Draw.io 导入导图",
        graph=graph,
    )
    return {"ok": True, "mindmap": rec}
