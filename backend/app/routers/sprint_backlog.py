from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import SprintSnapshot
from app.schemas.sprint_backlog import SprintCreateRequest, SprintDatesUpdate, SprintMoveTaskRequest, SprintStatusUpdate
from app.services import sprint_backlog
from app.services.common import to_dict


router = APIRouter(prefix="/api", tags=["sprint-backlog"])


@router.get("/sprints")
def get_sprints(project_id: int | None = Query(default=None, ge=1), session: Session = Depends(get_db)):
    return sprint_backlog.list_sprints(session, project_id)


@router.post("/sprints", status_code=201)
def post_sprint(payload: SprintCreateRequest, session: Session = Depends(get_db)):
    return sprint_backlog.create_sprint(session, payload)


@router.get("/sprints/{sprint_id}")
def get_sprint(sprint_id: int, session: Session = Depends(get_db)):
    return sprint_backlog.sprint_detail(session, sprint_id)


@router.get("/sprints/{sprint_id}/snapshots")
def get_sprint_snapshots(sprint_id: int, session: Session = Depends(get_db)):
    # Keep the chart data endpoint available when this router is mounted on its own.
    sprint_backlog.sprint_detail(session, sprint_id)
    rows = session.scalars(select(SprintSnapshot).where(SprintSnapshot.sprint_id == sprint_id).order_by(SprintSnapshot.snapshot_date))
    return [to_dict(row) for row in rows]


@router.patch("/sprints/{sprint_id}")
def patch_sprint(sprint_id: int, payload: SprintStatusUpdate, session: Session = Depends(get_db)):
    return sprint_backlog.update_status(session, sprint_id, payload.status)


@router.patch("/sprints/{sprint_id}/dates")
def patch_sprint_dates(sprint_id: int, payload: SprintDatesUpdate, session: Session = Depends(get_db)):
    sprint = sprint_backlog._sprint(session, sprint_id)
    if sprint.status != "planning":
        raise HTTPException(status_code=409, detail="只有规划中的 Sprint 可以修改日期")
    sprint.start_date = payload.start_date.isoformat()
    sprint.end_date = payload.end_date.isoformat()
    session.commit()
    return to_dict(sprint_backlog._sprint(session, sprint_id))


@router.get("/backlog")
def get_backlog(project_id: int = Query(default=1, ge=1), session: Session = Depends(get_db)):
    return sprint_backlog.list_backlog(session, project_id)


@router.post("/sprints/{sprint_id}/tasks/{task_id}")
def add_task_to_sprint(sprint_id: int, task_id: int, payload: SprintMoveTaskRequest | None = None, session: Session = Depends(get_db)):
    return sprint_backlog.move_task(session, sprint_id, task_id, True, payload.reason if payload else None)


@router.delete("/sprints/{sprint_id}/tasks/{task_id}")
def remove_task_from_sprint(sprint_id: int, task_id: int, session: Session = Depends(get_db)):
    return sprint_backlog.move_task(session, sprint_id, task_id, False)


# Explicit aliases make the move semantics discoverable to clients that prefer action routes.
@router.post("/sprints/{sprint_id}/backlog/{task_id}")
def backlog_add_alias(sprint_id: int, task_id: int, payload: SprintMoveTaskRequest | None = None, session: Session = Depends(get_db)):
    return add_task_to_sprint(sprint_id, task_id, payload, session)
