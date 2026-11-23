"""Artifact Vault API for listing, downloading, and deleting real exported files."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from core.database import delete_artifact, get_artifact, list_artifacts

router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])


@router.get("")
async def get_all_artifacts(module: str | None = None) -> dict[str, Any]:
    return {"ok": True, "artifacts": list_artifacts(module=module)}


@router.get("/{artifact_id}/download")
async def download_artifact(artifact_id: str) -> FileResponse:
    art = get_artifact(artifact_id)
    if not art:
        raise HTTPException(status_code=404, detail="未找到该产出物记录")
    path = Path(art["file_path"])
    if not path.is_file():
        raise HTTPException(status_code=404, detail="产出物文件已被移动或删除")
    encoded_name = quote(art["filename"])
    return FileResponse(
        path=str(path),
        media_type=art["mime_type"],
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"},
    )


@router.delete("/{artifact_id}")
async def remove_artifact(artifact_id: str) -> dict[str, Any]:
    art = get_artifact(artifact_id)
    if not art:
        raise HTTPException(status_code=404, detail="产出物不存在")
    path = Path(art["file_path"])
    if path.is_file():
        path.unlink(missing_ok=True)
    delete_artifact(artifact_id)
    return {"ok": True, "deleted_id": artifact_id}
