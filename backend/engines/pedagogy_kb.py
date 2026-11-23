"""Cross-disciplinary Pedagogy Knowledge Base (9 Domains x 45 Branches) & RAG retrieval engine."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from core.config import BACKEND_DIR

CORPUS_PATH = BACKEND_DIR / "data" / "zhihu_pedagogy_corpus.json"
TAXONOMY_PATH = BACKEND_DIR / "data" / "discipline_taxonomy.json"


@lru_cache(maxsize=1)
def load_pedagogy_corpus() -> list[dict[str, Any]]:
    if not CORPUS_PATH.is_file():
        return []
    return json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_discipline_taxonomy() -> list[dict[str, Any]]:
    if not TAXONOMY_PATH.is_file():
        return []
    return json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))


def get_taxonomy_with_counts() -> dict[str, Any]:
    domains = load_discipline_taxonomy()
    topics = load_pedagogy_corpus()
    dom_counts: dict[str, int] = {}
    branch_counts: dict[tuple[str, str], int] = {}
    for t in topics:
        did = t.get("domain_id", "")
        br = t.get("branch", "")
        dom_counts[did] = dom_counts.get(did, 0) + 1
        branch_counts[(did, br)] = branch_counts.get((did, br), 0) + 1

    enriched = []
    total_branches = 0
    for d in domains:
        did = d["id"]
        branches_out = []
        for b in d.get("branches", []):
            total_branches += 1
            branches_out.append({**b, "topic_count": branch_counts.get((did, b["name"]), 0)})
        enriched.append({**d, "branches": branches_out, "topic_count": dom_counts.get(did, 0)})

    return {
        "domains": enriched,
        "total_domains": len(enriched),
        "total_branches": total_branches,
        "total_topics": len(topics),
    }


def _topic_matches_query(topic: dict[str, Any], q_low: str) -> bool:
    if not q_low:
        return True
    haystack = [
        topic.get("title", ""),
        topic.get("subject", ""),
        topic.get("domain_name", ""),
        topic.get("branch", ""),
        topic.get("board_punchline", ""),
        " ".join(topic.get("keywords", [])),
        " ".join(m.get("name", "") + " " + m.get("desc", "") for m in topic.get("intuition_models", [])),
        " ".join(
            lk.get("domain", "") + " " + lk.get("title", "") + " " + lk.get("mechanism", "")
            for lk in topic.get("interdisciplinary_links", [])
        ),
    ]
    joined = " ".join(haystack).lower()
    return q_low in joined


def list_all_topics(
    subject: str | None = None,
    domain_id: str | None = None,
    branch: str | None = None,
    q: str | None = None,
) -> list[dict[str, Any]]:
    items = load_pedagogy_corpus()
    dom_filter = (domain_id or "").strip()
    br_filter = (branch or "").strip()
    sub_filter = (subject or "").strip()
    q_low = (q or "").strip().lower()

    out = []
    for x in items:
        if dom_filter and dom_filter not in ("全部", "all") and x.get("domain_id") != dom_filter:
            continue
        if br_filter and br_filter not in ("全部", "all") and x.get("branch") != br_filter:
            continue
        if sub_filter and sub_filter not in ("全部", "all") and sub_filter not in x.get("subject", ""):
            continue
        if q_low and not _topic_matches_query(x, q_low):
            continue
        out.append(x)
    return out


def retrieve_pedagogy_insights(
    query: str,
    *,
    subject: str = "",
    domain_id: str = "",
    branch: str = "",
    limit: int = 2,
) -> list[dict[str, Any]]:
    """Score and retrieve top matching cross-disciplinary pedagogy guides for RAG injection & UI citation."""
    items = load_pedagogy_corpus()
    q_low = (query or "").lower()
    subj_low = (subject or "").lower()
    dom_low = (domain_id or "").strip()
    br_low = (branch or "").strip()

    scored: list[tuple[int, dict[str, Any]]] = []
    for item in items:
        score = 0
        if dom_low and item.get("domain_id") == dom_low:
            score += 5
        if br_low and item.get("branch") == br_low:
            score += 7
        if subj_low and subj_low in item.get("subject", "").lower():
            score += 3
        title = item.get("title", "").lower()
        for kw in item.get("keywords", []):
            kw_low = kw.lower()
            if kw_low in q_low:
                score += 10
            elif any(tok in q_low for tok in kw_low.split() if len(tok) >= 2):
                score += 4
        for lk in item.get("interdisciplinary_links", []):
            if lk.get("domain", "").lower() in q_low or lk.get("title", "").lower() in q_low:
                score += 4
        # Character bigram overlap fallback for Chinese queries
        for idx in range(max(0, len(title) - 1)):
            bg = title[idx : idx + 2]
            if bg.strip() and bg in q_low:
                score += 2
        if score > 0:
            scored.append((score, item))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    if not scored:
        return [x for x in items if x["id"] in ("zhihu_deriv_mono", "zhihu_micro_teaching")][:limit]
    return [pair[1] for pair in scored[:limit]]


def format_pedagogy_rag_context(matches: list[dict[str, Any]]) -> str:
    """Format matched guides as compact, high-depth cross-disciplinary pedagogical priors for LLM prompts."""
    if not matches:
        return ""
    blocks: list[str] = ["【全学科直观讲法、苏格拉底追问链与跨学科桥接参考（请优先融入类比模型与迁移视角）】"]
    for m in matches:
        intuitions = "；".join(f"{im['name']}：{im['desc']}" for im in m.get("intuition_models", []))
        pitfalls = "；".join(m.get("pitfalls_and_counterexamples", [])[:2])
        socratic = " → ".join(f"{sc.get('step','')}: {sc.get('question','')}" for sc in m.get("socratic_chain", [])[:2])
        links = "；".join(f"[{lk.get('domain','')}] {lk.get('title','')}" for lk in m.get("interdisciplinary_links", [])[:2])
        blocks.append(
            f"- 专题《{m['title']}》[{m.get('domain_name','')} · {m.get('branch','')}]\n"
            f"  核心范式：{m.get('core_formula_latex', '')}\n"
            f"  直观模型：{intuitions}\n"
            f"  苏格拉底追问：{socratic}\n"
            f"  跨学科迁移：{links}\n"
            f"  易错反例：{pitfalls}\n"
            f"  板书金句：{m.get('board_punchline', '')}"
        )
    return "\n".join(blocks)
