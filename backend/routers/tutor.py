"""Learning Center API: Progressive 5-step tutoring, SymPy verification, Error Book, and Study Plans."""

from __future__ import annotations

import datetime
import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import get_conn, log_telemetry, new_id, upsert_artifact
from core.llm_gateway import call_llm, extract_json_payload, stream_llm
from core.sse import sse_event
from engines.docx_compiler import compile_study_plan_ics_and_docx
from engines.math_verifier import (
    extract_plottable_expression,
    run_symbolic_checks,
    sample_function_plot,
    sample_surface_3d,
    verify_freeform_expression,
)
from engines.memory_engine import build_memory_context_text, record_learning_outcome
from engines.pedagogy_kb import format_pedagogy_rag_context, retrieve_pedagogy_insights
from engines.self_repair import verify_and_repair_tutor_solution

router = APIRouter(prefix="/api/tutor", tags=["tutor"])

_TUTOR_SYSTEM_PROMPT = """你是一名兼备高校学术深度与全学科新课标教研素养的「可靠 AI 导学智能体」。
针对全学科学习者或师范生提出的问题/跨学科专题，你必须坚持“可理解、可核验、苏格拉底启发、跨学科融通”原则：
1. 先检查题目/命题条件是否完备，若存在隐含边界、史料立场缺口或适用条件限制，必须在 missing_condition_check 中给出主动边界提醒。
2. 提供三级渐进式苏格拉底启发提示（hints: [一级直觉破冰问题, 二级核心定理/分析框架锚点, 三级关键反例/迁移突破]），坚持先追问再点拨。
3. 给出结构化分步推导或论证（steps），每一步必须标明推理依据（theorem_basis）与清晰表述（理科/定量推导规范使用 `$LaTeX$` 公式）。
4. **双轨核验输出**：
   - 若涉及数理/生化计算/经管定量公式，必须输出 `sympy_checks` 结构化核验列表（支持 `derivative`, `solve`, `equality`, `integral`, `evaluate`, `extrema`；使用标准 Python/SymPy 语法，`ln` 写作 `log`，乘方用 `**`），由后端 SymPy 符号引擎实算检验；
   - 若属人文文学、历史史料、哲学伦理、艺术美学或教学法等定性思辨课题，则令 `sympy_checks: []`，同时输出 `evidence_checks: [{"label":"史料/文本/概念边界依据","detail":"具体的原文证据、反例界限或逻辑自洽说明"}]`（2~3条）。
5. 生成知识点串讲图谱（knowledge_graph：prerequisites, core_concept, common_traps, extensions, interdisciplinary_bridges 跨学科关联桥接）。
6. 生成 3 道梯度变式自测题（variants：基础巩固 / 变式进阶 / 跨学科迁移）。

必须严格输出合法 JSON，结构如下：
{
  "topic_tag": "一句话知识点标签",
  "known_conditions": ["已知条件1", "已知条件2"],
  "missing_condition_check": {"has_ambiguity": false, "prompt": "条件完备性及隐含定义域/前提边界检查说明"},
  "hints": [
    {"level": 1, "title": "一级方向启发", "content": "..."},
    {"level": 2, "title": "二级框架锚点", "content": "..."},
    {"level": 3, "title": "三级关键突破", "content": "..."}
  ],
  "steps": [
    {"step": 1, "title": "步骤名称", "derivation": "详细推导或文本论证过程（公式使用 $...$）", "theorem_basis": "依据的定理、原理或方法论"}
  ],
  "final_answer": "最终结论（清晰简洁）",
  "uncertainty_note": "若存在边界讨论或多元学术阐释，请写明；否则写无歧义",
  "sympy_checks": [
    {"type": "derivative", "expr": "x**3 - 3*x**2 + 2", "var": "x", "expected": "3*x**2 - 6*x"},
    {"type": "solve", "equation": "3*x**2 - 6*x", "var": "x", "expected_roots": ["0", "2"]},
    {"type": "evaluate", "expr": "x**3 - 3*x**2 + 2", "subs": {"x": 0}, "expected": "2"}
  ],
  "evidence_checks": [{"label": "边界/史料核查点", "detail": "..."}],
  "knowledge_graph": {
    "prerequisites": ["前置知识1", "前置知识2"],
    "core_concept": "核心思想一句话凝练",
    "common_traps": ["高频易错点1", "高频易错点2"],
    "extensions": ["后续进阶关联1"],
    "interdisciplinary_bridges": ["跨学科关联1（如与物理/生物/经济学或人文史料对话）"]
  },
  "variants": [
    {
      "tier": "基础巩固",
      "question": "变式题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "explanation": "解析"
    }
  ],
  "teaching_bridge": {
    "suggested_lesson_title": "若将此题/知识点转为师范生微格教学的建议课题名称",
    "pedagogical_focus": "向学生讲解此题时最值得拆解的认知难点、直观模型与板书设计建议"
  }
}"""


