from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.database import snapshot
from app.db.models import ScopeChange, Sprint, Task
from app.services.common import to_dict


def _now() -> str:
    return datetime.utcnow().isoformat()


def _active_sprint(session: Session, sprint_id: int | None) -> bool:
    return bool(sprint_id and session.scalars(select(Sprint.id).where(Sprint.id == sprint_id, Sprint.status == "active")).first())


def _require_sprint(session: Session, sprint_id: int | None) -> None:
    if sprint_id is not None and session.get(Sprint, sprint_id) is None:
        raise HTTPException(status_code=404, detail="Sprint not found")


def _require_writable_sprint(session: Session, sprint_id: int | None) -> None:
    if sprint_id is not None and session.scalars(select(Sprint.id).where(Sprint.id == sprint_id, Sprint.status != "completed")).first() is None:
        raise HTTPException(status_code=409, detail="已完成 Sprint 为只读状态")


def _next_position(session: Session, sprint_id: int | None) -> int:
    # ``Task.sprint_id == None`` renders as ``IS NULL``, covering backlog tasks.
    value = session.scalar(select(func.coalesce(func.max(Task.position), -1) + 1).where(Task.sprint_id == sprint_id))
    return int(value)


def _scope_change(
    session: Session,
    *,
    sprint_id: int,
    task_id: int | None,
    change_type: str,
    description: str,
    points_delta: float,
    reason: str | None,
    created_by: str,
) -> None:
    session.add(
        ScopeChange(
            sprint_id=sprint_id,
            task_id=task_id,
            type=change_type,
            description=description,
            points_delta=points_delta,
            reason=reason,
            created_by=created_by,
            created_at=_now(),
        )
    )


def list_tasks(session: Session, sprint_id: int | None = None) -> list[dict[str, Any]]:
    stmt = select(Task).order_by(Task.position, Task.id)
    if sprint_id is not None:
        stmt = stmt.where(Task.sprint_id == sprint_id)
    return [to_dict(task) for task in session.scalars(stmt)]


def create_task(session: Session, data: dict[str, Any]) -> dict[str, Any]:
    sprint_id = data["sprint_id"]
    _require_sprint(session, sprint_id)
    _require_writable_sprint(session, sprint_id)
    position = data["position"] if data["position"] is not None else _next_position(session, sprint_id)
    now = _now()
    completed_at = now if data["status"] == "done" else None
    task = Task(
        project_id=data["project_id"],
        sprint_id=sprint_id,
        title=data["title"],
        description=data["description"],
        status=data["status"],
        story_points=data["story_points"],
        priority=data["priority"],
        assignee=data["assignee"],
        position=position,
        created_at=now,
        updated_at=now,
        completed_at=completed_at,
    )
    session.add(task)
    session.flush()
    if _active_sprint(session, sprint_id):
        _scope_change(session, sprint_id=sprint_id, task_id=task.id, change_type="add_task", description=f"Added {data['title']}", points_delta=data["story_points"], reason=data["reason"], created_by=data["created_by"])
        snapshot(session, sprint_id)
    session.commit()
    return to_dict(session.get(Task, task.id))


def update_task(session: Session, task_id: int, data: dict[str, Any]) -> dict[str, Any]:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    reason = data.pop("reason", None)
    created_by = data.pop("created_by", "current-user")
    # ``sprint_id=None`` explicitly moves a task back to the backlog; preserve it.
    data = {key: value for key, value in data.items() if value is not None or key == "sprint_id"}
    old_sprint = task.sprint_id
    old_title = task.title
    old_points = float(task.story_points)
    new_sprint = data.get("sprint_id", old_sprint)
    _require_sprint(session, new_sprint)
    _require_writable_sprint(session, old_sprint)
    _require_writable_sprint(session, new_sprint)
    now = _now()
    if "status" in data:
        data["completed_at"] = now if data["status"] == "done" else None
    if data:
        for key, value in data.items():
            setattr(task, key, value)
        task.updated_at = now

    new_points = float(data.get("story_points", old_points))
    old_active = _active_sprint(session, old_sprint)
    new_active = _active_sprint(session, new_sprint)
    if old_active and new_sprint != old_sprint:
        _scope_change(session, sprint_id=old_sprint, task_id=task_id, change_type="remove_task", description=f"Removed {old_title}", points_delta=-old_points, reason=reason, created_by=created_by)
        snapshot(session, old_sprint)
    if new_active and new_sprint != old_sprint:
        _scope_change(session, sprint_id=new_sprint, task_id=task_id, change_type="add_task", description=f"Added {old_title}", points_delta=new_points, reason=reason, created_by=created_by)
        snapshot(session, new_sprint)
    elif old_active and "story_points" in data and new_points != old_points:
        _scope_change(session, sprint_id=old_sprint, task_id=task_id, change_type="change_points", description=f"Changed points for {old_title}", points_delta=new_points - old_points, reason=reason, created_by=created_by)
        snapshot(session, old_sprint)
    session.commit()
    return to_dict(session.get(Task, task_id))


def delete_task(session: Session, task_id: int, reason: str | None = None, created_by: str = "current-user") -> None:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    _require_writable_sprint(session, task.sprint_id)
    if _active_sprint(session, task.sprint_id):
        _scope_change(session, sprint_id=task.sprint_id, task_id=task_id, change_type="remove_task", description=f"Deleted {task.title}", points_delta=-float(task.story_points), reason=reason, created_by=created_by)
        snapshot(session, task.sprint_id)
    session.delete(task)
    session.commit()
