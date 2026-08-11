# Vibe PM Backend

FastAPI + SQLite API for Sprint, Task, Scope Change and Snapshot data.

## Structure

- `app/main.py`: application factory/lifespan and middleware
- `app/routers/api.py`: HTTP endpoints and status codes
- `app/schemas/`: Pydantic request validation
- `app/db/models.py`: SQLAlchemy ORM models for all tables
- `app/db/database.py`: engine/session factory, schema initialization, demo seed and snapshot upsert
- `app/core/config.py`: environment-driven database path and CORS configuration

Dependencies are managed with [uv](https://docs.astral.sh/uv/) via
`pyproject.toml` + `uv.lock`. The schema initializer is idempotent and creates
indexes on startup. Set `VIBE_PM_DB_PATH` to use another SQLite file (for
example a temporary file in tests), and `VIBE_PM_CORS_ORIGINS` to provide a
comma-separated origin list.

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8000

# tests (from backend/)
uv run pytest
```
