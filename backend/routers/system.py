"""System status, model settings (secret-safe), telemetry summary, and privacy purge."""

from __future__ import annotations

import shutil
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from core.bootstrap import ensure_showcase_data
from core.config import EXPORTS_DIR, PPT_PROJECTS_DIR, UPLOADS_DIR, runtime_llm_config
from core.database import get_telemetry_summary, purge_all_tables

router = APIRouter(prefix="/api/system", tags=["system"])


class LLMConfigPatch(BaseModel):
    protocol: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    max_tokens: int | None = None


@router.get("/status")
async def system_status() -> dict[str, Any]:
    return {
        "ok": True,
        "app_name": "教学与学习工作台",
        "version": "1.0.0",
        "llm": runtime_llm_config.public_summary(),
        "telemetry": get_telemetry_summary(),
    }


@router.post("/config")
async def update_llm_config(patch: LLMConfigPatch) -> dict[str, Any]:
    if patch.protocol in ("anthropic", "openai"):
        runtime_llm_config.protocol = patch.protocol
    if patch.base_url is not None and patch.base_url.strip():
        runtime_llm_config.base_url = patch.base_url.strip()
    if patch.api_key is not None and patch.api_key.strip():
        runtime_llm_config.api_key = patch.api_key.strip()
    if patch.model is not None and patch.model.strip():
        runtime_llm_config.model = patch.model.strip()
    if patch.max_tokens is not None and 1000 <= patch.max_tokens <= 32000:
        runtime_llm_config.max_tokens = patch.max_tokens
    return {"ok": True, "llm": runtime_llm_config.public_summary()}


@router.get("/telemetry")
async def telemetry_summary() -> dict[str, Any]:
    return {
        "ok": True,
        "telemetry": get_telemetry_summary(),
        "survey_benchmarks": {
            "sample_n": 52,
            "normal_students_pct": 51.92,
            "college_students_pct": 86.54,
            "dual_role_overlap_in_normal": "17/27 涉教 · 19/27 涉学 · 9人双向重叠",
            "top_concerns": [
                {"label": "内容不准确担忧", "pct": 78.85, "countermeasure": "公式自动验算 + 推理依据说明 + 复核提示"},
                {"label": "过度依赖/削弱思考", "pct": 48.08, "countermeasure": "默认分步启发提示，先思考再看解析"},
                {"label": "收费过高顾虑", "pct": 38.46, "countermeasure": "基础功能免费 + 低门槛月费分级"},
                {"label": "隐私与数据安全", "pct": 34.62, "countermeasure": "本地姓名学号自动脱敏 + 一键清空记录"},
            ],
            "teaching_high_demand": [
                {"label": "按知识点出题/组卷", "rate": 90.0, "mean": 4.43},
                {"label": "生成教案/教学设计", "rate": 90.0, "mean": 4.27},
                {"label": "生成学情分析报告", "rate": 90.0, "mean": 4.30},
                {"label": "生成并美化课件 PPT", "rate": 80.0, "mean": 4.30, "very_needed": 16},
            ],
            "learning_high_demand": [
                {"label": "难题讲解与实时答疑", "rate": 84.78, "mean": 4.28},
                {"label": "知识点串讲/预习复习", "rate": 80.43, "mean": 4.20},
                {"label": "错题整理与同类题练习", "rate": 73.91, "mean": 4.07},
                {"label": "个性化学习/复习计划", "rate": 71.74, "mean": 4.00},
            ],
        },
    }


@router.post("/privacy/purge")
async def purge_privacy_data(restore_showcase: bool = False) -> dict[str, Any]:
    """One-click irreversible wipe of all user records, uploaded files, and generated exports."""
    deleted_counts = purge_all_tables()
    removed_files = 0
    for directory in (UPLOADS_DIR, PPT_PROJECTS_DIR, EXPORTS_DIR):
        for item in directory.iterdir():
            try:
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
                removed_files += 1
            except Exception:
                pass
    if restore_showcase:
        ensure_showcase_data()
    return {
        "ok": True,
        "deleted_tables": deleted_counts,
        "removed_files": removed_files,
        "restored_showcase": restore_showcase,
    }
