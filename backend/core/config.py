"""Application configuration and secure runtime settings management."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
VENDOR_DIR = PROJECT_ROOT / "vendor"
PPT_MASTER_DIR = VENDOR_DIR / "ppt-master"
PPT_MASTER_SCRIPTS_DIR = PPT_MASTER_DIR / "skills" / "ppt-master" / "scripts"

STORAGE_DIR = BACKEND_DIR / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
PPT_PROJECTS_DIR = STORAGE_DIR / "ppt_projects"
EXPORTS_DIR = STORAGE_DIR / "exports"
DB_PATH = STORAGE_DIR / "eduforge.db"

for _d in (STORAGE_DIR, UPLOADS_DIR, PPT_PROJECTS_DIR, EXPORTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)


@dataclass
class RuntimeLLMConfig:
    """In-memory LLM gateway configuration; never serializes secret API keys."""

    protocol: str = "anthropic"  # "anthropic" | "openai"
    base_url: str = "https://api.deepseek.com/anthropic"
    api_key: str = ""
    model: str = "deepseek-chat"
    temperature: float = 0.35
    max_tokens: int = 8192

    @classmethod
    def from_env(cls) -> "RuntimeLLMConfig":
        anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        anthropic_base = os.environ.get("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic").strip()
        # Prefer fast, low-latency deepseek-chat for interactive streaming (prevents 60s+ reasoning timeouts)
        anthropic_model = os.environ.get("EDUFORGE_DEFAULT_MODEL", "deepseek-chat").strip() or "deepseek-chat"

        if anthropic_key:
            return cls(
                protocol="anthropic",
                base_url=anthropic_base,
                api_key=anthropic_key,
                model=anthropic_model,
            )

        openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
        openai_base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
        openai_model = os.environ.get("OPENAI_MODEL", "gpt-4o").strip()
        return cls(
            protocol="openai",
            base_url=openai_base,
            api_key=openai_key,
            model=openai_model,
        )

    def public_summary(self) -> dict:
        parsed = urlparse(self.base_url or "")
        host = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else self.base_url
        return {
            "protocol": self.protocol,
            "base_url_host": host,
            "model": self.model,
            "has_api_key": bool(self.api_key),
            "key_source": "env" if self.api_key == os.environ.get("ANTHROPIC_API_KEY", "") and self.api_key else ("custom" if self.api_key else "none"),
            "max_tokens": self.max_tokens,
        }


runtime_llm_config = RuntimeLLMConfig.from_env()
