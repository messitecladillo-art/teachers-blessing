"""Exam & Question Paper Builder API: SymPy-verified question bank + dual DOCX export (Student & Teacher)."""

from __future__ import annotations

import json
import re
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import sympy as sp

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
            raw_parsed = extract_json_payload(full_text)
            parsed = raw_parsed if isinstance(raw_parsed, dict) else {}
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
    raw_new_q, _ = await call_llm_json(
        system_prompt="你是精准换题助手，必须输出单个合法题目 JSON 对象并携带 sympy_checks 供数值验算。",
        user_prompt=prompt,
        max_tokens=3500,
    )
    new_q = raw_new_q if isinstance(raw_new_q, dict) else {}
    temp_exam, _ = await verify_and_repair_exam(
        {"subject": exam_obj.get("subject", ""), "grade_level": exam_obj.get("grade_level", ""), "questions": [new_q]},
        max_retries=1,
    )
    questions[idx] = temp_exam["questions"][0]
    exam_obj["questions"] = questions
    res = await update_exam_and_recompile(exam_id, ExamUpdateReq(exam=exam_obj))
    return res


class _GradeResult(tuple):
    """4-tuple (earned, max_pts, correct, feedback) also supporting dict-style key lookup."""

    _KEY_INDEX = {
        "earned": 0,
        "score": 0,
        "max_pts": 1,
        "max_score": 1,
        "points": 1,
        "correct": 2,
        "ok": 2,
        "feedback": 3,
    }

    def __new__(cls, earned: float, max_pts: float, correct: bool, feedback: str) -> "_GradeResult":
        return super().__new__(cls, (earned, max_pts, correct, feedback))

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, str):
            if key in self._KEY_INDEX:
                return super().__getitem__(self._KEY_INDEX[key])
            raise KeyError(key)
        return super().__getitem__(key)

    def get(self, key: str, default: Any = None) -> Any:
        idx = self._KEY_INDEX.get(key)
        return super().__getitem__(idx) if idx is not None else default


def _normalize_ans(val: Any) -> str:
    s = str(val or "").strip()
    s = re.sub(r"\\(?:left|right)(?![A-Za-z])", "", s)
    s = re.sub(r"\\([{}])", r"\1", s)
    for pat, rep in (
        (r"\\infty(?![A-Za-z])", "∞"),
        (r"\\cup(?![A-Za-z])", "∪"),
        (r"\\cap(?![A-Za-z])", "∩"),
        (r"\\in(?![A-Za-z])", "∈"),
        (r"\\leq?(?![A-Za-z])", "<="),
        (r"\\geq?(?![A-Za-z])", ">="),
        (r"\\pm(?![A-Za-z])", "±"),
    ):
        s = re.sub(pat, rep, s)
    for k, v in (
        ("−", "-"),
        ("–", "-"),
        ("—", "-"),
        ("′", "'"),
        ("≤", "<="),
        ("≥", ">="),
        ("（", "("),
        ("）", ")"),
        ("【", "["),
        ("】", "]"),
        ("｛", "{"),
        ("｝", "}"),
        ("，", ","),
        ("；", ";"),
        ("：", ":"),
        ("＝", "="),
    ):
        s = s.replace(k, v)
    s = re.sub(r"[\s\$]+", "", s)
    return s.rstrip("。.;；,").lower()


def _extract_lhs_rhs(text: str) -> tuple[str | None, str]:
    cleaned = str(text or "").replace("$", "").replace("＝", "=").strip().rstrip("。.;；,").strip()
    m = re.match(r"^([A-Za-z_]\w*(?:\s*\([^()=]*\))?)\s*=\s*([^=]+)$", cleaned)
    if m:
        return re.sub(r"\s+", "", m.group(1)).lower(), m.group(2).strip().rstrip("。.;；,").strip()
    return None, cleaned


def _strip_math_wrappers(text: str) -> str:
    s = str(text or "").strip().replace("$", "")
    s = re.sub(r"\\(?:left|right)(?![A-Za-z])", "", s)
    s = re.sub(r"\\([{}])", r"\1", s)
    for k, v in (
        ("（", "("),
        ("）", ")"),
        ("【", "["),
        ("】", "]"),
        ("｛", "{"),
        ("｝", "}"),
        ("，", ","),
        ("；", ";"),
    ):
        s = s.replace(k, v)
    return s.strip().rstrip("。.;；,").strip()


def _split_top_level(text: str) -> list[str]:
    segs: list[str] = []
    buf: list[str] = []
    depth = 0
    for ch in text:
        if ch in "([{":
            depth += 1
            buf.append(ch)
        elif ch in ")]}":
            depth = max(0, depth - 1)
            buf.append(ch)
        elif depth == 0 and ch in ",;、":
            seg = "".join(buf).strip()
            if seg:
                segs.append(seg)
            buf = []
        else:
            buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        segs.append(tail)
    return segs


