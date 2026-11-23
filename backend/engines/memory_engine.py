"""Persistent learner mastery memory, teacher style preferences, and proactive remediation quiz generator."""

from __future__ import annotations

import json
import time
from typing import Any

from core.database import get_conn, log_telemetry, new_id, upsert_artifact
from core.llm_gateway import call_llm_json
from engines.docx_compiler import compile_exam_docx
from engines.question_bank_engine import assemble_from_bank, find_bank_match, search_bank_questions
from engines.self_repair import verify_and_repair_exam

DEFAULT_TEACHER_PREFERENCES: dict[str, str] = {
    "preferred_subject": "高中数学",
    "preferred_grade": "高二年级",
    "preferred_lesson_type": "45分钟新授课",
    "preferred_slide_count": "6",
    "preferred_theme": "porcelain_daylight",
    "preferred_difficulty": "均衡梯度",
    "memory_enabled": "true",
}


def sync_error_book_to_memory() -> int:
    """Seed learner_memory records from existing error_book items if not yet tracked."""
    now = time.time()
    added = 0
    with get_conn() as conn:
        err_rows = conn.execute("SELECT * FROM error_book ORDER BY created_at DESC").fetchall()
        for r in err_rows:
            tag = str(r["topic_tag"] or "").strip()
            if not tag:
                continue
            existing = conn.execute("SELECT * FROM learner_memory WHERE topic_tag = ?", (tag,)).fetchone()
            if existing:
                continue
            lvl = int(r["mastery_level"] or 1)
            mastery = {1: 42.0, 2: 68.0, 3: 86.0}.get(lvl, 45.0)
            mistake = str(r["my_mistake"] or "").strip()
            patterns = [mistake] if mistake else []
            next_due = now if mastery < 75.0 else now + 3 * 86400
            conn.execute(
                """
                INSERT INTO learner_memory (id, topic_tag, subject, grade_level, mastery_score, mistake_patterns_json, practice_count, correct_count, last_practiced_at, next_review_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    new_id("mem"),
                    tag,
                    str(r["subject"] or "数学"),
                    str(r["grade_level"] or "高二年级"),
                    mastery,
                    json.dumps(patterns, ensure_ascii=False),
                    1 if lvl >= 3 else 0,
                    float(r["created_at"] or now),
                    next_due,
                ),
            )
            added += 1
    return added


def record_learning_outcome(
    *,
    topic_tag: str,
    subject: str = "高中数学",
    grade_level: str = "高二年级",
    correct: bool,
    mistake_note: str = "",
) -> dict[str, Any]:
    """Update persistent mastery score and recurring mistake patterns for a topic."""
    tag = (topic_tag or "").strip()[:60] or "综合知识点"
    now = time.time()
    note = (mistake_note or "").strip()[:140]

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM learner_memory WHERE topic_tag = ?", (tag,)).fetchone()
        if row:
            cur_score = float(row["mastery_score"])
            patterns = json.loads(row["mistake_patterns_json"] or "[]")
            p_count = int(row["practice_count"]) + 1
            c_count = int(row["correct_count"]) + (1 if correct else 0)
            if correct:
                new_score = min(98.0, round(cur_score + (14.0 if cur_score < 70 else 8.0), 1))
                next_review = now + (4 * 86400 if new_score >= 80 else 86400)
            else:
                new_score = max(15.0, round(cur_score - 16.0, 1))
                if note and note not in patterns:
                    patterns = ([note] + patterns)[:5]
                next_review = now  # Immediately due for remediation
            conn.execute(
                """
                UPDATE learner_memory
                SET subject = ?, grade_level = ?, mastery_score = ?, mistake_patterns_json = ?,
                    practice_count = ?, correct_count = ?, last_practiced_at = ?, next_review_at = ?
                WHERE id = ?
                """,
                (
                    subject or row["subject"],
                    grade_level or row["grade_level"],
                    new_score,
                    json.dumps(patterns, ensure_ascii=False),
                    p_count,
                    c_count,
                    now,
                    next_review,
                    row["id"],
                ),
            )
            mem_id = row["id"]
        else:
            mem_id = new_id("mem")
            new_score = 78.0 if correct else 38.0
            patterns = [note] if (note and not correct) else []
            next_review = now + 2 * 86400 if correct else now
            conn.execute(
                """
                INSERT INTO learner_memory (id, topic_tag, subject, grade_level, mastery_score, mistake_patterns_json, practice_count, correct_count, last_practiced_at, next_review_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    mem_id,
                    tag,
                    subject or "高中数学",
                    grade_level or "高二年级",
                    new_score,
                    json.dumps(patterns, ensure_ascii=False),
                    1 if correct else 0,
                    now,
                    next_review,
                ),
            )
    return {"id": mem_id, "topic_tag": tag, "mastery_score": new_score, "correct": correct}


