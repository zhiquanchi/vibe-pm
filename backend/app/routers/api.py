from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.identity import current_user_id
from app.db.database import get_db, snapshot
from app.db.models import ScopeChange, Sprint, SprintSnapshot, Task
from app.schemas import ScopeChangeCreate, SprintCreate, TaskCreate, TaskUpdate
from app.services.common import to_dict
from loguru import logger

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    logger.info("[endpoint GET /api/health] health check")
    return {"status": "ok"}


@router.get("/sprints")
def sprints(session: Session = Depends(get_db)):
    logger.info("[endpoint GET /api/sprints] listing sprints")
    return [to_dict(sprint) for sprint in session.scalars(select(Sprint).order_by(Sprint.start_date.desc()))]


@router.post("/sprints")
def create_sprint(payload: SprintCreate, session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/sprints] name={payload.name!r}")
    now = datetime.utcnow().isoformat()
    sprint = Sprint(
        project_id=1,
        name=payload.name,
        goal=payload.goal,
        start_date=payload.start_date.isoformat(),
        end_date=payload.end_date.isoformat(),
        created_at=now,
    )
    session.add(sprint)
    session.commit()
    return to_dict(session.get(Sprint, sprint.id))


@router.get("/sprints/{sprint_id}")
def sprint(sprint_id: int, session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/sprints/{sprint_id}] fetching sprint")
    sprint_row = session.get(Sprint, sprint_id)
    if sprint_row is None:
        logger.warning(f"[endpoint GET /api/sprints/{sprint_id}] 404 sprint not found")
        raise HTTPException(404, "Sprint not found")
    tasks = session.scalars(select(Task).where(Task.sprint_id == sprint_id).order_by(Task.position, Task.id))
    changes = session.scalars(select(ScopeChange).where(ScopeChange.sprint_id == sprint_id).order_by(ScopeChange.created_at.desc()))
    return {"sprint": to_dict(sprint_row), "tasks": [to_dict(row) for row in tasks], "scope_changes": [to_dict(row) for row in changes]}


@router.get("/tasks")
def tasks(sprint_id: int | None = None, session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/tasks] sprint_id={sprint_id}")
    stmt = select(Task).order_by(Task.position, Task.id)
    if sprint_id is not None:
        stmt = stmt.where(Task.sprint_id == sprint_id)
    return [to_dict(task) for task in session.scalars(stmt)]


@router.post("/tasks")
def create_task(payload: TaskCreate, session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/tasks] project_id={payload.project_id} sprint_id={payload.sprint_id} title={payload.title!r}")
    now = datetime.utcnow().isoformat()
    task = Task(
        project_id=payload.project_id,
        sprint_id=payload.sprint_id,
        title=payload.title,
        description=payload.description,
        status=payload.status,
        story_points=payload.story_points,
        priority=payload.priority,
        assignee=payload.assignee,
        created_at=now,
        updated_at=now,
    )
    session.add(task)
    session.flush()
    if payload.sprint_id:
        snapshot(session, payload.sprint_id)
    session.commit()
    return to_dict(session.get(Task, task.id))


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, payload: TaskUpdate, user_id: str = Depends(current_user_id), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/tasks/{task_id}] user_id={user_id}")
    task = session.get(Task, task_id)
    if task is None:
        logger.warning(f"[endpoint PATCH /api/tasks/{task_id}] 404 task not found")
        raise HTTPException(404, "Task not found")
    old_title = task.title
    old_points = task.story_points
    old_sprint = task.sprint_id
    data = payload.model_dump(exclude_none=True)
    if data:
        for key, value in data.items():
            setattr(task, key, value)
        task.updated_at = datetime.utcnow().isoformat()
    if "story_points" in data and data["story_points"] != old_points and old_sprint:
        session.add(
            ScopeChange(
                sprint_id=old_sprint,
                task_id=task_id,
                type="change_points",
                description=f"Changed points for {old_title}",
                points_delta=data["story_points"] - old_points,
                created_by=user_id,
                created_at=datetime.utcnow().isoformat(),
            )
        )
    if old_sprint:
        snapshot(session, old_sprint)
    session.commit()
    return to_dict(session.get(Task, task_id))


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, session: Session = Depends(get_db)):
    logger.info(f"[endpoint DELETE /api/tasks/{task_id}]")
    task = session.get(Task, task_id)
    if task is None:
        logger.warning(f"[endpoint DELETE /api/tasks/{task_id}] 404 task not found")
        raise HTTPException(404, "Task not found")
    session.delete(task)
    session.commit()
    return {"deleted": True}


@router.get("/sprints/{sprint_id}/scope-changes")
def scope_changes(sprint_id: int, session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/sprints/{sprint_id}/scope-changes] listing")
    rows = session.scalars(select(ScopeChange).where(ScopeChange.sprint_id == sprint_id).order_by(ScopeChange.created_at.desc()))
    return [to_dict(row) for row in rows]


@router.post("/sprints/{sprint_id}/scope-changes")
def create_scope_change(sprint_id: int, payload: ScopeChangeCreate, user_id: str = Depends(current_user_id), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/sprints/{sprint_id}/scope-changes] user_id={user_id} type={payload.type!r}")
    if session.get(Sprint, sprint_id) is None:
        logger.warning(f"[endpoint POST /api/sprints/{sprint_id}/scope-changes] 404 sprint not found")
        raise HTTPException(404, "Sprint not found")
    now = datetime.utcnow().isoformat()
    change = ScopeChange(
        sprint_id=sprint_id,
        task_id=payload.task_id,
        type=payload.type,
        description=payload.description,
        points_delta=payload.points_delta,
        reason=payload.reason,
        created_by=user_id,
        created_at=now,
    )
    session.add(change)
    session.flush()
    snapshot(session, sprint_id)
    session.commit()
    return to_dict(session.get(ScopeChange, change.id))


@router.get("/sprints/{sprint_id}/snapshots")
def snapshots(sprint_id: int, session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/sprints/{sprint_id}/snapshots] listing")
    rows = session.scalars(select(SprintSnapshot).where(SprintSnapshot.sprint_id == sprint_id).order_by(SprintSnapshot.snapshot_date))
    return [to_dict(row) for row in rows]
