"""Global Task Orchestrator, Persistent Memory & Cross-Module Visual Bridge API."""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import get_conn, log_telemetry, upsert_artifact
from engines.agent_orchestrator import (
    create_agent_thread,
    delete_agent_thread,
    execute_confirmed_thread_plan,
    get_agent_thread,
    handle_agent_chat_stream,
    list_agent_threads,
)
from engines.docx_compiler import compile_lesson_docx
from engines.math_verifier import sample_function_plot
from engines.memory_engine import (
    create_remediation_quiz,
    get_memory_dashboard,
    update_teacher_preferences,
)
from engines.ppt_bridge import compile_ppt_project

router = APIRouter(prefix="/api/agent", tags=["agent"])


class ThreadCreateReq(BaseModel):
    title: str = "新协同任务"


class AgentChatReq(BaseModel):
    thread_id: str | None = None
    message: str
    require_confirmation: bool = False
    speed_mode: str = "standard"


class PreferencesUpdateReq(BaseModel):
    preferences: dict[str, str]


class RemediationQuizReq(BaseModel):
    topics: list[str] = []
    count: int = 4


class InsertVisualReq(BaseModel):
    target: str = "ppt"  # ppt | lesson
    target_id: str = ""
    visual_title: str = "函数图像与切线关系"
    expr: str = "x^3 - 3*x^2 + 2"
    caption: str = "结合原函数与一阶导数曲线观察单调性与极值点"


@router.get("/threads")
async def list_threads_endpoint() -> dict[str, Any]:
    return {"ok": True, "threads": list_agent_threads()}


@router.post("/threads")
async def create_thread_endpoint(req: ThreadCreateReq) -> dict[str, Any]:
    return {"ok": True, "thread": create_agent_thread(req.title)}


@router.get("/threads/{thread_id}")
async def get_thread_endpoint(thread_id: str) -> dict[str, Any]:
    th = get_agent_thread(thread_id)
    if not th:
        raise HTTPException(status_code=404, detail="任务会话不存在")
    return {"ok": True, "thread": th}


@router.delete("/threads/{thread_id}")
async def delete_thread_endpoint(thread_id: str) -> dict[str, Any]:
    ok = delete_agent_thread(thread_id)
    if not ok:
        raise HTTPException(status_code=404, detail="任务会话不存在")
    return {"ok": True}


@router.post("/chat")
async def agent_chat_stream(req: AgentChatReq) -> StreamingResponse:
    return StreamingResponse(
        handle_agent_chat_stream(
            thread_id=req.thread_id,
            user_message=req.message,
            require_plan_confirmation=req.require_confirmation,
            speed_mode=req.speed_mode,
        ),
        media_type="text/event-stream",
    )


@router.post("/threads/{thread_id}/execute-plan")
async def agent_execute_confirmed_plan(thread_id: str) -> StreamingResponse:
    return StreamingResponse(
        execute_confirmed_thread_plan(thread_id),
        media_type="text/event-stream",
    )


@router.get("/memory")
async def get_memory_endpoint() -> dict[str, Any]:
    return {"ok": True, **get_memory_dashboard()}


@router.put("/memory/preferences")
async def update_preferences_endpoint(req: PreferencesUpdateReq) -> dict[str, Any]:
    prefs = update_teacher_preferences(req.preferences)
    return {"ok": True, "preferences": prefs}


@router.post("/memory/remediation-quiz")
async def create_remediation_quiz_endpoint(req: RemediationQuizReq) -> dict[str, Any]:
    res = await create_remediation_quiz(topic_tags=req.topics, count=req.count)
    return {"ok": True, **res}


