"""Lesson Plan Studio API: SSE generation, section-level AI rewrite, inline edit tracking, and DOCX export."""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import get_conn, log_telemetry, new_id, upsert_artifact
from core.llm_gateway import call_llm, extract_json_payload, stream_llm
from core.sse import sse_event
from engines.docx_compiler import compile_lesson_docx
from engines.memory_engine import build_memory_context_text, update_teacher_preferences
from engines.pedagogy_kb import format_pedagogy_rag_context, retrieve_pedagogy_insights

router = APIRouter(prefix="/api/lesson", tags=["lesson"])

_LESSON_SYSTEM_PROMPT = """你是一名资深全学科教研员、师范生微格教学指导专家及跨学科 PBL 课程设计师。
请根据给定学科、细分分支、学段、课题、课型（含 15 分钟微格试讲、45 分钟新授课、跨学科主题学习 PBL 等），设计一份“结构完整、学科思维严密、可直接用于课堂与导出 Word、支持跨学科融合”的高质量教学设计。
注意：所有数学/物理/化学公式统一使用标准 `$LaTeX$` 格式（例如 `$f'(x) = 3x^2$`），人文史料与评价条目需体现核心素养与可核验检查点。

必须严格输出合法 JSON：
{
  "title": "教案主标题",
  "subject": "学科（可体现细分分支与跨学科耦合）",
  "grade_level": "学段",
  "lesson_type": "课型",
  "duration": "建议时长（如 15 分钟微格试讲 或 45 分钟跨学科 PBL）",
  "objectives": ["知识与技能目标", "过程与方法/跨学科素养目标", "严谨实证/价值引领目标"],
  "learner_analysis": "前置学情与认知障碍预判",
  "key_points": "教学重点",
  "difficult_points": "教学难点及针对性突破策略",
  "teaching_steps": [
    {
      "phase": "一、环节名称",
      "duration": "时长（如 3 分钟）",
      "teacher_activity": "教师主导设问与板演动作",
      "student_activity": "学生探究与互动响应",
      "design_intent": "设计意图与可核验检查点"
    }
  ],
  "blackboard_design": "【主板书】...\\n【副板书】...",
  "exercises": [
    {"tier": "基础巩固", "question": "题目内容", "solution": "完整参考答案与评分标准"},
    {"tier": "跨学科拓展", "question": "题目内容", "solution": "完整参考答案与易错提醒"}
  ],
  "verification_checklist": [
    "学科科学性与前提边界核查点1",
    "与新课标/跨学科素养匹配核查点2",
    "试讲节奏与板书可执行性核查点3"
  ]
}"""


class LessonGenerateReq(BaseModel):
    subject: str = "高中数学"
    grade_level: str = "高二年级"
    domain: str = ""
    branch: str = ""
    topic: str
    lesson_type: str = "师范生微格试讲 (15分钟)"
    source_context: str = ""
    from_tutor_context: str = ""


class LessonUpdateReq(BaseModel):
    content: dict[str, Any]


class SectionRewriteReq(BaseModel):
    section_key: str
    instruction: str


@router.get("/list")
async def list_lessons() -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM lessons ORDER BY updated_at DESC").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["content"] = json.loads(d.pop("content_json") or "{}")
        out.append(d)
    return {"ok": True, "lessons": out}