def get_teacher_preferences() -> dict[str, str]:
    with get_conn() as conn:
        rows = conn.execute("SELECT pref_key, pref_value FROM teacher_preferences").fetchall()
    merged = dict(DEFAULT_TEACHER_PREFERENCES)
    for r in rows:
        merged[str(r["pref_key"])] = str(r["pref_value"])
    return merged


def update_teacher_preferences(updates: dict[str, str]) -> dict[str, str]:
    now = time.time()
    with get_conn() as conn:
        for k, v in updates.items():
            clean_k = str(k).strip()
            if not clean_k or v is None:
                continue
            conn.execute(
                """
                INSERT INTO teacher_preferences (pref_key, pref_value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(pref_key) DO UPDATE SET pref_value = excluded.pref_value, updated_at = excluded.updated_at
                """,
                (clean_k, str(v).strip()[:120], now),
            )
    return get_teacher_preferences()


def get_memory_dashboard() -> dict[str, Any]:
    sync_error_book_to_memory()
    now = time.time()
    with get_conn() as conn:
        mem_rows = conn.execute(
            "SELECT * FROM learner_memory ORDER BY mastery_score ASC, last_practiced_at DESC"
        ).fetchall()
        sub_rows = conn.execute(
            "SELECT id, exam_id, exam_title, score, total_score, duration_sec, weak_topics_json, created_at FROM exam_submissions ORDER BY created_at DESC LIMIT 8"
        ).fetchall()

    weak_topics: list[dict[str, Any]] = []
    mastered_topics: list[dict[str, Any]] = []
    for r in mem_rows:
        item = {
            "id": r["id"],
            "topic_tag": r["topic_tag"],
            "subject": r["subject"],
            "grade_level": r["grade_level"],
            "mastery_score": float(r["mastery_score"]),
            "mistake_patterns": json.loads(r["mistake_patterns_json"] or "[]"),
            "practice_count": int(r["practice_count"]),
            "correct_count": int(r["correct_count"]),
            "due_review": float(r["next_review_at"]) <= now + 3600 or float(r["mastery_score"]) < 72.0,
        }
        if item["mastery_score"] < 75.0:
            weak_topics.append(item)
        else:
            mastered_topics.append(item)

    submissions = []
    for s in sub_rows:
        d = dict(s)
        d["weak_topics"] = json.loads(d.pop("weak_topics_json") or "[]")
        submissions.append(d)

    return {
        "weak_topics": weak_topics,
        "mastered_topics": mastered_topics,
        "recent_submissions": submissions,
        "preferences": get_teacher_preferences(),
    }


def build_memory_context_text(role: str = "both") -> str:
    """Summarize learner weak points & teacher style preferences for prompt injection."""
    dash = get_memory_dashboard()
    prefs = dash["preferences"]
    mem_enabled = str(prefs.get("memory_enabled", "true")).strip().lower() != "false"
    lines: list[str] = []
    if mem_enabled and role in ("both", "learner") and dash["weak_topics"]:
        lines.append("【长期学情记忆·当前薄弱知识点】")
        for w in dash["weak_topics"][:4]:
            pats = "；".join(w["mistake_patterns"][:2])
            lines.append(f"- {w['topic_tag']}（{w['subject']}，当前掌握度 {int(w['mastery_score'])}%）：常见卡点为 {pats or '概念与边界校验'}")
    if role in ("both", "teacher"):
        lines.append(
            f"【教师备课常用偏好】默认学科：{prefs.get('preferred_subject')} ｜ 学段：{prefs.get('preferred_grade')} ｜ 课型：{prefs.get('preferred_lesson_type')} ｜ 课件页数：{prefs.get('preferred_slide_count')}页 ｜ 难度：{prefs.get('preferred_difficulty')}"
        )
    return "\n".join(lines).strip()


