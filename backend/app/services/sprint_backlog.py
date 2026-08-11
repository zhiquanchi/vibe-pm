from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.database import snapshot
from app.db.models import Project, ScopeChange, Sprint, Task
from app.services.common import to_dict


ALLOWED_TRANSITIONS = {"planning": {"planning", "active"}, "active": {"active", "completed"}, "completed": {"completed"}}


def _sprint(session: Session, sprint_id: int) -> Sprint:
    sprint = session.get(Sprint, sprint_id)
    if sprint is None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return sprint


def _project_exists(session: Session, project_id: int) -> bool:
    return session.get(Project, project_id) is not None


def create_sprint(session: Session, payload) -> dict:
    if not _project_exists(session, payload.project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    now = datetime.utcnow().isoformat()
    sprint = Sprint(
        project_id=payload.project_id,
        name=payload.name,
        goal=payload.goal,
        start_date=payload.start_date.isoformat(),
        end_date=payload.end_date.isoformat(),
        status="planning",
        initial_points=0,
        created_at=now,
    )
    session.add(sprint)
    session.commit()
    return to_dict(_sprint(session, sprint.id))


def list_sprints(session: Session, project_id: int | None = None) -> list[dict]:
    stmt = select(Sprint).order_by(Sprint.start_date.desc(), Sprint.id.desc())
    if project_id is not None:
        stmt = stmt.where(Sprint.project_id == project_id)
    return [to_dict(sprint) for sprint in session.scalars(stmt)]


def sprint_detail(session: Session, sprint_id: int) -> dict:
    sprint = _sprint(session, sprint_id)
    tasks = session.scalars(select(Task).where(Task.sprint_id == sprint_id).order_by(Task.position, Task.id))
    return {"sprint": to_dict(sprint), "tasks": [to_dict(task) for task in tasks]}


def _stats(session: Session, sprint_id: int) -> dict:
    rows = session.execute(select(Task.status, Task.story_points).where(Task.sprint_id == sprint_id))
    total = completed = 0.0
    count = completed_count = 0
    for status, points in rows:
        points = float(points)
        total += points
        count += 1
        if status == "done":
            completed += points
            completed_count += 1
    return {"total_points": total, "completed_points": completed, "remaining_points": total - completed, "completion_rate": (completed / total if total else 0), "task_count": count, "completed_task_count": completed_count}


def update_status(session: Session, sprint_id: int, target: str) -> dict:
    sprint = _sprint(session, sprint_id)
    current = sprint.status
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        raise HTTPException(status_code=409, detail=f"Invalid sprint transition: {current} -> {target}")
    if target == current:
        return {"sprint": to_dict(sprint), "stats": _stats(session, sprint_id) if target == "completed" else None}

    if target == "active":
        active_id = session.scalars(
            select(Sprint.id).where(Sprint.project_id == sprint.project_id, Sprint.status == "active", Sprint.id != sprint_id).limit(1)
        ).first()
        if active_id is not None:
            raise HTTPException(status_code=409, detail="Project already has an active sprint")
        points = session.scalar(select(func.coalesce(func.sum(Task.story_points), 0)).where(Task.sprint_id == sprint_id))
        sprint.status = "active"
        sprint.initial_points = points
        snapshot(session, sprint_id)
        session.commit()
        return {"sprint": to_dict(_sprint(session, sprint_id)), "stats": None}

    # Completing a sprint is one transaction: calculate first, then return unfinished work to backlog.
    stats = _stats(session, sprint_id)
    now = datetime.utcnow().isoformat()
    for task in session.scalars(select(Task).where(Task.sprint_id == sprint_id, Task.status != "done")):
        task.sprint_id = None
        task.updated_at = now
    sprint.status = "completed"
    session.commit()
    return {"sprint": to_dict(_sprint(session, sprint_id)), "stats": stats}


def list_backlog(session: Session, project_id: int) -> list[dict]:
    if not _project_exists(session, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    tasks = session.scalars(select(Task).where(Task.project_id == project_id, Task.sprint_id.is_(None)).order_by(Task.position, Task.id))
    return [to_dict(task) for task in tasks]


def move_task(session: Session, sprint_id: int, task_id: int, into: bool, reason: str | None = None) -> dict:
    sprint = _sprint(session, sprint_id)
    if sprint.status == "completed":
        raise HTTPException(status_code=409, detail="已完成 Sprint 为只读状态")
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.project_id != sprint.project_id:
        raise HTTPException(status_code=422, detail="Task and sprint belong to different projects")
    now = datetime.utcnow().isoformat()
    if into:
        if task.sprint_id is not None:
            raise HTTPException(status_code=409, detail="Task is already in a sprint")
        task.sprint_id = sprint_id
        task.updated_at = now
        delta, kind = task.story_points, "add_task"
        description = f"Added task: {task.title}"
    else:
        if task.sprint_id != sprint_id:
            raise HTTPException(status_code=409, detail="Task is not in this sprint")
        task.sprint_id = None
        task.updated_at = now
        delta, kind = -task.story_points, "remove_task"
        description = f"Removed task: {task.title}"
    if sprint.status == "active":
        session.add(
            ScopeChange(
                sprint_id=sprint_id,
                task_id=task_id,
                type=kind,
                description=description,
                points_delta=delta,
                reason=reason,
                created_by="current-user",
                created_at=now,
            )
        )
        snapshot(session, sprint_id)
    session.commit()
    return to_dict(session.get(Task, task_id))