class SolveRequest(BaseModel):
    subject: str = "高中数学"
    grade_level: str = "高二年级"
    domain: str = ""
    branch: str = ""
    question: str
    mode: str = "progressive"  # progressive | walkthrough
    source_context: str = ""
    student_attempt: str = ""


class TutorFollowupRequest(BaseModel):
    session_id: str = ""
    question_context: str = ""
    solution_summary: str = ""
    followup_question: str
    subject: str = "高中数学"


class VerifyExprRequest(BaseModel):
    expression: str


class PlotFunctionRequest(BaseModel):
    expression: str
    x_min: float = -2.0
    x_max: float = 3.5


class PlotSurface3DRequest(BaseModel):
    expression: str
    x_min: float = -2.2
    x_max: float = 2.2
    y_min: float = -2.2
    y_max: float = 2.2
    grid_size: int = 25


class ErrorBookMasteryUpdate(BaseModel):
    mastery_level: int


class ErrorBookCreate(BaseModel):
    subject: str
    grade_level: str
    topic_tag: str
    question_text: str
    my_mistake: str = ""
    key_takeaway: str = ""
    solution_json: dict[str, Any] = {}


class StudyPlanRequest(BaseModel):
    title: str
    goal: str
    weak_topics: list[str] = []
    daily_minutes: int = 45


class CalendarTaskCreate(BaseModel):
    date_str: str
    title: str
    course_title: str = ""
    subject: str = ""
    minutes: int = 30
    plan_id: str = ""


class CalendarTaskPatch(BaseModel):
    completed: bool | None = None
    title: str | None = None
    date_str: str | None = None
    minutes: int | None = None


