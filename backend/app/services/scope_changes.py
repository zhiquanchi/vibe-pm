from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.database import snapshot
from app.db.models import ScopeChange, Sprint, SprintSnapshot, Task
from app.services.common import to_dict


def _now() -> str:
    return datetime.utcnow().isoformat()


def _sprint(session: Session, sprint_id: int) -> Sprint:
    sprint = session.get(Sprint, sprint_id)
    if sprint is None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return sprint


def _capacity_warning(session: Session, sprint_id: int) -> str | None:
    sprint = _sprint(session, sprint_id)
    initial = float(sprint.initial_points or 0)
    total = float(session.scalar(select(func.coalesce(func.sum(Task.story_points), 0)).where(Task.sprint_id == sprint_id)))
    if initial > 0 and total > initial * 1.2:
        return f"范围已增加 {total - initial:g} pt，当前容量可能不足"
    return None


def apply_scope_change(session: Session, sprint_id: int, command) -> dict:
    """Apply one scope command atomically, including its log and today's snapshot."""
    sprint = _sprint(session, sprint_id)
    logger.info(
        "用户 {} 发起范围变更: sprint={} type={} task={}",
        command.created_by, sprint_id, command.type, command.task_id,
    )
    try:
        with session.begin_nested():
            now = _now()
            task_id = command.task_id
            if command.type == "add_task":
                points = command.story_points or 1
                position = session.scalar(select(func.coalesce(func.max(Task.position), -1) + 1).where(Task.sprint_id == sprint_id))
                task = Task(
                    project_id=sprint.project_id,
                    sprint_id=sprint_id,
                    title=command.title,
                    description=command.description,
                    status="todo",
                    story_points=points,
                    priority="P2",
                    position=position,
                    created_at=now,
                    updated_at=now,
                )
                session.add(task)
                session.flush()
                task_id = task.id
                delta = float(points)
                description = command.description or f"新增「{command.title}」"
            else:
                task = session.get(Task, task_id)
                if task is None:
                    raise HTTPException(status_code=404, detail="Task not found")
                if task.sprint_id != sprint_id:
                    raise HTTPException(status_code=409, detail="Task is not in this sprint")
                if command.type == "remove_task":
                    delta = -float(task.story_points)
                    description = command.description or f"移出「{task.title}」"
                    task.sprint_id = None
                    task.updated_at = now
                else:
                    old = float(task.story_points)
                    new = float(command.story_points) if command.story_points is not None else old + float(command.points_delta or 0)
                    if new < 1:
                        raise HTTPException(status_code=422, detail="Story points must be at least 1")
                    delta = new - old
                    description = command.description or f"修改「{task.title}」点数"
                    task.story_points = new
                    task.updated_at = now

            change = ScopeChange(
                sprint_id=sprint_id,
                task_id=task_id,
                type=command.type,
                description=description,
                points_delta=delta,
                reason=command.reason,
                created_by=command.created_by,
                created_at=now,
            )
            session.add(change)
            session.flush()
            snapshot(session, sprint_id, date.today(), change.id)
            snapshot_row = session.scalars(
                select(SprintSnapshot).where(SprintSnapshot.sprint_id == sprint_id, SprintSnapshot.snapshot_date == date.today().isoformat())
            ).first()
            result = {
                "task": to_dict(session.get(Task, task_id)) if task_id else None,
                "scope_change": to_dict(change),
                "snapshot": to_dict(snapshot_row),
                "capacity_warning": _capacity_warning(session, sprint_id),
            }
        session.commit()
        logger.info(
            "范围变更已提交: change_id={} sprint={} type={} task={} delta={}pt 容量预警={}",
            change.id, sprint_id, command.type, task_id, delta,
            result.get("capacity_warning"),
        )
        return result
    except Exception:
        session.rollback()
        logger.exception(
            "范围变更失败已回滚: sprint={} type={} task={}",
            sprint_id, command.type, command.task_id,
        )
        raise


def generate_snapshot(session: Session, sprint_id: int, snapshot_date: date | None = None) -> dict:
    _sprint(session, sprint_id)
    # Upsert is intentionally idempotent for the requested date.
    day = snapshot_date or date.today()
    logger.info("生成范围快照: sprint={} date={}", sprint_id, day.isoformat())
    try:
        snapshot(session, sprint_id, day)
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("生成范围快照失败: sprint={} date={}", sprint_id, day.isoformat())
        raise
    logger.info("范围快照已生成: sprint={} date={}", sprint_id, day.isoformat())
    return to_dict(
        session.scalars(select(SprintSnapshot).where(SprintSnapshot.sprint_id == sprint_id, SprintSnapshot.snapshot_date == day.isoformat())).first()
    )


def list_scope_changes(session: Session, sprint_id: int) -> list[dict]:
    _sprint(session, sprint_id)
    return [
        to_dict(change)
        for change in session.scalars(select(ScopeChange).where(ScopeChange.sprint_id == sprint_id).order_by(ScopeChange.created_at.desc(), ScopeChange.id.desc()))
    ]
