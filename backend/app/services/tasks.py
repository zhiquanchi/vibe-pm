from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from loguru import logger

from app.db.models import Project, ProjectActivity, ProjectMember, Stage, Task
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
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"用户 {user_id} 在阶段 {_stage_label(stage)} 创建任务「{task.title}」失败")
        raise
    logger.info(f"用户 {user_id} 在阶段 {_stage_label(stage)} 创建任务「{task.title}」(task_id={task.id}) 成功")
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
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"用户 {user_id} 更新任务「{task.title}」(task_id={task.id}) 失败")
        raise
    if new_status is not None and new_status != old_status:
        logger.info(
            f"用户 {user_id} 将任务「{task.title}」(task_id={task.id}) 状态 "
            f"{STATUS_LABELS.get(old_status, old_status)} → {STATUS_LABELS.get(new_status, new_status)} 成功"
        )
    if changed_fields:
        logger.info(f"用户 {user_id} 更新任务「{task.title}」(task_id={task.id}) 字段 {', '.join(changed_fields)} 成功")
    return to_dict(session.get(Task, task.id))


def _stage_label(stage: Stage | None) -> str:
    return stage.name if stage is not None else "未规划"


def move_task(session: Session, project_id: int, task_id: int, payload, user_id: str) -> dict:
    _require_writer(session, project_id, user_id)
    task = _task_or_404(session, task_id)
    if task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status == "done":
        raise HTTPException(status_code=409, detail="已完成任务不可移动")

    source_stage = _stage_or_404(session, project_id, task.stage_id)
    target_stage = _stage_or_404(session, project_id, payload.target_stage_id)
    # The source stage must be writable (completed stages are read-only).
    _require_stage_writable(session, source_stage)
    # The target stage must be unfinished.
    if target_stage is not None and target_stage.status == "completed":
        raise HTTPException(status_code=409, detail="目标阶段已完成，无法移入")
    # Moving a task out of a started (active) stage requires a reason.
    if source_stage is not None and source_stage.status == "active" and target_stage != source_stage:
        if not payload.reason or not payload.reason.strip():
            raise HTTPException(status_code=422, detail="移出已启动阶段需填写原因")

    task.stage_id = payload.target_stage_id
    task.updated_at = _now()
    if target_stage != source_stage:
        _activity(
            session,
            project_id,
            "task_moved",
            f"任务「{task.title}」移动：{_stage_label(source_stage)} → {_stage_label(target_stage)}",
            user_id,
        )
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(
            f"用户 {user_id} 移动任务「{task.title}」(task_id={task.id}) "
            f"从 {_stage_label(source_stage)} 到 {_stage_label(target_stage)} 失败"
        )
        raise
    logger.info(
        f"用户 {user_id} 移动任务「{task.title}」(task_id={task.id})："
        f"{_stage_label(source_stage)} → {_stage_label(target_stage)} 成功"
    )
    return to_dict(session.get(Task, task.id))


def _guard_delete(session: Session, project_id: int, task: Task) -> None:
    """Block deletion of tasks that are depended on or required for acceptance.

    The ``task_dependencies`` (PRD-04) and ``stage_deliverables`` with
    ``is_required`` (PRD-05) tables that back these checks do not exist yet, so
    the guard is a documented forward-integration point. It will be filled in by
    those changes once the schemas are added.
    """


def delete_task(session: Session, project_id: int, task_id: int, user_id: str) -> dict:
    _require_writer(session, project_id, user_id)
    task = _task_or_404(session, task_id)
    if task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task not found")
    stage = _stage_or_404(session, project_id, task.stage_id)
    _require_stage_writable(session, stage)
    _guard_delete(session, project_id, task)

    title = task.title
    task_id = task.id
    session.delete(task)
    _activity(session, project_id, "task_deleted", f"删除任务「{title}」", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"用户 {user_id} 删除任务「{title}」(task_id={task_id}) 失败")
        raise
    logger.info(f"用户 {user_id} 删除任务「{title}」(task_id={task_id}) 成功")
    return {"deleted": True}


# Priority rank used for sorting (urgent first). Unknown values sort last.
PRIORITY_ORDER = {"urgent": 0, "important": 1, "normal": 2, "low": 3}


def list_stage_tasks(session: Session, project_id: int, stage_id: int, filters) -> list[dict]:
    """Stage workbench: list tasks with filtering and sorting (PRD-03 5.1)."""
    stmt = select(Task).where(Task.project_id == project_id, Task.stage_id == stage_id)
    if filters.status:
        stmt = stmt.where(Task.status == filters.status)
    if filters.priority:
        stmt = stmt.where(Task.priority == filters.priority)
    if filters.assignee:
        stmt = stmt.where(Task.assignee == filters.assignee)
    if filters.search:
        stmt = stmt.where(Task.title.like(f"%{filters.search}%"))

    sort = filters.sort or "created_at"
    desc = sort.startswith("-")
    field = sort[1:] if desc else sort
    if field == "priority":
        tasks = session.scalars(stmt).all()
        tasks.sort(key=lambda t: PRIORITY_ORDER.get(t.priority, 99), reverse=desc)
    else:
        column = Task.planned_date if field == "planned_date" else Task.created_at
        stmt = stmt.order_by(column.desc() if desc else column)
        tasks = session.scalars(stmt).all()
    return [to_dict(task) for task in tasks]


def list_my_tasks(
    session: Session,
    user_id: str,
    *,
    project_id: int | None = None,
    stage_id: int | None = None,
    status: str | None = None,
    priority: str | None = None,
    sort: str = "planned_date",
) -> list[dict]:
    """Cross-project unfinished tasks assigned to the user (PRD-03 5.2)."""
    member_ids = select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
    stmt = (
        select(Task, Project.name, Stage.name)
        .join(Project, Project.id == Task.project_id)
        .outerjoin(Stage, Stage.id == Task.stage_id)
        .where(Task.assignee == user_id)
        .where(Task.project_id.in_(member_ids))
        .where(Task.status != "done")
    )
    if project_id is not None:
        stmt = stmt.where(Task.project_id == project_id)
    if stage_id is not None:
        stmt = stmt.where(Task.stage_id == stage_id)
    if status is not None:
        stmt = stmt.where(Task.status == status)
    if priority is not None:
        stmt = stmt.where(Task.priority == priority)

    rows = session.execute(stmt).all()
    today = date.today().isoformat()
    result: list[dict] = []
    for task, project_name, stage_name in rows:
        item = to_dict(task)
        item["project_name"] = project_name
        item["stage_name"] = stage_name
        item["overdue"] = bool(task.planned_date and task.planned_date < today and task.status != "done")
        item["blocked"] = task.status == "blocked"
        result.append(item)

    desc = sort.startswith("-")
    field = sort[1:] if desc else sort
    if field == "priority":
        result.sort(key=lambda d: PRIORITY_ORDER.get(d.get("priority"), 99), reverse=desc)
    elif field == "created_at":
        result.sort(key=lambda d: d.get("created_at") or "", reverse=desc)
    else:  # planned_date
        result.sort(key=lambda d: d.get("planned_date") or "9999-12-31", reverse=desc)
    return result
