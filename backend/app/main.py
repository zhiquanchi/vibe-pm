from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import cors_origins
from app.core.logging_config import setup_logging
from app.routers.copilot import router as copilot_router

# Configure loguru (single writer to /var/log/vibe-pm/source/backend.log as flat
# JSON, plus a stderr sink). Uvicorn's stdlib logs are bridged into loguru via
# `logging_config.json` (--log-config), so framework logs also flow through
# loguru and the file is written exactly once.
setup_logging()
from app.db.database import init_db
from app.routers.api import router
from app.routers.projects import router as projects_router
from app.routers.sprint_backlog import router as sprint_backlog_router
from app.routers.stages import router as stages_router
from app.routers.tasks import router as tasks_router
from app.routers.scope_changes import router as scope_changes_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Vibe PM API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Domain routers are registered before the legacy compatibility router so the
# persisted Sprint/task workflows are the canonical handlers.
app.include_router(projects_router)
app.include_router(copilot_router)
app.include_router(stages_router)
app.include_router(sprint_backlog_router)
app.include_router(tasks_router)
app.include_router(scope_changes_router)
app.include_router(router)

# Make direct imports and CLI scripts usable even without a lifespan-aware client.
init_db()

# Backwards-compatible import for scripts that previously called init_db from app.main.
__all__ = ["app", "init_db"]
