"""Source document upload & Markdown extraction via ppt-master's source_to_md.py."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from core.config import UPLOADS_DIR
from core.database import new_id
from engines.knowledge_index import (
    delete_indexed_document,
    get_document_chunks,
    index_uploaded_document,
    list_indexed_documents,
    search_source_chunks,
)
from engines.source_ingestor import convert_uploaded_source_to_markdown

router = APIRouter(prefix="/api/sources", tags=["sources"])

ALLOWED_EXTS = {
    ".pdf",
    ".docx",
    ".pptx",
    ".xlsx",
    ".xlsm",
    ".md",
    ".txt",
    ".csv",
    ".tex",
    ".latex",
    ".html",
    ".htm",
    ".zip",
}


@router.post("/upload")
async def upload_and_parse_source(file: UploadFile = File(...)) -> dict[str, Any]:
    orig_name = Path(file.filename or "document.txt").name
    ext = Path(orig_name).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"暂不支持的文件格式 {ext}，支持：{', '.join(sorted(ALLOWED_EXTS))}")

    uid = new_id("src")
    dest_path = UPLOADS_DIR / f"{uid}_{orig_name}"
    raw_bytes = await file.read()
    if len(raw_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="单文件请勿超过 50MB")
    dest_path.write_bytes(raw_bytes)

    try:
        parsed = convert_uploaded_source_to_markdown(dest_path)
        idx_res = index_uploaded_document(uid, orig_name, dest_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"文档解析失败：{exc}") from exc

    md_text = str(parsed["markdown"])
    return {
        "ok": True,
        "source_id": uid,
        "filename": orig_name,
        "converter": parsed["converter"],
        "char_count": parsed["char_count"],
        "chunk_count": idx_res.get("chunk_count", 0),
        "quality_note": idx_res.get("quality_note", ""),
        "chapters_preview": idx_res.get("chapters", []),
        "markdown_preview": md_text[:8000],
        "markdown_full": md_text[:24000],
    }


@router.get("/list")
async def list_sources() -> dict[str, Any]:
    return {"ok": True, "documents": list_indexed_documents()}


@router.get("/search")
async def search_sources(q: str = Query(""), doc_id: str = Query(""), limit: int = Query(5)) -> dict[str, Any]:
    hits = search_source_chunks(q, doc_id=doc_id or None, limit=max(1, min(12, limit)))
    return {"ok": True, "results": hits, "total": len(hits)}


@router.get("/{doc_id}/chunks")
async def get_source_chunks_endpoint(doc_id: str) -> dict[str, Any]:
    return {"ok": True, "chunks": get_document_chunks(doc_id)}


@router.delete("/{doc_id}")
async def delete_source_endpoint(doc_id: str) -> dict[str, Any]:
    deleted = delete_indexed_document(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="讲义资料不存在")
    return {"ok": True, "doc_id": doc_id}
