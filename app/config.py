from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    github_repo: str = os.getenv("GITHUB_REPO", "CBDT-JWT/EEnotes")
    github_branch: str = os.getenv("GITHUB_BRANCH", "main")
    doc_path: str = os.getenv("DOC_PATH", "docs")
    git_use_system_proxy: bool = _bool_env("GIT_USE_SYSTEM_PROXY", False)
    data_dir: Path = Path(os.getenv("DATA_DIR", "data"))
    site_base_url: str = os.getenv("SITE_BASE_URL", "").rstrip("/")

    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    deepseek_base_url: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    embedding_model: str = os.getenv("EMBEDDING_MODEL", "hash")
    top_k: int = int(os.getenv("TOP_K", "5"))
    chunk_size: int = int(os.getenv("CHUNK_SIZE", "1200"))
    chunk_overlap: int = int(os.getenv("CHUNK_OVERLAP", "180"))
    sync_interval_hours: float = float(os.getenv("SYNC_INTERVAL_HOURS", os.getenv("SYNC_INTERVAL", "12")))

    cors_origins: str = os.getenv("CORS_ORIGINS", "*")
    rate_limit_per_minute: int = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))
    admin_token: str = os.getenv("ADMIN_TOKEN", "")
    auto_sync_on_start: bool = _bool_env("AUTO_SYNC_ON_START", True)

    @property
    def repo_dir(self) -> Path:
        return self.data_dir / "repo"

    @property
    def index_dir(self) -> Path:
        return self.data_dir / "index"


settings = Settings()
