"""Full-document chapter indexing and lexical/math-token retrieval across uploaded course packs."""

from __future__ import annotations

import math
import re
import time
from pathlib import Path
from typing import Any

from core.config import UPLOADS_DIR
from core.database import get_conn, new_id
from engines.source_ingestor import extract_structured_chapters, split_markdown_to_chapters


def _tokenize_mixed(text: str) -> set[str]:
    """Tokenize Chinese character bigrams plus ASCII/math words for fast, dependency-free retrieval."""
    s = (text or "").lower()
    tokens: set[str] = set()
    # ASCII / math words & symbols
    for m in re.findall(r"[a-z0-9_]{2,}", s):
        tokens.add(m)
    # Chinese sequences -> unigrams + bigrams
    for run in re.findall(r"[\u4e00-\u9fff]+", s):
        for i in range(len(run)):
            tokens.add(run[i])
            if i + 1 < len(run):
                tokens.add(run[i : i + 2])
    return tokens


def index_markdown_document(
    *,
    doc_id: str,
    filename: str,
    title: str,
    markdown_text: str,
    file_path: str = "",
    quality_note: str = "",
) -> dict[str, Any]:
    """Index raw Markdown text into source_documents & source_chunks."""
    chunks = split_markdown_to_chapters(markdown_text, default_title=title)
    now = time.time()
    with get_conn() as conn:
        conn.execute("DELETE FROM source_chunks WHERE doc_id = ?", (doc_id,))
        conn.execute(
            """
            INSERT OR REPLACE INTO source_documents (id, filename, title, file_path, char_count, chunk_count, quality_note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (doc_id, filename, title, file_path, len(markdown_text), len(chunks), quality_note, now),
        )
        for idx, ch in enumerate(chunks):
            conn.execute(
                """
                INSERT INTO source_chunks (id, doc_id, doc_title, chapter_title, chunk_index, content, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (new_id("chk"), doc_id, title, ch["chapter_title"], idx, ch["content"], now),
            )
    return {
        "doc_id": doc_id,
        "filename": filename,
        "title": title,
        "char_count": len(markdown_text),
        "chunk_count": len(chunks),
        "quality_note": quality_note,
        "chapters": [c["chapter_title"] for c in chunks[:12]],
    }


def index_uploaded_document(doc_id: str, filename: str, file_path: Path) -> dict[str, Any]:
    """Extract all chapters from an uploaded single file or ZIP archive and index into SQLite."""
    extracted = extract_structured_chapters(file_path)
    chunks = extracted.get("chunks") or []
    title = Path(filename).stem
    now = time.time()
    quality_note = str(extracted.get("quality_note") or "")
    char_count = int(extracted.get("char_count") or 0)

    with get_conn() as conn:
        conn.execute("DELETE FROM source_chunks WHERE doc_id = ?", (doc_id,))
        conn.execute(
            """
            INSERT OR REPLACE INTO source_documents (id, filename, title, file_path, char_count, chunk_count, quality_note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (doc_id, filename, title, str(file_path), char_count, len(chunks), quality_note, now),
        )
        for idx, ch in enumerate(chunks):
            conn.execute(
                """
                INSERT INTO source_chunks (id, doc_id, doc_title, chapter_title, chunk_index, content, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (new_id("chk"), doc_id, title, ch["chapter_title"], idx, ch["content"], now),
            )
    return {
        "doc_id": doc_id,
        "filename": filename,
        "title": title,
        "char_count": char_count,
        "chunk_count": len(chunks),
        "quality_note": quality_note,
        "chapters": [c["chapter_title"] for c in chunks[:12]],
    }


def list_indexed_documents() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM source_documents ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def get_document_chunks(doc_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM source_chunks WHERE doc_id = ? ORDER BY chunk_index ASC",
            (doc_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def search_source_chunks(query: str, doc_id: str | None = None, limit: int = 5) -> list[dict[str, Any]]:
    """Rank indexed document chunks by mixed Chinese bigram + keyword + title overlap."""
    q_clean = (query or "").strip()
    q_tokens = _tokenize_mixed(q_clean)

    with get_conn() as conn:
        if doc_id:
            rows = conn.execute("SELECT * FROM source_chunks WHERE doc_id = ?", (doc_id,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM source_chunks").fetchall()

    if not rows:
        return []

    if not q_tokens:
        return [dict(r) | {"score": 1.0} for r in rows[:limit]]

    scored: list[tuple[float, dict[str, Any]]] = []
    q_lower = q_clean.lower()
    q_phrases = [w for w in re.findall(r"[\u4e00-\u9fff]{2,}|[a-z0-9_]{2,}", q_lower)]
    q_bigrams = {t for t in q_tokens if len(t) >= 2}
    for r in rows:
        item = dict(r)
        ch_toks = _tokenize_mixed(item["chapter_title"])
        body_toks = _tokenize_mixed(item["content"])
        overlap_bigrams = len(q_bigrams & body_toks)
        overlap_uni = len((q_tokens - q_bigrams) & body_toks)
        overlap_title = len(q_tokens & ch_toks)
        if overlap_bigrams == 0 and overlap_uni == 0 and overlap_title == 0:
            continue
        phrase_hits = sum(1 for ph in q_phrases if ph in item["content"].lower() or ph in item["chapter_title"].lower())
        title_boost = overlap_title * 2.5
        length_norm = math.sqrt(max(40, len(item["content"])))
        raw_score = overlap_bigrams * 2.5 + overlap_uni * 0.5 + title_boost + phrase_hits * 5.0
        score = round(raw_score / (1.0 + 0.025 * length_norm), 3)
        item["score"] = score
        scored.append((score, item))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:limit]]


def delete_indexed_document(doc_id: str) -> bool:
    """Delete an indexed document, its chunks, and its uploaded binary file if inside uploads directory."""
    with get_conn() as conn:
        row = conn.execute("SELECT file_path FROM source_documents WHERE id = ?", (doc_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM source_chunks WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM source_documents WHERE id = ?", (doc_id,))
        file_path = str(row["file_path"] or "").strip()

    if file_path:
        try:
            p = Path(file_path).resolve()
            if UPLOADS_DIR.resolve() in p.parents and p.is_file():
                p.unlink(missing_ok=True)
        except Exception:
            pass
    return True
