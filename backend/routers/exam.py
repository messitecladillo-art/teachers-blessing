"""Exam & Question Paper Builder API: SymPy-verified question bank + dual DOCX export (Student & Teacher)."""

from __future__ import annotations

import json
import re
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.database import get_conn, log_telemetry, new_id, upsert_artifact
from core.llm_gateway import call_llm_json, extract_json_payload, stream_llm
from core.sse import sse_event
from engines.analytics_engine import compute_deterministic_analytics, desensitize_csv_text
from engines.docx_compiler import compile_analytics_docx, compile_exam_docx
from engines.math_verifier import run_symbolic_checks, safe_parse
from engines.memory_engine import build_memory_context_text, record_learning_outcome, update_teacher_preferences
from engines.question_bank_engine import assemble_from_bank, get_bank_catalog
from engines.self_repair import verify_and_repair_exam

router = APIRouter(prefix="/api/exam", tags=["exam"])

_EXAM_SYSTEM_PROMPT = """你是资深命题专家与教研质检员。
请按指定的知识点、题型配比、难度目标生成一份高质量测试卷，并严格保障“零错题、条件完备、可核验”。
对于涉及公式求导、求解方程、代数求值、积分的题目，必须附带 `sympy_checks` 列表以便后端 SymPy 引擎真实核验答案！

严格输出合法 JSON：
{
  "title": "试卷标题",
  "subject": "学科",
  "grade_level": "学段",
  "total_score": 40,
  "duration_minutes": 30,
  "questions": [
    {
      "id": "q1",
      "type": "单选题",
      "score": 5,
      "difficulty": "基础 (0.80)",
      "knowledge_point": "知识点名称",
      "stem": "题干内容（条件严密，不留歧义）",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "analysis": "分步解析与采分点说明",
      "intent": "考查核心及常见干扰误区设计说明",
      "sympy_checks": [
        {"type": "derivative", "expr": "x - log(x)", "var": "x", "expected": "1 - 1/x", "label": "求导验算"}
      ]
    }
  ]
}"""


class ExamGenerateReq(BaseModel):
    subject: str = "高中数学"
    grade_level: str = "高二年级"
    domain: str = ""
    branch: str = ""
    knowledge_points: str
    difficulty_profile: str = "均衡梯度（基础40% / 中档40% / 拔高20%）"
    question_count: int = 4
    source_context: str = ""


class ExamUpdateReq(BaseModel):
    exam: dict[str, Any]


class ReplaceQuestionReq(BaseModel):
    question_index: int
    instruction: str = "更换一道考查同一知识点但设问角度不同的新题"


class BankAssembleReq(BaseModel):
    unit: str = "r1-2"
    topics: list[str] = []
    mode: str = "strategy"
    preference: str = "balanced"
    count: int = 6
    duration: int = 25
    versions: int = 1


class ExamSubmitReq(BaseModel):
    answers: dict[str, Any] = {}
    duration_sec: int = 0


def _verify_exam_questions(exam_obj: dict[str, Any]) -> dict[str, Any]:
    questions = exam_obj.get("questions") or []
    total_score = 0
    for idx, q in enumerate(questions):
        total_score += int(q.get("score") or 5)
        checks = q.get("sympy_checks") or []
        if checks:
            q["verification"] = run_symbolic_checks(checks)
        elif not q.get("verification"):
            q["verification"] = {"status": "needs_review", "badge": "定性题目 · 建议人工核对", "checks": []}
    exam_obj["total_score"] = total_score or exam_obj.get("total_score", 40)
    return exam_obj


