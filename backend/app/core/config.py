from __future__ import annotations

import os
from pathlib import Path


def database_path() -> Path:
    """Return the configured SQLite path, creating its parent lazily."""
    configured = os.getenv("VIBE_PM_DB_PATH")
    return Path(configured).expanduser() if configured else Path(__file__).resolve().parents[2] / "vibe_pm.db"


def cors_origins() -> list[str]:
    value = os.getenv("VIBE_PM_CORS_ORIGINS", "http://localhost:5173")
    return [origin.strip() for origin in value.split(",") if origin.strip()]