@router.post("/insert-visual")
async def insert_canvas_visual_into_document(req: InsertVisualReq) -> dict[str, Any]:
    """Insert a function/geometry plot from the visual canvas directly into the active/latest lesson or PPT deck."""
    plot_expr = (req.expr or "").strip() or "x**3 - 3*x**2 + 2"
    check_plot = sample_function_plot(plot_expr)
    if not check_plot.get("ok"):
        plot_expr = "x**3 - 3*x**2 + 2"

    now = time.time()
    if req.target == "lesson":
        with get_conn() as conn:
            if req.target_id:
                row = conn.execute("SELECT * FROM lessons WHERE id = ?", (req.target_id,)).fetchone()
            else:
                row = conn.execute("SELECT * FROM lessons ORDER BY updated_at DESC LIMIT 1").fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="当前没有可插入的教案，请先生成教案。")
            content = json.loads(row["content_json"] or "{}")

        visuals = list(content.get("inserted_visuals") or [])
        visuals.append({"title": req.visual_title, "expr": plot_expr, "caption": req.caption})
        content["inserted_visuals"] = visuals
        edit_count = int(row["edit_count"]) + 1
        content["edit_count"] = edit_count

        docx_path = compile_lesson_docx(content, row["id"])
        art = upsert_artifact(
            row["artifact_id"] or None,
            title=f"教案：{row['title']}",
            category="docx_lesson",
            module="lesson",
            filename=docx_path.name,
            file_path=str(docx_path),
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=docx_path.stat().st_size,
            revision_count=edit_count,
            meta={"lesson_id": row["id"], "inserted_visual": plot_expr},
        )
        with get_conn() as conn:
            conn.execute(
                "UPDATE lessons SET content_json = ?, edit_count = ?, artifact_id = ?, updated_at = ? WHERE id = ?",
                (json.dumps(content, ensure_ascii=False), edit_count, art["id"], now, row["id"]),
            )
        log_telemetry("agent", "insert_visual_lesson", verified_ok=True, meta={"lesson_id": row["id"]})
        return {
            "ok": True,
            "target": "lesson",
            "target_id": row["id"],
            "target_title": row["title"],
            "artifact": art,
        }

    # Insert as a visual_graph slide into target or latest PPT deck
    with get_conn() as conn:
        if req.target_id:
            row = conn.execute("SELECT * FROM ppt_decks WHERE id = ?", (req.target_id,)).fetchone()
        else:
            row = conn.execute("SELECT * FROM ppt_decks ORDER BY updated_at DESC LIMIT 1").fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="当前没有可插入的课件，请先生成课件。")
        slides = json.loads(row["slides_json"] or "[]")

    clean_title = req.visual_title.strip()[:18] or "画板图形直观对照"
    clean_sub = req.caption.strip()[:34] or f"f(x) = {plot_expr}"
    new_slide = {
        "layout": "visual_graph",
        "kicker": "画板图形插入",
        "title": clean_title,
        "subtitle": clean_sub,
        "plot_expr": plot_expr,
        "cards": [
            {"heading": "解析表达式", "body": f"f(x) = {plot_expr}"},
            {"heading": "图像观察要点", "body": (req.caption or "结合图像关键极值点与单调趋势辅助理解。")[:48]},
            {"heading": "课堂互动提问", "body": "请尝试指出变化率由正转负的临界点位置。"},
        ],
        "takeaway": f"借助《{clean_title}》图像直观把握函数特征与变化趋势。",
        "speaker_notes": f"这一页展示从画板插入的《{clean_title}》图像，重点引导观察关键点与趋势变化。",
    }
    insert_pos = max(1, len(slides) - 1) if len(slides) >= 2 else len(slides)
    slides.insert(insert_pos, new_slide)
    clean_slides = [{k: v for k, v in sl.items() if k not in ("svg_code", "editable_texts")} for sl in slides]

    compiled = compile_ppt_project(
        deck_id=row["id"],
        title=row["title"],
        slides=clean_slides,
        theme_id=row["theme_id"],
    )
    edit_count = int(row["edit_count"]) + 1
    art = upsert_artifact(
        row["pptx_artifact_id"] or None,
        title=f"课件PPT：{row['title']}",
        category="pptx",
        module="ppt",
        filename=compiled["pptx_filename"],
        file_path=compiled["pptx_path"],
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size_bytes=compiled["size_bytes"],
        verified_status="verified" if compiled["pptx_audit"].get("native_verified") else "needs_review",
        revision_count=edit_count,
        meta={"deck_id": row["id"], "audit": compiled["pptx_audit"]},
    )
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE ppt_decks SET slides_json = ?, quality_report_json = ?, pptx_audit_json = ?, pptx_artifact_id = ?, edit_count = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                json.dumps(compiled["slides"], ensure_ascii=False),
                json.dumps(compiled["quality_report"], ensure_ascii=False),
                json.dumps(compiled["pptx_audit"], ensure_ascii=False),
                art["id"],
                edit_count,
                now,
                row["id"],
            ),
        )
    log_telemetry("agent", "insert_visual_ppt", verified_ok=True, meta={"deck_id": row["id"]})
    return {
        "ok": True,
        "target": "ppt",
        "target_id": row["id"],
        "target_title": row["title"],
        "slide_number": insert_pos + 1,
        "artifact": art,
    }