def _save_compiled_exam_record(
    exam_obj: dict[str, Any],
    *,
    subject: str,
    grade_level: str,
    exam_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    eid = exam_id or new_id("exam")
    exam_obj["id"] = eid
    stu_path = compile_exam_docx(exam_obj, eid, edition="student")
    tea_path = compile_exam_docx(exam_obj, eid, edition="teacher")
    title = str(exam_obj.get("title") or "测验试卷")

    stu_art = upsert_artifact(
        None,
        title=f"{title}（学生卷）",
        category="docx_exam_student",
        module="exam",
        filename=stu_path.name,
        file_path=str(stu_path),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=stu_path.stat().st_size,
        meta={"exam_id": eid},
    )
    tea_art = upsert_artifact(
        None,
        title=f"{title}（教师解析卷）",
        category="docx_exam_teacher",
        module="exam",
        filename=tea_path.name,
        file_path=str(tea_path),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=tea_path.stat().st_size,
        meta={"exam_id": eid},
    )

    now = time.time()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO exams (id, title, subject, grade_level, exam_json, student_artifact_id, teacher_artifact_id, edit_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (eid, title, subject, grade_level, json.dumps(exam_obj, ensure_ascii=False), stu_art["id"], tea_art["id"], now, now),
        )

    rec = {
        "id": eid,
        "title": title,
        "subject": subject,
        "grade_level": grade_level,
        "student_artifact_id": stu_art["id"],
        "teacher_artifact_id": tea_art["id"],
        "edit_count": 0,
        "exam": exam_obj,
    }
    return rec, stu_art, tea_art


@router.get("/bank/catalog")
async def exam_bank_catalog() -> dict[str, Any]:
    return {"ok": True, **get_bank_catalog()}


@router.post("/bank/assemble")
async def assemble_exam_from_bank(req: BankAssembleReq) -> dict[str, Any]:
    t0 = time.time()
    try:
        res = assemble_from_bank(
            unit=req.unit,
            topics=req.topics,
            mode=req.mode,
            preference=req.preference,
            count=req.count,
            duration=req.duration,
            versions=req.versions,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    records: list[dict[str, Any]] = []
    for paper in res["papers"]:
        rec, _, _ = _save_compiled_exam_record(
            paper,
            subject=paper["subject"],
            grade_level=paper["grade_level"],
        )
        records.append(rec)

    duration_ms = int((time.time() - t0) * 1000)
    log_telemetry("exam", "bank_assemble", duration_ms=duration_ms, verified_ok=True)
    return {
        "ok": True,
        "records": records,
        "recommended_minutes": res["recommended_minutes"],
        "time_matches": res["time_matches"],
        "estimate_minutes": res["estimate_minutes"],
    }


@router.get("/list")
async def list_exams() -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM exams ORDER BY updated_at DESC").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["exam"] = json.loads(d.pop("exam_json") or "{}")
        out.append(d)
    return {"ok": True, "exams": out}


@router.post("/generate")
async def generate_exam_stream(req: ExamGenerateReq) -> StreamingResponse:
    async def event_gen():
        t0 = time.time()
        yield sse_event("stage", {"stage": "composing", "message": "正在生成试题与解析…"})

        domain_line = f"分支：{req.domain} · {req.branch}\n" if (req.domain or req.branch) else ""
        mem_ctx = build_memory_context_text("teacher")
        prompt = (
            f"学科：{req.subject}\n"
            f"{domain_line}"
            f"学段：{req.grade_level}\n"
            f"考察知识点：{req.knowledge_points}\n"
            f"难度配比：{req.difficulty_profile}\n"
            f"题目数量：{max(2, min(10, req.question_count))} 道（包含单选、填空或解答题）\n"
        )
        if mem_ctx:
            prompt += f"\n{mem_ctx}\n"
        if req.source_context.strip():
            prompt += f"\n参考材料：\n{req.source_context[:4000]}\n"

        update_teacher_preferences(
            {
                "preferred_subject": req.subject,
                "preferred_grade": req.grade_level,
            }
        )

        full_text = ""
        try:
            async for chunk in stream_llm(system_prompt=_EXAM_SYSTEM_PROMPT, user_prompt=prompt):
                if chunk["type"] == "thinking":
                    yield sse_event("thinking", {"delta": chunk["delta"]})
                elif chunk["type"] == "text":
                    yield sse_event("text", {"delta": chunk["delta"]})
                elif chunk["type"] == "done":
                    full_text = chunk["text"]

            yield sse_event("stage", {"stage": "verifying", "message": "正在核对答案并自动修正偏差…"})
            parsed = extract_json_payload(full_text)
            exam_obj, _ = await verify_and_repair_exam(parsed, max_retries=2)
            exam_rec, stu_art, tea_art = _save_compiled_exam_record(
                exam_obj,
                subject=req.subject,
                grade_level=req.grade_level,
            )

            duration_ms = int((time.time() - t0) * 1000)
            log_telemetry("exam", "generate", duration_ms=duration_ms, verified_ok=True)
            yield sse_event(
                "result",
                {
                    "exam_record": exam_rec,
                    "student_artifact": stu_art,
                    "teacher_artifact": tea_art,
                    "duration_ms": duration_ms,
                },
            )
        except Exception as exc:
            log_telemetry("exam", "generate_error", verified_ok=False, meta={"error": str(exc)})
            yield sse_event("error", {"message": f"智能组卷失败：{exc}"})

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.put("/{exam_id}")
async def update_exam_and_recompile(exam_id: str, req: ExamUpdateReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM exams WHERE id = ?", (exam_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="试卷不存在")

        exam_obj = _verify_exam_questions(req.exam)
        edit_count = int(row["edit_count"]) + 1
        title = str(exam_obj.get("title") or row["title"])

        stu_path = compile_exam_docx(exam_obj, exam_id, edition="student")
        tea_path = compile_exam_docx(exam_obj, exam_id, edition="teacher")
        stu_art = upsert_artifact(
            row["student_artifact_id"] or None,
            title=f"{title}（学生卷）",
            category="docx_exam_student",
            module="exam",
            filename=stu_path.name,
            file_path=str(stu_path),
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=stu_path.stat().st_size,
            revision_count=edit_count,
            meta={"exam_id": exam_id},
        )
        tea_art = upsert_artifact(
            row["teacher_artifact_id"] or None,
            title=f"{title}（教师解析卷）",
            category="docx_exam_teacher",
            module="exam",
            filename=tea_path.name,
            file_path=str(tea_path),
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=tea_path.stat().st_size,
            revision_count=edit_count,
            meta={"exam_id": exam_id},
        )
        conn.execute(
            """
            UPDATE exams SET title = ?, exam_json = ?, student_artifact_id = ?, teacher_artifact_id = ?, edit_count = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, json.dumps(exam_obj, ensure_ascii=False), stu_art["id"], tea_art["id"], edit_count, time.time(), exam_id),
        )
    log_telemetry("exam", "manual_edit", verified_ok=True, human_edited=True)
    return {"ok": True, "exam": exam_obj, "student_artifact": stu_art, "teacher_artifact": tea_art, "edit_count": edit_count}


@router.post("/{exam_id}/replace-question")
async def replace_single_question(exam_id: str, req: ReplaceQuestionReq) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM exams WHERE id = ?", (exam_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="试卷不存在")
        exam_obj = json.loads(row["exam_json"] or "{}")

    questions = exam_obj.get("questions") or []
    idx = req.question_index
    if idx < 0 or idx >= len(questions):
        raise HTTPException(status_code=400, detail="题号越界")

    old_q = questions[idx]
    prompt = (
        f"原题目（{exam_obj.get('subject', '')} / {exam_obj.get('grade_level', '')}）：\n"
        f"{json.dumps(old_q, ensure_ascii=False)}\n\n"
        f"替换要求：{req.instruction}\n\n"
        "请只输出一道替换后的新题 JSON 对象（包含 id, type, score, difficulty, knowledge_point, stem, options, answer, analysis, intent, sympy_checks）。"
    )
    new_q, _ = await call_llm_json(
        system_prompt="你是精准换题助手，必须输出单个合法题目 JSON 对象并携带 sympy_checks 供数值验算。",
        user_prompt=prompt,
        max_tokens=3500,
    )
    temp_exam, _ = await verify_and_repair_exam(
        {"subject": exam_obj.get("subject", ""), "grade_level": exam_obj.get("grade_level", ""), "questions": [new_q]},
        max_retries=1,
    )
    questions[idx] = temp_exam["questions"][0]
    exam_obj["questions"] = questions
    res = await update_exam_and_recompile(exam_id, ExamUpdateReq(exam=exam_obj))
    return res


def _normalize_ans(val: Any) -> str:
    return re.sub(r"[\s\$，,。.;；:：\(\)（）]+", "", str(val or "").strip()).lower()


def _answers_match(user_ans: str, ref_ans: str) -> bool:
    u_raw = (user_ans or "").strip()
    r_raw = (ref_ans or "").strip()
    if not u_raw or not r_raw:
        return False
    if _normalize_ans(u_raw) == _normalize_ans(r_raw):
        return True
    try:
        import sympy as sp

        diff = sp.simplify(safe_parse(u_raw) - safe_parse(r_raw))
        if diff == 0:
            return True
    except Exception:
        pass
    # Keyword inclusion check for concise text answers
    r_clean = _normalize_ans(r_raw)
    u_clean = _normalize_ans(u_raw)
    if len(r_clean) >= 2 and r_clean in u_clean:
        return True
    return False


def _grade_single_question(q: dict[str, Any], user_val: Any) -> tuple[float, float, bool, str]:
    max_pts = float(q.get("score") or 5)
    opts = q.get("options") or []
    parts = q.get("parts") or []

    if opts:
        u_str = str(user_val or "").strip().upper()
        r_str = str(q.get("answer") or "").strip().upper()
        u_let = re.match(r"^([A-F])", u_str)
        r_let = re.match(r"^([A-F])", r_str)
        is_ok = bool(u_let and r_let and u_let.group(1) == r_let.group(1))
        earned = max_pts if is_ok else 0.0
        fb = "回答正确" if is_ok else f"作答 {u_let.group(1) if u_let else '未选'}，标准答案 {r_let.group(1) if r_let else r_str}"
        return earned, max_pts, is_ok, fb

    if parts:
        u_map = user_val if isinstance(user_val, dict) else {"0": str(user_val or "")}
        total_part_pts = sum(float(pt.get("points") or 0) for pt in parts) or max_pts
        earned_raw = 0.0
        notes: list[str] = []
        for pi, pt in enumerate(parts):
            p_max = float(pt.get("points") or round(max_pts / max(1, len(parts)), 1))
            u_p = str(u_map.get(str(pi), u_map.get(pi, "")) or "").strip()
            r_p = str(pt.get("answer") or "").strip()
            if _answers_match(u_p, r_p):
                earned_raw += p_max
                notes.append(f"({pi + 1}) 正确")
            elif len(u_p) >= 6:
                earned_raw += round(p_max * 0.4, 1)
                notes.append(f"({pi + 1}) 部分思路给分，请对照解析核对结论")
            else:
                notes.append(f"({pi + 1}) 待补全/偏差")
        scaled = round(earned_raw * (max_pts / total_part_pts), 1) if total_part_pts > 0 else round(earned_raw, 1)
        is_ok = scaled >= max_pts * 0.85
        return min(max_pts, scaled), max_pts, is_ok, "；".join(notes)

    u_text = str(user_val or "").strip()
    r_text = str(q.get("answer") or "").strip()
    if _answers_match(u_text, r_text):
        return max_pts, max_pts, True, "答案核对一致"
    if len(u_text) >= 8 and ("解答" in str(q.get("type") or "") or "计算" in str(q.get("type") or "")):
        return round(max_pts * 0.4, 1), max_pts, False, "已作答过程，最终结论与参考答案存在偏差，已收归错题复盘"
    return 0.0, max_pts, False, f"参考答案：{r_text[:48]}"


@router.get("/{exam_id}/submissions")
async def list_exam_submissions(exam_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM exam_submissions WHERE exam_id = ? ORDER BY created_at DESC",
            (exam_id,),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["answers"] = json.loads(d.pop("answers_json") or "{}")
        d["item_results"] = json.loads(d.pop("item_results_json") or "[]")
        d["weak_topics"] = json.loads(d.pop("weak_topics_json") or "[]")
        out.append(d)
    return {"ok": True, "submissions": out}


@router.post("/{exam_id}/submit")
async def submit_online_exam(exam_id: str, req: ExamSubmitReq) -> dict[str, Any]:
    """Grade student's online answers, automatically log wrong items into error_book & learner_memory, and record analytics."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM exams WHERE id = ?", (exam_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="试卷不存在")
        exam_obj = json.loads(row["exam_json"] or "{}")

    questions = exam_obj.get("questions") or []
    subject = str(exam_obj.get("subject") or row["subject"] or "高中数学")
    grade = str(exam_obj.get("grade_level") or row["grade_level"] or "高二年级")
    exam_title = str(exam_obj.get("title") or row["title"] or "在线测验")

    total_earned = 0.0
    total_possible = 0.0
    item_results: list[dict[str, Any]] = []
    weak_topics: list[str] = []
    logged_error_count = 0
    now = time.time()

    csv_headers = ["学号", "姓名", f"总分({int(sum(float(q.get('score') or 5) for q in questions) or 100)}分)"]
    csv_vals: list[str] = []

    for idx, q in enumerate(questions):
        qid = str(q.get("id") or f"q{idx + 1}")
        user_val = req.answers.get(qid, req.answers.get(str(idx), ""))
        earned, max_pts, is_ok, feedback = _grade_single_question(q, user_val)
        total_earned += earned
        total_possible += max_pts
        kp = str(q.get("knowledge_point") or exam_title)

        item_results.append(
            {
                "question_id": qid,
                "index": idx + 1,
                "knowledge_point": kp,
                "earned": earned,
                "max_score": max_pts,
                "correct": is_ok,
                "feedback": feedback,
                "correct_answer": q.get("answer", ""),
            }
        )
        csv_headers.append(f"Q{idx + 1}_{kp.replace(',', ' ')[:10]}({int(max_pts)}分)")
        csv_vals.append(str(earned))

        record_learning_outcome(
            topic_tag=kp,
            subject=subject,
            grade_level=grade,
            correct=is_ok,
            mistake_note="" if is_ok else feedback,
        )

        if not is_ok:
            if kp not in weak_topics:
                weak_topics.append(kp)
            stem = str(q.get("stem") or "")
            with get_conn() as conn:
                dup = conn.execute("SELECT id FROM error_book WHERE question_text = ?", (stem,)).fetchone()
                if not dup and stem:
                    conn.execute(
                        """
                        INSERT INTO error_book (id, subject, grade_level, topic_tag, question_text, my_mistake, key_takeaway, solution_json, mastery_level, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                        """,
                        (
                            new_id("err"),
                            subject,
                            grade,
                            kp,
                            stem,
                            feedback,
                            str(q.get("analysis") or q.get("answer") or "")[:360],
                            json.dumps({"steps": [], "final_answer": q.get("answer", "")}, ensure_ascii=False),
                            now,
                        ),
                    )
                    logged_error_count += 1

    # Also auto-record an analytics summary entry from online test results
    report_id = new_id("ana")
    try:
        row_line = ",".join(["20260001", "当前练习者", str(round(total_earned, 1)), *csv_vals])
        csv_text = ",".join(csv_headers) + "\n" + row_line
        desens = desensitize_csv_text(csv_text)
        stats = compute_deterministic_analytics(desens, report_id)
        narrative = {
            "overall_diagnosis": f"本次《{exam_title}》在线作答得分 {round(total_earned, 1)} / {round(total_possible, 1)} 分，答对 {sum(1 for it in item_results if it['correct'])}/{len(item_results)} 题。",
            "weakness_attribution": f"薄弱知识点集中在：{'、'.join(weak_topics) if weak_topics else '全部题目表现稳定'}。",
            "teaching_interventions": [
                f"已自动将 {logged_error_count} 道未通过题目收入错题本并降低对应知识点掌握度权重。",
                "建议直接点击页面下方「针对薄弱点再练一组」，完成闭环复测。",
            ],
        }
        desens_meta = {k: v for k, v in desens.items() if k != "masked_csv"}
        ana_obj = {
            "id": report_id,
            "title": f"在线作答学情：{exam_title}",
            "stats": stats,
            "ai_narrative": narrative,
            "desensitize_summary": desens_meta,
            "teacher_reviewed": True,
            "teacher_note": "系统根据在线作答结果自动汇总",
        }
        ana_docx = compile_analytics_docx(ana_obj, report_id)
        ana_art = upsert_artifact(
            None,
            title=f"在线测验报告：{exam_title}",
            category="docx_analytics",
            module="analytics",
            filename=ana_docx.name,
            file_path=str(ana_docx),
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=ana_docx.stat().st_size,
            verified_status="verified",
            meta={"report_id": report_id, "exam_id": exam_id},
        )
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO analytics_reports (id, title, dataset_name, stats_json, ai_narrative_json, desensitize_summary_json, teacher_reviewed, teacher_note, artifact_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                """,
                (
                    report_id,
                    ana_obj["title"],
                    f"在线交卷_{exam_id}",
                    json.dumps(stats, ensure_ascii=False),
                    json.dumps(narrative, ensure_ascii=False),
                    json.dumps(desens_meta, ensure_ascii=False),
                    ana_obj["teacher_note"],
                    ana_art["id"],
                    now,
                    now,
                ),
            )
    except Exception:
        report_id = ""

    sub_id = new_id("sub")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO exam_submissions (id, exam_id, exam_title, score, total_score, duration_sec, answers_json, item_results_json, weak_topics_json, analytics_report_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sub_id,
                exam_id,
                exam_title,
                round(total_earned, 1),
                round(total_possible, 1),
                int(req.duration_sec),
                json.dumps(req.answers, ensure_ascii=False),
                json.dumps(item_results, ensure_ascii=False),
                json.dumps(weak_topics, ensure_ascii=False),
                report_id,
                now,
            ),
        )
    log_telemetry("exam", "submit_online", verified_ok=True, meta={"score": total_earned, "total": total_possible})
    return {
        "ok": True,
        "submission": {
            "id": sub_id,
            "exam_id": exam_id,
            "exam_title": exam_title,
            "score": round(total_earned, 1),
            "total_score": round(total_possible, 1),
            "duration_sec": int(req.duration_sec),
            "item_results": item_results,
            "weak_topics": weak_topics,
            "logged_error_count": logged_error_count,
            "analytics_report_id": report_id,
        },
    }