@router.post("/solve")
async def solve_question_stream(req: SolveRequest) -> StreamingResponse:
    if not (req.question or "").strip():
        raise HTTPException(status_code=400, detail="请输入需要解答或导学的题目内容")

    async def event_gen():
        t0 = time.time()
        yield sse_event("stage", {"stage": "analyzing", "message": "正在审题并梳理推导步骤…"})

        pedagogy_matches = retrieve_pedagogy_insights(
            req.question,
            subject=req.subject,
            domain_id=req.domain,
            branch=req.branch,
            limit=2,
        )
        rag_block = format_pedagogy_rag_context(pedagogy_matches)

        domain_line = f"学科分支：{req.domain} · {req.branch}\n" if (req.domain or req.branch) else ""
        user_prompt = (
            f"学科：{req.subject}\n"
            f"{domain_line}"
            f"学段：{req.grade_level}\n"
            f"辅导模式：{'先启发后全解' if req.mode == 'progressive' else '知识点系统串讲与拆解'}\n"
            f"题目或问题：\n{req.question.strip()}\n"
        )
        if rag_block:
            user_prompt += f"\n{rag_block}\n"
        mem_ctx = build_memory_context_text("learner")
        if mem_ctx:
            user_prompt += f"\n{mem_ctx}\n"
        if req.student_attempt.strip():
            user_prompt += (
                f"\n【学生已尝试的解题思路/草稿】\n{req.student_attempt.strip()}\n"
                '请在输出 JSON 中额外增加字段 `"draft_diagnosis": {"has_attempt": true, "summary": "先肯定合理部分，再指出具体卡点或符号失误所在"}`。\n'
            )
        if req.source_context.strip():
            user_prompt += f"\n附带参考资料摘录：\n{req.source_context[:3500]}\n"

        full_text = ""
        try:
            async for chunk in stream_llm(system_prompt=_TUTOR_SYSTEM_PROMPT, user_prompt=user_prompt):
                if chunk["type"] == "thinking":
                    yield sse_event("thinking", {"delta": chunk["delta"]})
                elif chunk["type"] == "text":
                    yield sse_event("text", {"delta": chunk["delta"]})
                elif chunk["type"] == "done":
                    full_text = chunk["text"]

            yield sse_event("stage", {"stage": "verifying", "message": "正在核对计算结果与自动复查偏差…"})
            raw_parsed = extract_json_payload(full_text)
            parsed = raw_parsed if isinstance(raw_parsed, dict) else {}
            parsed, verification = await verify_and_repair_tutor_solution(
                question=req.question,
                subject=req.subject,
                parsed=parsed,
                max_retries=2,
            )
            if not isinstance(parsed, dict):
                parsed = {}
            raw_checks = parsed.get("sympy_checks")
            checks = [c for c in raw_checks if isinstance(c, dict)] if isinstance(raw_checks, list) else []
            if req.student_attempt.strip():
                raw_diag = parsed.get("draft_diagnosis")
                if isinstance(raw_diag, dict):
                    diag_text = str(raw_diag.get("summary") or raw_diag.get("detail") or "").strip()
                elif isinstance(raw_diag, str):
                    diag_text = raw_diag.strip()
                else:
                    diag_text = ""
                record_learning_outcome(
                    topic_tag=str(parsed.get("topic_tag") or req.question[:24]),
                    subject=req.subject,
                    grade_level=req.grade_level,
                    correct=False,
                    mistake_note=diag_text[:100] or req.student_attempt[:80],
                )

            plot_data = None
            plottable = extract_plottable_expression(req.question, checks)
            if plottable:
                p_expr, (px0, px1) = plottable
                cand_plot = sample_function_plot(p_expr, x_min=px0, x_max=px1)
                if cand_plot.get("ok"):
                    plot_data = cand_plot

            session_id = new_id("tut")
            duration_ms = int((time.time() - t0) * 1000)
            with get_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO tutor_sessions (id, subject, grade_level, question_text, result_json, verification_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session_id,
                        req.subject,
                        req.grade_level,
                        req.question,
                        json.dumps(parsed, ensure_ascii=False),
                        json.dumps(verification, ensure_ascii=False),
                        time.time(),
                    ),
                )
            log_telemetry(
                "tutor",
                "solve",
                duration_ms=duration_ms,
                verified_ok=(verification.get("status") != "mismatch"),
            )
            yield sse_event(
                "result",
                {
                    "session_id": session_id,
                    "duration_ms": duration_ms,
                    "solution": parsed,
                    "verification": verification,
                    "pedagogy_refs": pedagogy_matches,
                    "plot_data": plot_data,
                },
            )
        except Exception as exc:
            log_telemetry("tutor", "solve_error", verified_ok=False, meta={"error": str(exc)})
            yield sse_event("error", {"message": f"推理或核验遇到异常：{exc}"})

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.post("/verify-expression")
async def verify_expression_endpoint(req: VerifyExprRequest) -> dict[str, Any]:
    return {"ok": True, "verification": verify_freeform_expression(req.expression)}


@router.post("/plot-function")
async def plot_function_endpoint(req: PlotFunctionRequest) -> dict[str, Any]:
    return sample_function_plot(req.expression, x_min=req.x_min, x_max=req.x_max)


@router.post("/plot-surface-3d")
async def plot_surface_3d_endpoint(req: PlotSurface3DRequest) -> dict[str, Any]:
    return sample_surface_3d(
        req.expression,
        x_min=req.x_min,
        x_max=req.x_max,
        y_min=req.y_min,
        y_max=req.y_max,
        grid_size=req.grid_size,
    )


@router.patch("/error-book/{item_id}")
async def update_error_book_mastery(item_id: str, body: ErrorBookMasteryUpdate) -> dict[str, Any]:
    lvl = max(1, min(3, int(body.mastery_level)))
    with get_conn() as conn:
        cur = conn.execute("UPDATE error_book SET mastery_level = ? WHERE id = ?", (lvl, item_id))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="错题记录不存在")
    return {"ok": True, "mastery_level": lvl}


@router.get("/error-book")
async def list_error_book() -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM error_book ORDER BY created_at DESC").fetchall()
    items = []
    for r in rows:
        d = dict(r)
        try:
            d["solution"] = json.loads(d.pop("solution_json") or "{}")
        except Exception:
            d["solution"] = {}
        items.append(d)
    return {"ok": True, "items": items}


