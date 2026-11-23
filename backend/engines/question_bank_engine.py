"""High School Math Question Bank Engine (4,642 curated Renjiao-A items, multi-version & multi-part assembly)."""

from __future__ import annotations

import json
import math
import random
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_BANK_PATH = Path(__file__).resolve().parents[1] / "data" / "renjiao_math_question_bank.json"

_LEVELS = ("basic", "medium", "advanced", "reasoning")
_LEVEL_CN = {
    "basic": "基础",
    "medium": "中等",
    "advanced": "提高",
    "reasoning": "综合递进",
}
_TYPE_ORDER = ("choice", "fill", "solution", "reasoning")
_TYPE_CN = {
    "choice": "选择题",
    "fill": "填空题",
    "solution": "解答题",
    "reasoning": "递进解答题",
}
_THINKING_TIME = {"min_share": 0.66, "max_share": 0.88, "review_minutes": 6}


@lru_cache(maxsize=1)
def load_math_bank() -> dict[str, Any]:
    """Load the extracted 4,642-item curriculum question bank."""
    if not _BANK_PATH.is_file():
        return {"version": 2, "books": {}, "chapters": [], "items": []}
    return json.loads(_BANK_PATH.read_text(encoding="utf-8"))


def _topic_lookup_map(bank: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for ch in bank.get("chapters") or []:
        for tp in ch.get("topics") or []:
            out[str(tp["id"])] = str(tp["name"])
    return out


def get_bank_catalog() -> dict[str, Any]:
    """Return book/chapter/topic catalog with live item counts."""
    bank = load_math_bank()
    items = bank.get("items") or []
    unit_counts: dict[str, int] = {}
    topic_counts: dict[str, int] = {}
    reasoning_count = 0
    for it in items:
        u = str(it.get("unit") or "")
        t = str(it.get("topic") or "")
        unit_counts[u] = unit_counts.get(u, 0) + 1
        topic_counts[t] = topic_counts.get(t, 0) + 1
        if it.get("difficulty") == "reasoning":
            reasoning_count += 1

    chapters = []
    for ch in bank.get("chapters") or []:
        topics_enriched = [
            {**tp, "count": topic_counts.get(str(tp["id"]), 0)}
            for tp in (ch.get("topics") or [])
        ]
        chapters.append(
            {
                **ch,
                "count": unit_counts.get(str(ch["id"]), 0),
                "topics": topics_enriched,
            }
        )

    return {
        "books": bank.get("books") or {},
        "chapters": chapters,
        "total_items": len(items),
        "reasoning_items": reasoning_count,
    }


def _compute_quota(mode: str, preference: str, count: int, reasoning_families: int) -> dict[str, int]:
    if mode == "strategy":
        basic = math.ceil(count * 0.6) if preference == "foundation" else count // 2
        if preference == "challenge":
            advanced = max(1, int((count - basic) * 0.7))
        elif preference == "balanced" and count >= 9:
            advanced = 2
        else:
            advanced = 1
        medium = max(0, count - basic - advanced)
        return {"basic": basic, "medium": medium, "advanced": advanced, "reasoning": 0}

    reasoning = min(reasoning_families, 1 if preference == "foundation" else 2)
    basic = 1 if (count >= 5 and (preference != "challenge" or reasoning == 2)) else 0
    other = max(0, count - reasoning - basic)
    if reasoning == 1:
        advanced = min(max(0, other - 1), 1 if preference == "foundation" else 2)
    elif preference == "challenge":
        advanced = min(other, 1)
    else:
        advanced = 0
    medium = max(0, other - advanced)
    return {"basic": basic, "medium": medium, "advanced": advanced, "reasoning": reasoning}


def _choose_set(
    pools: dict[str, list[dict[str, Any]]],
    quantities: dict[str, int],
    prev_ids: set[str],
    prev_families: dict[str, int],
    rng: random.Random,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    topic_counts: dict[str, int] = {}
    family_counts: dict[str, int] = {}

    for level in ("reasoning", "advanced", "basic", "medium"):
        candidates = list(pools.get(level) or [])
        rng.shuffle(candidates)
        for _ in range(quantities.get(level, 0)):
            best: dict[str, Any] | None = None
            best_score = float("inf")
            for item in candidates:
                iid = str(item["id"])
                fam = str(item.get("family") or iid)
                top = str(item.get("topic") or "")
                if iid in prev_ids or iid in used_ids:
                    continue
                if level == "reasoning" and fam in family_counts:
                    continue
                score = (
                    family_counts.get(fam, 0) * 1000
                    + topic_counts.get(top, 0) * 12
                    + prev_families.get(fam, 0)
                )
                if score < best_score:
                    best_score = score
                    best = item
            if best is None:
                # Relax non-overlap across family if narrow topic pool selected
                raise ValueError("当前所选知识点的可用递进题或备选题不足，请扩大知识点范围，或适当减少题量与套数。")
            selected.append(best)
            used_ids.add(str(best["id"]))
            tkey = str(best.get("topic") or "")
            fkey = str(best.get("family") or best["id"])
            topic_counts[tkey] = topic_counts.get(tkey, 0) + 1
            family_counts[fkey] = family_counts.get(fkey, 0) + 1

    type_rank = {t: i for i, t in enumerate(_TYPE_ORDER)}
    lvl_rank = {l: i for i, l in enumerate(_LEVELS)}
    selected.sort(
        key=lambda x: (type_rank.get(str(x.get("type")), 99), lvl_rank.get(str(x.get("difficulty")), 99))
    )
    return selected


def recommended_time(mode: str, estimate_minutes: int) -> int:
    if mode == "strategy":
        return max(5, round(estimate_minutes / 1.12))
    return max(estimate_minutes + _THINKING_TIME["review_minutes"], round(estimate_minutes / 0.8))


def time_matches(mode: str, duration: int, estimate: int, short_time: int) -> bool:
    if mode == "thinking":
        return (
            duration * _THINKING_TIME["min_share"] <= estimate <= duration * _THINKING_TIME["max_share"]
            and (duration - estimate) >= _THINKING_TIME["review_minutes"]
        )
    return estimate <= duration * 1.5 and estimate >= duration and short_time <= duration * 0.65


def _convert_item_to_question(item: dict[str, Any], topic_names: dict[str, str], index: int) -> dict[str, Any]:
    raw_type = str(item.get("type") or "solution")
    raw_diff = str(item.get("difficulty") or "medium")
    opts_raw = item.get("options") or []
    options: list[str] = []
    letters = ("A", "B", "C", "D", "E", "F")
    for oi, opt in enumerate(opts_raw):
        txt = str(opt).strip()
        if not re.match(r"^[A-F][\.．、\s]", txt):
            prefix = f"{letters[oi]}. " if oi < len(letters) else ""
            txt = f"{prefix}{txt}"
        options.append(txt)

    parts_raw = item.get("parts") or []
    parts: list[dict[str, Any]] = []
    if parts_raw:
        ans_lines = []
        ana_lines = []
        for pi, pt in enumerate(parts_raw, start=1):
            p_ans = str(pt.get("answer") or "")
            p_exp = str(pt.get("explanation") or "")
            p_pts = int(pt.get("points") or 0)
            parts.append(
                {
                    "prompt": str(pt.get("prompt") or ""),
                    "answer": p_ans,
                    "explanation": p_exp,
                    "points": p_pts,
                    "minutes": int(pt.get("minutes") or 0),
                }
            )
            ans_lines.append(f"（{pi}）{p_ans}")
            ana_lines.append(f"（{pi}）{p_exp}（{p_pts}分）")
        answer = "\n".join(ans_lines)
        analysis = "\n".join(ana_lines)
        focus = str(item.get("focus") or "").strip()
        intent = f"预计 {item.get('minutes', 10)} 分钟" + (f" · 核心思路：{focus}" if focus else "")
    else:
        answer = str(item.get("answer") or "")
        steps_raw = item.get("steps") or []
        step_strs = []
        for si, st in enumerate(steps_raw, start=1):
            if isinstance(st, (list, tuple)) and len(st) >= 2:
                pts_txt = f"（+{st[1]}分）" if int(st[1] or 0) > 0 else ""
                step_strs.append(f"{si}. {st[0]}{pts_txt}")
            else:
                step_strs.append(f"{si}. {st}")
        analysis = "；".join(step_strs)
        intent = f"预计 {item.get('minutes', 3)} 分钟"

    kp_name = topic_names.get(str(item.get("topic") or ""), str(item.get("topic") or "高中数学"))

    return {
        "id": str(item.get("id") or f"q{index}"),
        "type": _TYPE_CN.get(raw_type, "解答题"),
        "score": int(item.get("points") or 5),
        "difficulty": _LEVEL_CN.get(raw_diff, "中等"),
        "knowledge_point": kp_name,
        "stem": str(item.get("stem") or ""),
        "options": options,
        "answer": answer,
        "analysis": analysis,
        "intent": intent,
        "parts": parts,
        "verification": {"status": "verified", "badge": "题库标准答案已核对", "checks": []},
    }


def assemble_from_bank(
    *,
    unit: str,
    topics: list[str] | None = None,
    mode: str = "strategy",
    preference: str = "balanced",
    count: int = 6,
    duration: int = 25,
    versions: int = 1,
    seed: int | None = None,
) -> dict[str, Any]:
    """Assemble 1 or 3 non-overlapping papers from the Renjiao-A 4,642-item bank."""
    if mode not in ("strategy", "thinking"):
        raise ValueError("测验模式必须为 strategy 或 thinking")
    if preference not in ("foundation", "balanced", "challenge"):
        raise ValueError("难度偏好必须为 foundation、balanced 或 challenge")
    if count < 4 or count > 12:
        raise ValueError("每套题量需在 4 到 12 题之间")
    if duration < 5 or duration > 180:
        raise ValueError("测验时间需在 5 到 180 分钟之间")
    if versions not in (1, 3):
        raise ValueError("试卷套数支持 1 套或 3 套")

    bank = load_math_bank()
    chapters = {str(c["id"]): c for c in (bank.get("chapters") or [])}
    ch_obj = chapters.get(unit)
    if not ch_obj:
        raise ValueError(f"未找到章节单元：{unit}")

    book_name = (bank.get("books") or {}).get(str(ch_obj.get("book") or ""), "高中数学")
    unit_name = str(ch_obj.get("name") or unit)
    topic_names = _topic_lookup_map(bank)

    chosen_topics = set(topics or [str(tp["id"]) for tp in (ch_obj.get("topics") or [])])
    if not chosen_topics:
        raise ValueError("请至少选择一个知识点")

    stock = [
        it for it in (bank.get("items") or [])
        if str(it.get("unit")) == unit and str(it.get("topic")) in chosen_topics
    ]
    pools = {lvl: [it for it in stock if str(it.get("difficulty")) == lvl] for lvl in _LEVELS}
    reasoning_families = len({str(it.get("family")) for it in pools["reasoning"]})

    if mode == "thinking" and reasoning_families == 0:
        raise ValueError("当前所选知识点缺少递进解答题，请扩大选题范围或改用限时策略卷。")

    quantities = _compute_quota(mode, preference, count, reasoning_families)
    for lvl in _LEVELS:
        needed = quantities[lvl] * versions
        if len(pools[lvl]) < needed:
            raise ValueError(
                f"当前范围有 {len(pools[lvl])} 道{_LEVEL_CN[lvl]}题，本次需要 {needed} 道，请扩大知识点或调整题量/套数。"
            )

    rng = random.Random(seed)
    prev_ids: set[str] = set()
    prev_families: dict[str, int] = {}
    papers_raw: list[dict[str, Any]] = []

    for v_idx in range(versions):
        chosen = _choose_set(pools, quantities, prev_ids, prev_families, rng)
        est = sum(int(it.get("minutes") or 3) for it in chosen)
        short_t = sum(int(it.get("minutes") or 2) for it in chosen if it.get("difficulty") == "basic")
        pts = sum(int(it.get("points") or 5) for it in chosen)
        papers_raw.append({"items": chosen, "estimate": est, "short_time": short_t, "points": pts, "version_idx": v_idx})
        for it in chosen:
            prev_ids.add(str(it["id"]))
            fam = str(it.get("family") or it["id"])
            prev_families[fam] = prev_families.get(fam, 0) + 1

    max_est = max(p["estimate"] for p in papers_raw)
    rec_min = recommended_time(mode, max_est)
    all_time_ok = all(time_matches(mode, duration, p["estimate"], p["short_time"]) for p in papers_raw)

    mode_label = "限时策略卷" if mode == "strategy" else "充分思考卷"
    pref_label = {"foundation": "基础优先", "balanced": "均衡梯度", "challenge": "提高优先"}[preference]
    grade_guess = "高一年级" if str(ch_obj.get("book") or "").startswith("r") else "高二年级"

    papers: list[dict[str, Any]] = []
    for v_idx, p in enumerate(papers_raw):
        ver_suffix = "" if versions == 1 else f"（{'ABC'[v_idx]}卷）"
        questions = [_convert_item_to_question(it, topic_names, qi + 1) for qi, it in enumerate(p["items"])]
        papers.append(
            {
                "title": f"{unit_name} · {mode_label}{ver_suffix}",
                "subject": f"高中数学 · {book_name}",
                "grade_level": grade_guess,
                "total_score": p["points"],
                "duration_minutes": duration,
                "estimate_minutes": p["estimate"],
                "difficulty_profile": f"{mode_label} · {pref_label}",
                "questions": questions,
            }
        )

    return {
        "papers": papers,
        "recommended_minutes": rec_min,
        "time_matches": all_time_ok,
        "estimate_minutes": papers_raw[0]["estimate"],
        "quantities": quantities,
    }


def find_bank_match(keyword: str) -> dict[str, Any] | None:
    """Find best matching curriculum unit and topic IDs in the 4,642-item math bank."""
    kw = (keyword or "").strip().lower()
    if not kw:
        return None
    bank = load_math_bank()
    best_unit: dict[str, Any] | None = None
    best_topics: list[str] = []
    best_score = 0

    for ch in bank.get("chapters") or []:
        ch_name = str(ch.get("name") or "").lower()
        ch_score = 0
        matched_tids: list[str] = []
        if any(tok in ch_name for tok in re.split(r"[\s、，,]+", kw) if len(tok) >= 2):
            ch_score += 3
        for tp in ch.get("topics") or []:
            t_name = str(tp.get("name") or "").lower()
            overlap = sum(1 for c in set(kw) if c in t_name and "\u4e00" <= c <= "\u9fff")
            if kw in t_name or t_name in kw or overlap >= 2:
                matched_tids.append(str(tp["id"]))
                ch_score += 4 + overlap
        if ch_score > best_score:
            best_score = ch_score
            best_unit = ch
            best_topics = matched_tids

    if not best_unit or best_score < 3:
        return None
    return {"unit": str(best_unit["id"]), "unit_name": str(best_unit["name"]), "topics": best_topics}


def search_bank_questions(keyword: str, limit: int = 5) -> list[dict[str, Any]]:
    """Search sample questions across the 4,642-item bank by topic name or stem text."""
    bank = load_math_bank()
    topic_names = _topic_lookup_map(bank)
    kw = (keyword or "").strip().lower()
    hits: list[tuple[int, dict[str, Any]]] = []
    for it in bank.get("items") or []:
        t_name = topic_names.get(str(it.get("topic") or ""), "").lower()
        stem = str(it.get("stem") or "").lower()
        score = (5 if kw in t_name else 0) + (3 if kw in stem else 0)
        if score == 0:
            cjk = [c for c in kw if "\u4e00" <= c <= "\u9fff"]
            score = sum(1 for c in cjk if c in t_name)
        if score >= 2:
            hits.append((score, _convert_item_to_question(it, topic_names, len(hits) + 1)))
    hits.sort(key=lambda x: x[0], reverse=True)
    return [q for _, q in hits[:limit]]