def _unwrap_outer_brackets(text: str) -> tuple[str, str, str] | None:
    if len(text) < 2:
        return None
    open_ch, close_ch = text[0], text[-1]
    if open_ch == "{" or close_ch == "}":
        if not (open_ch == "{" and close_ch == "}"):
            return None
    elif not (open_ch in "([" and close_ch in ")]"):
        return None
    depth = 0
    for idx, ch in enumerate(text):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth < 0:
                return None
        if depth == 0 and idx < len(text) - 1:
            return None
    if depth != 0:
        return None
    return open_ch, close_ch, text[1:-1].strip()


def _unordered_segments_match(u_items: list[str], r_items: list[str]) -> bool:
    if len(u_items) != len(r_items):
        return False
    used = [False] * len(r_items)

    def _backtrack(idx: int) -> bool:
        if idx == len(u_items):
            return True
        for j, r_it in enumerate(r_items):
            if not used[j] and _answers_match(u_items[idx], r_it):
                used[j] = True
                if _backtrack(idx + 1):
                    return True
                used[j] = False
        return False

    return _backtrack(0)


def _answers_match(user_ans: str, ref_ans: str) -> bool:
    u_raw = (user_ans or "").strip()
    r_raw = (ref_ans or "").strip()
    if not u_raw or not r_raw:
        return False
    if _normalize_ans(u_raw) == _normalize_ans(r_raw):
        return True

    u_clean = _strip_math_wrappers(u_raw)
    r_clean = _strip_math_wrappers(r_raw)

    # Multi-blank / comma-separated list matching at bracket depth 0
    u_segs = _split_top_level(u_clean)
    r_segs = _split_top_level(r_clean)
    if len(u_segs) == len(r_segs) > 1:
        if all(_answers_match(ua, ra) for ua, ra in zip(u_segs, r_segs)):
            return True

    # Bracketed interval [a, b] / (a, b) / [a, b) / (a, b] and unordered set {a, b} matching
    u_br = _unwrap_outer_brackets(u_clean)
    r_br = _unwrap_outer_brackets(r_clean)
    if u_br is not None and r_br is not None:
        u_open, u_close, u_inner = u_br
        r_open, r_close, r_inner = r_br
        if u_open == r_open and u_close == r_close:
            u_items = _split_top_level(u_inner) if u_inner else []
            r_items = _split_top_level(r_inner) if r_inner else []
            if u_open == "{":
                if len(u_items) == len(r_items) and _unordered_segments_match(u_items, r_items):
                    return True
            elif len(u_items) == len(r_items) >= 2:
                if all(_answers_match(ua, ra) for ua, ra in zip(u_items, r_items)):
                    return True

    u_lhs, u_rhs = _extract_lhs_rhs(u_raw)
    r_lhs, r_rhs = _extract_lhs_rhs(r_raw)
    # Allow "x = 2" to match "2" (or "x = 2" vs "x = 2"), while rejecting "y = 2" vs "x = 2"
    lhs_compatible = (u_lhs is None or r_lhs is None or u_lhs == r_lhs)
    if lhs_compatible and _normalize_ans(u_rhs) == _normalize_ans(r_rhs):
        return True

    if lhs_compatible:
        try:
            u_expr = safe_parse(u_rhs)
            r_expr = safe_parse(r_rhs)
            if isinstance(u_expr, sp.Expr) and isinstance(r_expr, sp.Expr):
                if u_expr == r_expr or sp.simplify(u_expr - r_expr) == 0:
                    return True
        except Exception:
            pass

    # Support general two-sided algebraic equation equivalence (e.g. "2*x - 4 = 0" vs "x = 2")
    if "=" in u_raw.replace("＝", "=") and "=" in r_raw.replace("＝", "="):
        try:
            u_parts = u_raw.replace("＝", "=").split("=", 1)
            r_parts = r_raw.replace("＝", "=").split("=", 1)
            u_lhs_e = safe_parse(u_parts[0])
            u_rhs_e = safe_parse(u_parts[1])
            r_lhs_e = safe_parse(r_parts[0])
            r_rhs_e = safe_parse(r_parts[1])
            if all(isinstance(e, sp.Expr) for e in (u_lhs_e, u_rhs_e, r_lhs_e, r_rhs_e)):
                u_eq = u_lhs_e - u_rhs_e
                r_eq = r_lhs_e - r_rhs_e
                if (
                    isinstance(u_eq, sp.Expr)
                    and isinstance(r_eq, sp.Expr)
                    and r_eq != 0
                    and bool(u_eq.free_symbols)
                    and u_eq.free_symbols == r_eq.free_symbols
                ):
                    ratio = sp.simplify(u_eq / r_eq)
                    if ratio.is_number and ratio.is_real and ratio.is_finite and ratio != 0:
                        return True
        except Exception:
            pass

    return False


