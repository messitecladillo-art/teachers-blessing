"""Cross-disciplinary Pedagogy Knowledge Base API (9 Domains x 45 Branches)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from engines.pedagogy_kb import (
    get_taxonomy_with_counts,
    list_all_topics,
    load_pedagogy_corpus,
    retrieve_pedagogy_insights,
)

router = APIRouter(prefix="/api/pedagogy", tags=["pedagogy"])


@router.get("/taxonomy")
async def get_pedagogy_taxonomy() -> dict[str, Any]:
    return {"ok": True, **get_taxonomy_with_counts()}


@router.get("/topics")
async def get_pedagogy_topics(
    subject: str | None = None,
    domain: str | None = None,
    branch: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    all_items = load_pedagogy_corpus()
    topics = list_all_topics(subject=subject, domain_id=domain, branch=branch, q=q)
    subjects = sorted({t.get("subject", "其他") for t in all_items})
    tax = get_taxonomy_with_counts()
    return {
        "ok": True,
        "topics": topics,
        "subjects": subjects,
        "domains": tax["domains"],
        "total": len(topics),
    }


@router.get("/search")
async def search_pedagogy_topics(
    q: str = "",
    subject: str = "",
    domain: str = "",
    branch: str = "",
    limit: int = 4,
) -> dict[str, Any]:
    if not q.strip():
        return {
            "ok": True,
            "results": list_all_topics(subject=subject or None, domain_id=domain or None, branch=branch or None)[:limit],
        }
    matches = retrieve_pedagogy_insights(q, subject=subject, domain_id=domain, branch=branch, limit=limit)
    return {"ok": True, "results": matches}
