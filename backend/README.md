# Vibe PM Backend

FastAPI + SQLite API for Sprint, Task, Scope Change and Snapshot data.

## Structure

- `app/main.py`: application factory/lifespan and middleware
- `app/routers/api.py`: HTTP endpoints and status codes
- `app/routers/projects.py` + `app/services/projects.py`: project member management, role adjustment, removal checks and activity records
- `app/routers/stages.py` + `app/services/stages.py`: project stage template, structure management, stage owner assignment, primary-stage rules and activity records
- `app/routers/tasks.py` + `app/services/tasks.py`: stage-based task management (create/edit/advance inside a stage, move between unfinished stages, delete, status-transition validation, cross-project "my tasks" list) and activity records
- `app/schemas/`: Pydantic request validation
- `app/db/models.py`: SQLAlchemy ORM models for all tables
- `app/db/database.py`: engine/session factory, schema initialization, demo seed and snapshot upsert
- `app/core/config.py`: environment-driven database path and CORS configuration

Dependencies are managed with [uv](https://docs.astral.sh/uv/) via
`pyproject.toml` + `uv.lock`. The schema initializer is idempotent and creates
indexes on startup. Set `VIBE_PM_DB_PATH` to use another SQLite file (for
example a temporary file in tests), and `VIBE_PM_CORS_ORIGINS` to provide a
comma-separated origin list.

### Logging

Application logs use [`loguru`](https://github.com/Delgan/loguru) and are
emitted as JSON lines (one object per line) to
`/var/log/vibe-pm/source/backend.log`, where the local Vector agent tails them
and ships the collected stream to `/var/log/vibe-pm/backend.log`. The line
format mirrors the other services on this host (`bff/`, `archive-service/`):

```json
{"time": "2026-08-13T12:00:00.123456+00:00", "level": "INFO", "correlation_id": "", "message": "...", "module": "uvicorn.server", "function": "_serve", "line": 83, "thread_id": 140123}
```

`source/backend.log` has a single writer (loguru). Uvicorn's own access/error
logs are bridged into loguru via `logging_config.json` (passed with
`--log-config`), so framework logs are also emitted through loguru — once, into
both the file (JSON) and stderr (human-readable). Business modules must not
create their own `logging.getLogger(...)`; use `from loguru import logger`
instead.

```bash
uv sync
uv run uvicorn app.main:app --log-config logging_config.json --reload --port 8000

# Override the log directory (defaults to /var/log/vibe-pm):
VIBE_PM_LOG_DIR=/path/to/logs uv run uvicorn app.main:app --log-config logging_config.json
```

Importing `app.main` also configures logging (so a file log is produced even
without `--log-config`); the `--log-config` flag additionally routes uvicorn's
framework logs through loguru.

```bash
# tests (from backend/)
uv run pytest
```
