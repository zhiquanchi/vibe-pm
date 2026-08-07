from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.db.database import get_connection
from app.schemas.sprint_backlog import SprintCreateRequest, SprintMoveTaskRequest, SprintStatusUpdate
from app.services import sprint_backlog


router = APIRouter(prefix="/api", tags=["sprint-backlog"])


def db_connection():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


@router.get("/sprints")
def get_sprints(project_id: int | None = Query(default=None, ge=1), conn=Depends(db_connection)):
    return sprint_backlog.list_sprints(conn, project_id)


@router.post("/sprints", status_code=201)
def post_sprint(payload: SprintCreateRequest, conn=Depends(db_connection)):
    return sprint_backlog.create_sprint(conn, payload)


@router.get("/sprints/{sprint_id}")
def get_sprint(sprint_id: int, conn=Depends(db_connection)):
    return sprint_backlog.sprint_detail(conn, sprint_id)


@router.get("/sprints/{sprint_id}/snapshots")
def get_sprint_snapshots(sprint_id: int, conn=Depends(db_connection)):
    # Keep the chart data endpoint available when this router is mounted on its own.
    sprint_backlog.sprint_detail(conn, sprint_id)
    rows = conn.execute("SELECT * FROM sprint_snapshots WHERE sprint_id=? ORDER BY snapshot_date", (sprint_id,))
    return [dict(row) for row in rows]


@router.patch("/sprints/{sprint_id}")
def patch_sprint(sprint_id: int, payload: SprintStatusUpdate, conn=Depends(db_connection)):
    return sprint_backlog.update_status(conn, sprint_id, payload.status)


@router.get("/backlog")
def get_backlog(project_id: int = Query(default=1, ge=1), conn=Depends(db_connection)):
    return sprint_backlog.list_backlog(conn, project_id)


@router.post("/sprints/{sprint_id}/tasks/{task_id}")
def add_task_to_sprint(sprint_id: int, task_id: int, payload: SprintMoveTaskRequest | None = None, conn=Depends(db_connection)):
    return sprint_backlog.move_task(conn, sprint_id, task_id, True, payload.reason if payload else None)


@router.delete("/sprints/{sprint_id}/tasks/{task_id}")
def remove_task_from_sprint(sprint_id: int, task_id: int, conn=Depends(db_connection)):
    return sprint_backlog.move_task(conn, sprint_id, task_id, False)


# Explicit aliases make the move semantics discoverable to clients that prefer action routes.
@router.post("/sprints/{sprint_id}/backlog/{task_id}")
def backlog_add_alias(sprint_id: int, task_id: int, payload: SprintMoveTaskRequest | None = None, conn=Depends(db_connection)):
    return add_task_to_sprint(sprint_id, task_id, payload, conn)