async def create_remediation_quiz(
    *,
    topic_tags: list[str] | None = None,
    count: int = 4,
) -> dict[str, Any]:
    """Proactively assemble or generate a targeted micro-quiz for current weak topics and save to DB."""
    dash = get_memory_dashboard()
    chosen = [t.strip() for t in (topic_tags or []) if t.strip()]
    if not chosen:
        chosen = [w["topic_tag"] for w in dash["weak_topics"][:3]]
    if not chosen:
        chosen = ["函数单调性与极值", "集合运算与逻辑边界"]

    target_count = max(3, min(8, int(count)))
    subject = dash["weak_topics"][0]["subject"] if dash["weak_topics"] else dash["preferences"].get("preferred_subject", "高中数学")
    grade = dash["weak_topics"][0]["grade_level"] if dash["weak_topics"] else dash["preferences"].get("preferred_grade", "高二年级")

    exam_obj: dict[str, Any] | None = None
    # Try fast deterministic question bank selection if high school math topics match
    joined_kw = " ".join(chosen)
    bank_match = find_bank_match(joined_kw)
    if bank_match and ("数学" in subject or "high" in grade.lower() or "高" in grade):
        try:
            q_cnt = max(4, min(8, target_count))
            res = assemble_from_bank(
                unit=bank_match["unit"],
                topics=bank_match["topics"] or None,
                mode="strategy",
                preference="foundation",
                count=q_cnt,
                duration=q_cnt * 4,
                versions=1,
            )
            if res.get("papers"):
                exam_obj = res["papers"][0]
                exam_obj["title"] = f"薄弱点靶向巩固卷：{'、'.join(chosen[:2])}"
        except Exception:
            exam_obj = None

    if exam_obj is None:
        # Also pull any sample bank questions as reference if helpful
        bank_samples = search_bank_questions(chosen[0], limit=2)
        sample_hint = ""
        if bank_samples:
            sample_hint = "\n可参考真题风格：\n" + "\n".join(f"- {s['stem']}" for s in bank_samples)
        mistakes = []
        for w in dash["weak_topics"]:
            if w["topic_tag"] in chosen:
                mistakes.extend(w["mistake_patterns"])
        mistake_line = "；".join(mistakes[:3]) or "审题漏看定义域或运算符号偏差"

        prompt = (
            f"学科：{subject} ｜ 学段：{grade}\n"
            f"薄弱知识点：{'、'.join(chosen)}\n"
            f"历史高频错因：{mistake_line}\n"
            f"请命制 {target_count} 道针对性巩固小测（优先包含 2~3 道单选题和 1~2 道计算/解答题），"
            "精准考查上述易错边界。涉及数理计算的题目需附带 sympy_checks。\n"
            f"{sample_hint}\n\n"
            '严格输出合法 JSON：{"title": "...", "subject": "...", "grade_level": "...", "total_score": 25, "duration_minutes": 15, "questions": [{"id": "q1", "type": "单选题", "score": 5, "difficulty": "基础 (0.80)", "knowledge_point": "...", "stem": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A", "analysis": "...", "intent": "...", "sympy_checks": []}]}'
        )
        exam_obj, _ = await call_llm_json(
            system_prompt="你是精准诊断命题老师，擅长根据学生历史错因命制短小精悍、条件严密、可自动判分的巩固小测，只输出合法 JSON。",
            user_prompt=prompt,
            max_tokens=5000,
            temperature=0.2,
        )
        exam_obj, _ = await verify_and_repair_exam(exam_obj, max_retries=1)

    eid = new_id("exam")
    exam_obj["id"] = eid
    title = str(exam_obj.get("title") or f"薄弱点巩固小测：{'、'.join(chosen[:2])}")
    exam_obj["title"] = title

    stu_path = compile_exam_docx(exam_obj, eid, edition="student")
    tea_path = compile_exam_docx(exam_obj, eid, edition="teacher")
    stu_art = upsert_artifact(
        None,
        title=f"{title}（学生卷）",
        category="docx_exam_student",
        module="exam",
        filename=stu_path.name,
        file_path=str(stu_path),
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes=stu_path.stat().st_size,
        meta={"exam_id": eid, "remediation_for": chosen},
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
        meta={"exam_id": eid, "remediation_for": chosen},
    )

    now = time.time()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO exams (id, title, subject, grade_level, exam_json, student_artifact_id, teacher_artifact_id, edit_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                eid,
                title,
                str(exam_obj.get("subject") or subject),
                str(exam_obj.get("grade_level") or grade),
                json.dumps(exam_obj, ensure_ascii=False),
                stu_art["id"],
                tea_art["id"],
                now,
                now,
            ),
        )

    log_telemetry("agent", "create_remediation_quiz", verified_ok=True, meta={"topics": chosen})
    return {
        "exam_record": {
            "id": eid,
            "title": title,
            "subject": str(exam_obj.get("subject") or subject),
            "grade_level": str(exam_obj.get("grade_level") or grade),
            "student_artifact_id": stu_art["id"],
            "teacher_artifact_id": tea_art["id"],
            "edit_count": 0,
            "exam": exam_obj,
        },
        "target_topics": chosen,
        "student_artifact": stu_art,
        "teacher_artifact": tea_art,
    }