@router.post("/error-book")
async def save_error_book_entry(item: ErrorBookCreate) -> dict[str, Any]:
    q_text = (item.question_text or "").strip()
    if not q_text:
        raise HTTPException(status_code=400, detail="错题题干不能为空")

    now = time.time()
    sol_str = json.dumps(item.solution_json, ensure_ascii=False)
    deduplicated = False
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM error_book WHERE question_text = ? ORDER BY created_at DESC LIMIT 1",
            (q_text,),
        ).fetchone()
        if existing:
            eid = str(existing["id"])
            deduplicated = True
            new_mistake = item.my_mistake if item.my_mistake.strip() else str(existing["my_mistake"] or "")
            new_takeaway = item.key_takeaway if item.key_takeaway.strip() else str(existing["key_takeaway"] or "")
            new_sol = sol_str if item.solution_json else str(existing["solution_json"] or "{}")
            conn.execute(
                """
                UPDATE error_book
                SET subject = ?, grade_level = ?, topic_tag = ?, my_mistake = ?, key_takeaway = ?, solution_json = ?, created_at = ?
                WHERE id = ?
                """,
                (
                    item.subject or existing["subject"],
                    item.grade_level or existing["grade_level"],
                    item.topic_tag or existing["topic_tag"],
                    new_mistake,
                    new_takeaway,
                    new_sol,
                    now,
                    eid,
                ),
            )
            row = conn.execute("SELECT * FROM error_book WHERE id = ?", (eid,)).fetchone()
        else:
            eid = new_id("err")
            conn.execute(
                """
                INSERT INTO error_book (id, subject, grade_level, topic_tag, question_text, my_mistake, key_takeaway, solution_json, mastery_level, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    eid,
                    item.subject,
                    item.grade_level,
                    item.topic_tag,
                    q_text,
                    item.my_mistake,
                    item.key_takeaway,
                    sol_str,
                    now,
                ),
            )
            row = conn.execute("SELECT * FROM error_book WHERE id = ?", (eid,)).fetchone()

    entry = dict(row)
    try:
        entry["solution"] = json.loads(entry.pop("solution_json") or "{}")
    except Exception:
        entry["solution"] = {}

    log_telemetry("tutor", "save_error_book", verified_ok=True, meta={"deduplicated": deduplicated})
    record_learning_outcome(
        topic_tag=item.topic_tag,
        subject=item.subject,
        grade_level=item.grade_level,
        correct=False,
        mistake_note=item.my_mistake,
    )
    return {"ok": True, "id": eid, "deduplicated": deduplicated, "item": entry}


@router.get("/sessions/{session_id}/followups")
async def list_tutor_followups(session_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM tutor_followups WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        ).fetchall()
    return {"ok": True, "messages": [dict(r) for r in rows]}


@router.post("/followup")
async def tutor_followup_turn(req: TutorFollowupRequest) -> dict[str, Any]:
    """Continue multi-turn Q&A on a specific step or ask for an alternative intuitive explanation."""
    if not req.followup_question.strip():
        raise HTTPException(status_code=400, detail="请输入追问内容")

    sid = req.session_id or new_id("tut")
    history_lines: list[str] = []
    q_ctx = req.question_context
    s_ctx = req.solution_summary

    with get_conn() as conn:
        if req.session_id:
            s_row = conn.execute("SELECT * FROM tutor_sessions WHERE id = ?", (req.session_id,)).fetchone()
            if s_row:
                if not q_ctx:
                    q_ctx = str(s_row["question_text"] or "")
                if not s_ctx:
                    s_ctx = str(s_row["result_json"] or "")[:2500]
        prev_msgs = conn.execute(
            "SELECT role, content FROM tutor_followups WHERE session_id = ? ORDER BY created_at DESC LIMIT 8",
            (sid,),
        ).fetchall()
        for pm in reversed(prev_msgs):
            prefix = "学生" if pm["role"] == "user" else "老师"
            history_lines.append(f"{prefix}：{pm['content']}")

    # Check if followup contains a verifiable expression
    expr_note = ""
    expr_match = extract_plottable_expression(req.followup_question)
    if not expr_match and ("=" in req.followup_question or "^" in req.followup_question):
        v = verify_freeform_expression(req.followup_question)
        if v.get("status") == "verified":
            expr_note = f"\n后台核算参考：{v.get('detail', '')}"

    mem_ctx = build_memory_context_text("learner")
    prompt = (
        f"学科：{req.subject}\n"
        f"原问题：{q_ctx}\n"
        f"既有解析摘要：{s_ctx[:2400]}\n"
        + ("\n既往追问记录：\n" + "\n".join(history_lines) if history_lines else "")
        + (f"\n{mem_ctx}" if mem_ctx else "")
        + f"{expr_note}\n\n学生最新追问：{req.followup_question.strip()}\n"
        "请用平实清晰的简体中文直接回答学生卡点（公式用 `$...$`），先指出关键原因，再给出简明一步验证或直观类比，不超过 260 字。"
    )
    answer_text, _ = await call_llm(
        system_prompt="你是耐心严谨的学科答疑老师，专门针对学生某一步追问做简短清晰的针对性点拨。禁止使用浮夸修辞或提及底层技术名词。",
        user_prompt=prompt,
        max_tokens=1800,
        temperature=0.25,
    )
    answer_clean = (answer_text or "").strip() or "可以先把这一步的核心条件和等号两端分开核对。"

    now = time.time()
    u_id = new_id("tfu")
    a_id = new_id("tfu")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO tutor_followups (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
            (u_id, sid, req.followup_question.strip(), now),
        )
        conn.execute(
            "INSERT INTO tutor_followups (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
            (a_id, sid, answer_clean, now + 0.001),
        )
    log_telemetry("tutor", "followup", verified_ok=True)
    return {
        "ok": True,
        "session_id": sid,
        "reply": {"id": a_id, "role": "assistant", "content": answer_clean, "created_at": now + 0.001},
    }


@router.delete("/error-book/{item_id}")
async def delete_error_book_item(item_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM error_book WHERE id = ?", (item_id,))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="错题记录不存在")
    return {"ok": True}


@router.get("/study-plans")
async def list_study_plans() -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM study_plans ORDER BY created_at DESC").fetchall()
    plans = []
    for r in rows:
        d = dict(r)
        d["days"] = json.loads(d.pop("days_json") or "[]")
        plans.append(d)
    return {"ok": True, "plans": plans}


@router.post("/study-plans")
async def create_study_plan(req: StudyPlanRequest) -> dict[str, Any]:
    """Generate an executable 7-day plan and export both .ics calendar and .docx check-in sheet."""
    daily_mins = max(5, min(240, int(req.daily_minutes or 45)))
    topics = req.weak_topics or [req.title]
    plan_id = new_id("pln")
    days: list[dict[str, Any]] = []
    phase_templates = [
        ("概念溯源与错因归档", "回看核心定理边界与易错反例，手写复现关键推导", "独立默写核心判定条件与 2 个典型反例"),
        ("基础例题脱稿复演", "遮盖答案重做 3 道基础代表题，核对每步推理依据", "正确率达到 100% 且步骤无跳步"),
        ("同型变式专项突破", "完成 AI 生成的进阶变式题组并利用符号校验核对结果", "独立做出 2 道进阶变式并记录卡点"),
        ("跨知识点综合串联", "绘制本章前后置知识图谱卡片，打通与关联专题的联系", "能向同伴口述 3 分钟知识脉络"),
        ("错题二次清零重测", "从错题本抽取同类错题限时闭卷重测", "曾经做错题目一次通过"),
        ("模拟微测与时间压迫训练", f"在 {daily_mins} 分钟内完成整套薄弱点微测卷", "得分率 ≥ 85%"),
        ("总复盘与学转教输出试讲", "尝试用费曼学习法/微格试讲形式把该专题讲给别人听", "完成 1 份自查清单或导出试讲教案"),
    ]
    for idx, (focus_suffix, task_desc, chk) in enumerate(phase_templates, start=1):
        topic = topics[(idx - 1) % len(topics)]
        days.append(
            {
                "day": f"第 {idx} 天",
                "focus": f"{topic} · {focus_suffix}",
                "task": task_desc,
                "minutes": daily_mins,
                "checkpoint": chk,
            }
        )

    ics_path, docx_path = compile_study_plan_ics_and_docx(plan_id, req.title, req.goal, days)
    ics_art = upsert_artifact(
        None,
        title=f"{req.title} · 7日复习日历 (.ics)",
        category="ics",
        module="tutor",
        filename=ics_path.name,
        file_path=str(ics_path),
        mime_type="text/calendar",
        size_bytes=ics_path.stat().st_size,
        meta={"plan_id": plan_id},
    )
    docx_art = upsert_artifact(
        None,
        title=f"{req.title} · 7日复习打卡表 (.docx)",
        category="docx_lesson",
        module="tutor",
        filename=docx_path.name,
        file_path=str(docx_path),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=docx_path.stat().st_size,
        meta={"plan_id": plan_id},
    )

    today = datetime.date.today()
    now = time.time()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO study_plans (id, title, goal, days_json, ics_artifact_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (plan_id, req.title, req.goal, json.dumps(days, ensure_ascii=False), ics_art["id"], now),
        )
        for idx, d_item in enumerate(days):
            day_date = (today + datetime.timedelta(days=idx)).isoformat()
            conn.execute(
                """
                INSERT INTO calendar_tasks (id, date_str, title, course_title, subject, minutes, completed, plan_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (
                    new_id("ctsk"),
                    day_date,
                    str(d_item.get("focus") or f"第 {idx + 1} 天学习任务"),
                    req.title,
                    topics[idx % len(topics)] if topics else req.title,
                    int(d_item.get("minutes") or daily_mins),
                    plan_id,
                    now + idx * 0.001,
                ),
            )
    log_telemetry("tutor", "create_study_plan", verified_ok=True)
    return {
        "ok": True,
        "plan": {
            "id": plan_id,
            "title": req.title,
            "goal": req.goal,
            "days": days,
            "ics_artifact": ics_art,
            "docx_artifact": docx_art,
        },
    }


@router.delete("/study-plans/{plan_id}")
async def delete_study_plan_endpoint(plan_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM study_plans WHERE id = ?", (plan_id,))
        conn.execute("DELETE FROM calendar_tasks WHERE plan_id = ?", (plan_id,))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="学习计划不存在")
    return {"ok": True, "plan_id": plan_id}


def _row_to_calendar_task(row: Any) -> dict[str, Any]:
    d = dict(row)
    d["completed"] = bool(d.get("completed"))
    return d


@router.get("/calendar-tasks")
async def list_calendar_tasks(start_date: str = "", end_date: str = "") -> dict[str, Any]:
    s_dt = (start_date or "").strip()
    e_dt = (end_date or "").strip()
    clauses: list[str] = []
    params: list[str] = []
    if s_dt:
        clauses.append("date_str >= ?")
        params.append(s_dt)
    if e_dt:
        clauses.append("date_str <= ?")
        params.append(e_dt)
    where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM calendar_tasks{where_sql} ORDER BY date_str ASC, created_at ASC",
            params,
        ).fetchall()
    return {"ok": True, "tasks": [_row_to_calendar_task(r) for r in rows]}


