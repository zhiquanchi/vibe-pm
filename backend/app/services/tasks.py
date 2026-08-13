from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import ProjectActivity, ProjectMember, Stage, Task
from app.services.common import to_dict


# Task status transition table (总纲定义的状态转换表).
TASK_TRANSITIONS = {
    "todo": ["in_progress"],
    "in_progress": ["done", "blocked"],
    "blocked": ["pending_verification"],
    "pending_verification": ["done"],
    "done": [],
}

# Human-readable labels for status values, used in error messages and activities.
STATUS_LABELS = {
    "todo": "未开始",
    "in_progress": "进行中",
    "blocked": "受阻",
    "pending_verification": "待验收",
    "done": "已完成",
}


def _now() -> str:
    return datetime.utcnow().isoformat()


def _activity(session: Session, project_id: int, type: str, description: str, created_by: str) -> None:
    session.add(ProjectActivity(project_id=project_id, type=type, description=description, created_by=created_by, created_at=_now()))


def _task_or_404(session: Session, task_id: int) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _stage_or_404(session: Session, project_id: int, stage_id: int | None):
    if stage_id is None:
        return None
    stage = session.get(Stage, stage_id)
    if stage is None or stage.project_id != project_id:
        raise HTTPException(status_code=404, detail="Stage not found")
    return stage


def _require_writer(session: Session, project_id: int, user_id: str) -> None:
    """Observers may not mutate tasks; only owners and members may write."""
    member = session.get(ProjectMember, (project_id, user_id))
    if member is None or member.role == "observer":
        raise HTTPException(status_code=403, detail="观察者无权修改任务")


def _require_stage_writable(session: Session, stage: Stage | None) -> None:
    if stage is not None and stage.status == "completed":
        raise HTTPException(status_code=409, detail="已完成阶段为只读状态")


def _next_position(session: Session, stage_id: int | None) -> int:
    value = session.scalar(select(func.coalesce(func.max(Task.position), -1) + 1).where(Task.stage_id == stage_id))
    return int(value)


def _validate_transition(old: str, new: str) -> None:
    """Reject illegal status transitions per the 总纲 transition table.

    Legacy statuses (e.g. ``in_review`` from the Sprint MVP) are not part of the
    table, so transitions involving them are permitted leniently to avoid
    breaking existing data.
    """
    if old not in TASK_TRANSITIONS:
        return
    allowed = TASK_TRANSITIONS[old]
    if new not in allowed:
        labels = "、".join(STATUS_LABELS.get(s, s) for s in allowed) or "无"
        raise HTTPException(status_code=422, detail=f"任务状态转换不合法，{STATUS_LABELS.get(old, old)}只能转为{labels}")


def create_stage_task(session: Session, project_id: int, stage_id: int | None, payload, user_id: str) -> dict:
    _require_writer(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    _require_stage_writable(session, stage)

    now = _now()
    completed_at = now if payload.status == "done" else None
    task = Task(
        project_id=project_id,
        stage_id=stage_id,
        title=payload.title.strip(),
        description=payload.description,
        status=payload.status,
        priority=payload.priority,
        assignee=payload.assignee,
        planned_date=payload.planned_date.isoformat() if payload.planned_date else None,
        position=_next_position(session, stage_id),
        created_at=now,
        updated_at=now,
        completed_at=completed_at,
    )
    session.add(task)
    session.flush()
    _activity(session, project_id, "task_created", f"创建任务「{task.title}」", user_id)
    session.commit()
    return to_dict(session.get(Task, task.id))


def update_stage_task(session: Session, project_id: int, task_id: int, payload, user_id: str) -> dict:
    _require_writer(session, project_id, user_id)
    task = _task_or_404(session, task_id)
    if task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task not found")
    stage = _stage_or_404(session, project_id, task.stage_id)
    _require_stage_writable(session, stage)

    data = payload.model_dump(exclude_unset=True)
    data.pop("reason", None)
    old_status = task.status
    new_status = data.get("status")

    if new_status is not None and new_status != old_status:
        _validate_transition(old_status, new_status)

    now = _now()
    changed_fields: list[str] = []
    for key in ("title", "description", "priority", "assignee", "position"):
        if key in data and data[key] is not None:
            setattr(task, key, data[key])
            changed_fields.append(key)
    if "planned_date" in data:
        task.planned_date = data["planned_date"].isoformat() if data["planned_date"] else None
        changed_fields.append("planned_date")
    if new_status is not None and new_status != old_status:
        task.status = new_status
        task.completed_at = now if new_status == "done" else None
    task.updated_at = now

    if new_status is not None and new_status != old_status:
        _activity(
            session,
            project_id,
            "task_status_changed",
            f"任务「{task.title}」状态 {STATUS_LABELS.get(old_status, old_status)} → {STATUS_LABELS.get(new_status, new_status)}",
            user_id,
        )
    if changed_fields:
        _activity(session, project_id, "task_updated", f"更新任务「{task.title}」", user_id)
    session.commit()
    return to_dict(session.get(Task, task.id))