@router.post("/generate")
async def generate_lesson_stream(req: LessonGenerateReq) -> StreamingResponse:
    async def event_gen():
        t0 = time.time()
        yield sse_event("stage", {"stage": "planning", "message": "正在设计教案结构与教学流程…"})

        pedagogy_matches = retrieve_pedagogy_insights(
            f"{req.topic} {req.lesson_type}",
            subject=req.subject,
            domain_id=req.domain,
            branch=req.branch,
            limit=2,
        )
        rag_block = format_pedagogy_rag_context(pedagogy_matches)

        domain_line = f"分支维度：{req.domain} · {req.branch}\n" if (req.domain or req.branch) else ""
        prompt = (
            f"学科：{req.subject}\n"
            f"{domain_line}"
            f"学段：{req.grade_level}\n"
            f"课题：{req.topic}\n"
            f"课型：{req.lesson_type}\n"
        )
        if rag_block:
            prompt += f"\n{rag_block}\n"
        mem_ctx = build_memory_context_text("teacher")
        if mem_ctx:
            prompt += f"\n{mem_ctx}\n"
        if req.from_tutor_context.strip():
            prompt += f"\n【学→教转换来源】这是学习者刚攻克的题目与推理脉络，请将其转化为面向学生的启发式教学设计：\n{req.from_tutor_context[:4000]}\n"
        if req.source_context.strip():
            prompt += f"\n【上传教材/资料参考】\n{req.source_context[:4500]}\n"

        update_teacher_preferences(
            {
                "preferred_subject": req.subject,
                "preferred_grade": req.grade_level,
                "preferred_lesson_type": req.lesson_type,
            }
        )

        full_text = ""
        try:
            async for chunk in stream_llm(system_prompt=_LESSON_SYSTEM_PROMPT, user_prompt=prompt):
                if chunk["type"] == "thinking":
                    yield sse_event("thinking", {"delta": chunk["delta"]})
                elif chunk["type"] == "text":
                    yield sse_event("text", {"delta": chunk["delta"]})
                elif chunk["type"] == "done":
                    full_text = chunk["text"]

            yield sse_event("stage", {"stage": "compiling", "message": "正在生成可下载教案文件…"})
            lesson_obj = extract_json_payload(full_text)
            lesson_id = new_id("les")
            lesson_obj["id"] = lesson_id
            lesson_obj["edit_count"] = 0

            docx_path = compile_lesson_docx(lesson_obj, lesson_id)
            art = upsert_artifact(
                None,
                title=f"教案：{lesson_obj.get('title', req.topic)}",
                category="docx_lesson",
                module="lesson",
                filename=docx_path.name,
                file_path=str(docx_path),
                mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                size_bytes=docx_path.stat().st_size,
                verified_status="verified",
                meta={"lesson_id": lesson_id},
            )

            now = time.time()
            orig_len = len(json.dumps(lesson_obj, ensure_ascii=False))
            with get_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO lessons (id, title, subject, grade_level, lesson_type, content_json, original_char_count, edited_char_delta, edit_count, artifact_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
                    """,
                    (
                        lesson_id,
                        str(lesson_obj.get("title", req.topic)),
                        req.subject,
                        req.grade_level,
                        req.lesson_type,
                        json.dumps(lesson_obj, ensure_ascii=False),
                        orig_len,
                        art["id"],
                        now,
                        now,
                    ),
                )

            duration_ms = int((time.time() - t0) * 1000)
            log_telemetry("lesson", "generate", duration_ms=duration_ms, verified_ok=True)
            yield sse_event(
                "result",
                {
                    "lesson": {
                        "id": lesson_id,
                        "title": lesson_obj.get("title", req.topic),
                        "subject": req.subject,
                        "grade_level": req.grade_level,
                        "lesson_type": req.lesson_type,
                        "original_char_count": orig_len,
                        "edited_char_delta": 0,
                        "edit_count": 0,
                        "artifact_id": art["id"],
                        "content": lesson_obj,
                    },
                    "artifact": art,
                    "pedagogy_refs": pedagogy_matches,
                    "duration_ms": duration_ms,
                },
            )
        except Exception as exc:
            log_telemetry("lesson", "generate_error", verified_ok=False, meta={"error": str(exc)})
            yield sse_event("error", {"message": f"教案生成失败：{exc}"})

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.put("/{lesson_id}")
async def update_lesson_and_recompile(lesson_id: str, req: LessonUpdateReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="教案不存在")

        prev_len = len(row["content_json"] or "")
        new_json = json.dumps(req.content, ensure_ascii=False)
        new_len = len(new_json)
        delta = int(row["edited_char_delta"]) + abs(new_len - prev_len)
        edit_count = int(row["edit_count"]) + 1
        title = str(req.content.get("title") or row["title"])

        payload = {**req.content, "edit_count": edit_count}
        docx_path = compile_lesson_docx(payload, lesson_id)
        art = upsert_artifact(
            row["artifact_id"] or None,
            title=f"教案：{title}",
            category="docx_lesson",
            module="lesson",
            filename=docx_path.name,
            file_path=str(docx_path),
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=docx_path.stat().st_size,
            verified_status="verified",
            revision_count=edit_count,
            meta={"lesson_id": lesson_id},
        )

        conn.execute(
            """
            UPDATE lessons SET title = ?, content_json = ?, edited_char_delta = ?, edit_count = ?, artifact_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, new_json, delta, edit_count, art["id"], time.time(), lesson_id),
        )
    log_telemetry("lesson", "manual_edit", verified_ok=True, human_edited=True, meta={"edit_count": edit_count})
    return {"ok": True, "edit_count": edit_count, "edited_char_delta": delta, "artifact": art}


@router.post("/{lesson_id}/rewrite-section")
async def rewrite_lesson_section(lesson_id: str, req: SectionRewriteReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="教案不存在")
        content = json.loads(row["content_json"] or "{}")

    cur_section = content.get(req.section_key)
    prompt = (
        f"当前教案课题：《{content.get('title', '')}》（{content.get('subject', '')} / {content.get('grade_level', '')}）\n"
        f"需要精修的字段名：{req.section_key}\n"
        f"当前内容：\n{json.dumps(cur_section, ensure_ascii=False)}\n\n"
        f"用户修改指令：{req.instruction}\n\n"
        "请保持与原字段完全一致的数据类型（字符串、数组或对象数组），只输出一个JSON对象：{\"value\": <修改后的该字段值>}。"
    )
    text, _ = await call_llm(
        system_prompt="你是教案局部精修助手，必须保持原有数据结构并严格输出 {\"value\": ...} 的合法JSON。",
        user_prompt=prompt,
        max_tokens=4000,
    )
    parsed = extract_json_payload(text)
    if "value" not in parsed:
        raise HTTPException(status_code=500, detail="AI 返回结构缺少 value 字段")

    content[req.section_key] = parsed["value"]
    save_res = await update_lesson_and_recompile(lesson_id, LessonUpdateReq(content=content))
    return {"ok": True, "content": content, **save_res}
