from datetime import date

from fastapi import APIRouter, Depends

from app.db.database import get_connection
from app.schemas.scope_changes import ScopeChangeCommand
from app.services import scope_changes

router = APIRouter(prefix="/api", tags=["scope-changes"])


def db_connection():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


@router.post("/sprints/{sprint_id}/scope-changes", status_code=201)
def post_scope_change(sprint_id: int, payload: ScopeChangeCommand, conn=Depends(db_connection)):
    return scope_changes.apply_scope_change(conn, sprint_id, payload)


@router.get("/sprints/{sprint_id}/scope-changes")
def get_scope_changes(sprint_id: int, conn=Depends(db_connection)):
    return scope_changes.list_scope_changes(conn, sprint_id)


@router.post("/sprints/{sprint_id}/snapshots/generate")
def post_snapshot(sprint_id: int, snapshot_date: date | None = None, conn=Depends(db_connection)):
    return scope_changes.generate_snapshot(conn, sprint_id, snapshot_date)

