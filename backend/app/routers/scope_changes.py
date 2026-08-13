from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.scope_changes import ScopeChangeCommand
from app.services import scope_changes
from loguru import logger

router = APIRouter(prefix="/api", tags=["scope-changes"])


@router.post("/sprints/{sprint_id}/scope-changes", status_code=201)
def post_scope_change(sprint_id: int, payload: ScopeChangeCommand, session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/sprints/{sprint_id}/scope-changes] type={payload.type!r}")
    return scope_changes.apply_scope_change(session, sprint_id, payload)


@router.get("/sprints/{sprint_id}/scope-changes")
def get_scope_changes(sprint_id: int, session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/sprints/{sprint_id}/scope-changes] listing")
    return scope_changes.list_scope_changes(session, sprint_id)


@router.post("/sprints/{sprint_id}/snapshots/generate")
def post_snapshot(sprint_id: int, snapshot_date: date | None = None, session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/sprints/{sprint_id}/snapshots/generate] snapshot_date={snapshot_date}")
    return scope_changes.generate_snapshot(session, sprint_id, snapshot_date)