def _extract_single_choice_letter(val: Any) -> str | None:
    if isinstance(val, (list, tuple, set)):
        items = [x for x in val if str(x or "").strip()]
        if len(items) != 1:
            return None
        val = items[0]
    if val is None or isinstance(val, bool):
        return None
    s = str(val).strip()
    if not s:
        return None
    if re.match(r"^[\(\[（]?[A-Fa-f][\)\]]?(?:\s*[,，、/;；&\s]\s*[\(\[（]?[A-Fa-f][\)\]]?)+$", s):
        return None
    m = re.match(r"^[\(\[（]?([A-Fa-f])[\)\]]?(?:[\.\．、:：\s]+.*)?$", s, flags=re.DOTALL)
    return m.group(1).upper() if m else None


def _extract_multi_choice_letters(val: Any) -> list[str]:
    if isinstance(val, (list, tuple, set)):
        letters: set[str] = set()
        for item in val:
            single = _extract_single_choice_letter(item)
            if single:
                letters.add(single)
            else:
                letters.update(re.findall(r"[A-F]", str(item or "").upper()))
        return sorted(letters)
    s = str(val or "").strip()
    single = _extract_single_choice_letter(s)
    if single:
        return [single]
    return sorted(set(re.findall(r"[A-F]", s.upper())))


def _grade_single_question(q: dict[str, Any], user_val: Any) -> _GradeResult:
    max_pts = float(q.get("score") or q.get("points") or 5)
    opts = q.get("options") or []
    parts = q.get("parts") or []
    qtype = str(q.get("type") or "").strip().lower()
    is_choice_type = bool(opts) or ("choice" in qtype) or ("选" in qtype)

    if is_choice_type:
        raw_ans = q.get("answer")
        is_explicit_single = ("single" in qtype) or ("单选" in qtype)
        is_explicit_multi = ("multi" in qtype) or ("多选" in qtype) or ("不定项" in qtype)
        r_single = _extract_single_choice_letter(raw_ans)

        if not is_explicit_single and (is_explicit_multi or r_single is None):
            r_letters = _extract_multi_choice_letters(raw_ans)
            if len(r_letters) > 1 or is_explicit_multi:
                u_letters = _extract_multi_choice_letters(user_val)
                is_ok = bool(r_letters) and u_letters == r_letters
                earned = max_pts if is_ok else 0.0
                u_disp = "".join(u_letters) if u_letters else "未选"
                r_disp = "".join(r_letters)
                fb = "回答正确" if is_ok else f"作答 {u_disp}，标准答案 {r_disp}"
                return _GradeResult(earned, max_pts, is_ok, fb)

        u_single = _extract_single_choice_letter(user_val)
        r_let = r_single or ""
        is_ok = bool(u_single and r_let and u_single == r_let)
        earned = max_pts if is_ok else 0.0
        if isinstance(user_val, (list, tuple, set)):
            raw_u_disp = ",".join(str(x).strip() for x in user_val if str(x or "").strip())
        else:
            raw_u_disp = str(user_val or "").strip()
        u_disp = u_single or (raw_u_disp[:16] if raw_u_disp else "未选")
        r_str_fallback = str(raw_ans or "").strip()
        fb = "回答正确" if is_ok else f"作答 {u_disp}，标准答案 {r_let or r_str_fallback}"
        return _GradeResult(earned, max_pts, is_ok, fb)

    if parts:
        u_map = user_val if isinstance(user_val, dict) else {"0": str(user_val or "")}
        default_part_pt = max_pts / max(1, len(parts))
        part_weights = [float(pt.get("points") or 0) or default_part_pt for pt in parts]
        total_part_pts = sum(part_weights) or max_pts
        earned_raw = 0.0
        notes: list[str] = []
        for pi, (pt, p_max) in enumerate(zip(parts, part_weights)):
            u_p = str(u_map.get(str(pi), u_map.get(pi, "")) or "").strip()
            r_p = str(pt.get("answer") or "").strip()
            if _answers_match(u_p, r_p):
                earned_raw += p_max
                notes.append(f"({pi + 1}) 正确")
            elif len(u_p) >= 6:
                earned_raw += p_max * 0.4
                notes.append(f"({pi + 1}) 部分思路给分，请对照解析核对结论")
            else:
                notes.append(f"({pi + 1}) 待补全/偏差")
        scaled = round(earned_raw * (max_pts / total_part_pts), 1) if total_part_pts > 0 else round(earned_raw, 1)
        is_ok = scaled >= max_pts * 0.85
        return _GradeResult(min(max_pts, scaled), max_pts, is_ok, "；".join(notes))

    u_text = str(user_val or "").strip()
    r_text = str(q.get("answer") or "").strip()
    if _answers_match(u_text, r_text):
        return _GradeResult(max_pts, max_pts, True, "答案核对一致")
    if len(u_text) >= 8 and ("解答" in str(q.get("type") or "") or "计算" in str(q.get("type") or "")):
        return _GradeResult(round(max_pts * 0.4, 1), max_pts, False, "已作答过程，最终结论与参考答案存在偏差，已收归错题复盘")
    return _GradeResult(0.0, max_pts, False, f"参考答案：{r_text[:48]}")


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
        kp_csv = re.sub(r'[\r\n",]+', " ", kp).strip()[:10]
        csv_headers.append(f"Q{idx + 1}_{kp_csv}({int(max_pts)}分)")
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
