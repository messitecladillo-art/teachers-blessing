"""Generate -> Verify -> Auto-Repair closed loop for tutor derivations, exam questions, and slides."""

from __future__ import annotations

import json
import re
from typing import Any

from core.llm_gateway import call_llm_json
from engines.math_verifier import extract_plottable_expression, run_symbolic_checks, sample_function_plot


async def verify_and_repair_tutor_solution(
    *,
    question: str,
    subject: str,
    parsed: dict[str, Any],
    max_retries: int = 2,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Verify calculation checks; if mismatched or structurally incomplete, auto-rewrite via LLM up to max_retries."""
    current = dict(parsed)
    checks = current.get("sympy_checks") or []
    verification = run_symbolic_checks(checks, evidence_checks=current.get("evidence_checks"))

    repair_rounds = 0
    for round_idx in range(1, max_retries + 1):
        needs_structure = not current.get("steps") or not current.get("final_answer")
        has_mismatch = verification.get("status") == "mismatch"
        if not needs_structure and not has_mismatch:
            break

        failed_details = [
            f"- {c.get('label', '核验项')}: {c.get('detail', '')}"
            for c in (verification.get("checks") or [])
            if not c.get("passed")
        ]
        repair_prompt = (
            f"原问题（{subject}）：\n{question}\n\n"
            f"上一版草稿中以下核对项未通过或推导结构不完整：\n"
            + ("\n".join(failed_details) if failed_details else "- 缺少完整的分步推导 steps 或最终结论 final_answer")
            + "\n\n上一版草稿数据：\n"
            + json.dumps(current, ensure_ascii=False)[:6000]
            + "\n\n请根据真实算式检验结果修正推导过程、最终答案与核验项（sympy_checks），并保留原有字段格式输出完整 JSON。"
        )
        try:
            repaired, _ = await call_llm_json(
                system_prompt="你是严格的学科内容校对与修正助手。发现算式不一致或结构缺失时，必须修正错误步骤与结论，只输出完整合法 JSON。",
                user_prompt=repair_prompt,
                max_tokens=6000,
                temperature=0.1,
            )
            if isinstance(repaired, dict) and repaired.get("steps") and repaired.get("final_answer"):
                current = repaired
                repair_rounds = round_idx
                checks = current.get("sympy_checks") or []
                verification = run_symbolic_checks(checks, evidence_checks=current.get("evidence_checks"))
                if verification.get("status") != "mismatch":
                    break
        except Exception:
            break

    if repair_rounds > 0:
        verification["auto_repaired"] = True
        verification["repair_rounds"] = repair_rounds
        if verification.get("status") == "verified":
            passed = verification.get("passed", 0)
            total = verification.get("total", 0)
            verification["badge"] = f"自动修正后核对通过 ({passed}/{total})"
    return current, verification


def _choice_question_needs_repair(q: dict[str, Any]) -> str:
    qtype = str(q.get("type") or "")
    opts = q.get("options") or []
    ans = str(q.get("answer") or "").strip().upper()
    if "选择" in qtype or opts:
        if len(opts) < 4:
            return "选择题选项不足 4 项，需补全 A/B/C/D 四个互不重复选项"
        if not ans or ans[0] not in ("A", "B", "C", "D"):
            return "选择题参考答案缺失或格式不规范，需明确为 A/B/C/D"
    if not str(q.get("stem") or "").strip():
        return "题干为空"
    if not str(q.get("answer") or "").strip() and not (q.get("parts") or []):
        return "缺少参考答案"
    return ""


async def verify_and_repair_exam(
    exam_obj: dict[str, Any],
    *,
    max_retries: int = 2,
) -> tuple[dict[str, Any], int]:
    """Check each exam question deterministically; auto-rewrite any mismatched/malformed item."""
    questions = list(exam_obj.get("questions") or [])
    total_score = 0
    repaired_count = 0

    for idx, q in enumerate(questions):
        cur_q = dict(q)
        for _ in range(max_retries):
            issue = _choice_question_needs_repair(cur_q)
            checks = cur_q.get("sympy_checks") or []
            ver = run_symbolic_checks(checks) if checks else None
            if not issue and (not ver or ver.get("status") != "mismatch"):
                break

            fail_notes = [issue] if issue else []
            if ver and ver.get("status") == "mismatch":
                for c in ver.get("checks") or []:
                    if not c.get("passed"):
                        fail_notes.append(f"{c.get('label')}: {c.get('detail')}")

            prompt = (
                f"学科：{exam_obj.get('subject', '')} ｜ 学段：{exam_obj.get('grade_level', '')}\n"
                f"以下第 {idx + 1} 题未通过自动校验，原因：\n"
                + "\n".join(f"- {n}" for n in fail_notes if n)
                + f"\n\n原题内容：\n{json.dumps(cur_q, ensure_ascii=False)}\n\n"
                "请修正题干条件、选项、答案、解析与核验列表，保持单题 JSON 结构完整输出。"
            )
            try:
                fixed, _ = await call_llm_json(
                    system_prompt="你是严谨的试题质检与修正助手。请直接修正条件漏洞或答案偏差，只输出单个合法题目 JSON 对象。",
                    user_prompt=prompt,
                    max_tokens=3200,
                    temperature=0.1,
                )
                if isinstance(fixed, dict) and fixed.get("stem"):
                    cur_q = fixed
                    cur_q["auto_repaired"] = True
                    repaired_count += 1
            except Exception:
                break

        checks = cur_q.get("sympy_checks") or []
        if checks:
            ver_final = run_symbolic_checks(checks)
            if cur_q.get("auto_repaired") and ver_final.get("status") == "verified":
                ver_final["auto_repaired"] = True
                ver_final["badge"] = f"自动修正后核对通过 ({ver_final.get('passed', 0)}/{ver_final.get('total', 0)})"
            cur_q["verification"] = ver_final
        elif not cur_q.get("verification"):
            cur_q["verification"] = {"status": "needs_review", "badge": "定性题目 · 建议人工核对", "checks": []}

        total_score += int(cur_q.get("score") or 5)
        questions[idx] = cur_q

    exam_obj["questions"] = questions
    exam_obj["total_score"] = total_score or exam_obj.get("total_score", 40)
    return exam_obj, repaired_count


_SLIDE_CLEAN_MAP = [
    (r"\$", ""),
    (r"\\times", "×"),
    (r"\\cdot", "·"),
    (r"\\leq", "≤"),
    (r"\\le", "≤"),
    (r"\\geq", "≥"),
    (r"\\ge", "≥"),
    (r"\\neq", "≠"),
    (r"\\approx", "≈"),
    (r"\\Rightarrow", "⇒"),
    (r"\\to", "→"),
    (r"\\rightarrow", "→"),
    (r"\\pi", "π"),
    (r"\\ln", "ln"),
    (r"\\sin", "sin"),
    (r"\\cos", "cos"),
    (r"\\Delta", "Δ"),
    (r"\\left", ""),
    (r"\\right", ""),
]


def _clean_slide_str(text: str) -> str:
    s = str(text or "")
    s = re.sub(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r"\1/\2", s)
    s = re.sub(r"\\sqrt\s*\{([^{}]+)\}", r"√\1", s)
    for pat, rep in _SLIDE_CLEAN_MAP:
        s = re.sub(pat, rep, s)
    return s.strip()


def sanitize_and_repair_slides(slides: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Deterministically strip raw markup leakage, validate graph/chart slides, and compact overlong titles."""
    cleaned_slides: list[dict[str, Any]] = []
    fix_count = 0

    for idx, raw_sl in enumerate(slides):
        sl = dict(raw_sl)
        # Clean stray LaTeX markup across top text fields & cards
        for key in ("title", "subtitle", "kicker", "takeaway", "speaker_notes", "chart_title"):
            if key in sl and sl[key] is not None:
                c_val = _clean_slide_str(str(sl[key]))
                if c_val != str(sl[key]):
                    fix_count += 1
                sl[key] = c_val

        # Compact overly long slide title gracefully on punctuation boundaries
        title = str(sl.get("title") or "")
        if len(title) > 26:
            fix_count += 1
            parts = re.split(r"[：:，,；;]", title)
            short = parts[0].strip() if len(parts[0].strip()) >= 4 else title[:24]
            sl["title"] = short[:24]
            if not sl.get("subtitle"):
                sl["subtitle"] = title[:38]

        subtitle = str(sl.get("subtitle") or "")
        if len(subtitle) > 42:
            fix_count += 1
            extra = subtitle[40:]
            sl["subtitle"] = subtitle[:40].rstrip("，,；;") + "…"
            notes = str(sl.get("speaker_notes") or "")
            if extra and extra not in notes:
                sl["speaker_notes"] = f"{notes} {subtitle}".strip()

        cards = sl.get("cards") or []
        new_cards = []
        for card in cards:
            nc = dict(card)
            for ck in ("heading", "body", "tag"):
                if ck in nc and nc[ck] is not None:
                    nc[ck] = _clean_slide_str(str(nc[ck]))
            if "bullets" in nc and isinstance(nc["bullets"], list):
                nc["bullets"] = [_clean_slide_str(str(b)) for b in nc["bullets"]]
            new_cards.append(nc)
        if new_cards:
            sl["cards"] = new_cards

        layout = str(sl.get("layout") or "objectives")
        if idx == 0:
            layout = "cover"
            sl["layout"] = "cover"

        if layout == "visual_graph":
            expr = str(sl.get("plot_expr") or "").strip()
            test_plot = sample_function_plot(expr) if expr else {"ok": False}
            if not test_plot.get("ok"):
                fallback = extract_plottable_expression(f"{sl.get('title','')} {sl.get('subtitle','')}")
                sl["plot_expr"] = fallback[0] if fallback else "x**3 - 3*x**2 + 2"
                fix_count += 1

        if layout == "data_chart" and not (sl.get("chart_bars") or []):
            sl["chart_bars"] = [
                {"label": "概念理解", "value": 86},
                {"label": "推演计算", "value": 74},
                {"label": "边界辨析", "value": 61},
            ]
            sl["chart_title"] = sl.get("chart_title") or "关键能力掌握度对比"
            fix_count += 1

        cleaned_slides.append(sl)

    return cleaned_slides, fix_count