@router.post("/calendar-tasks")
async def create_calendar_task(req: CalendarTaskCreate) -> dict[str, Any]:
    title = (req.title or "").strip()
    date_str = (req.date_str or "").strip() or datetime.date.today().isoformat()
    if not title:
        raise HTTPException(status_code=400, detail="请输入待办任务内容")
    tid = new_id("ctsk")
    now = time.time()
    mins = max(5, min(240, int(req.minutes or 30)))
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO calendar_tasks (id, date_str, title, course_title, subject, minutes, completed, plan_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (tid, date_str[:16], title[:120], req.course_title[:60], req.subject[:40], mins, req.plan_id[:40], now),
        )
        row = conn.execute("SELECT * FROM calendar_tasks WHERE id = ?", (tid,)).fetchone()
    return {"ok": True, "task": _row_to_calendar_task(row)}


@router.patch("/calendar-tasks/{task_id}")
async def update_calendar_task(task_id: str, req: CalendarTaskPatch) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM calendar_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="待办任务不存在")
        new_completed = (1 if req.completed else 0) if req.completed is not None else int(row["completed"])
        new_title = req.title.strip()[:120] if (req.title is not None and req.title.strip()) else row["title"]
        new_date = req.date_str.strip()[:16] if (req.date_str is not None and req.date_str.strip()) else row["date_str"]
        new_mins = max(5, min(240, int(req.minutes))) if req.minutes is not None else int(row["minutes"])
        conn.execute(
            "UPDATE calendar_tasks SET completed = ?, title = ?, date_str = ?, minutes = ? WHERE id = ?",
            (new_completed, new_title, new_date, new_mins, task_id),
        )
        updated = conn.execute("SELECT * FROM calendar_tasks WHERE id = ?", (task_id,)).fetchone()
    return {"ok": True, "task": _row_to_calendar_task(updated)}


@router.delete("/calendar-tasks/{task_id}")
async def delete_calendar_task(task_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM calendar_tasks WHERE id = ?", (task_id,))
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="待办任务不存在")
    return {"ok": True, "task_id": task_id}
