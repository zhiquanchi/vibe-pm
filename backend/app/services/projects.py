from __future__ import annotations

import re
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from loguru import logger

from app.db.models import Profile, Project, ProjectActivity, ProjectMember, Stage, StageBlocker, Task, TaskBlocker
from app.services.common import to_dict


def _now() -> str:
    return datetime.utcnow().isoformat()


def _activity(session: Session, project_id: int, type: str, description: str, created_by: str) -> None:
    session.add(ProjectActivity(project_id=project_id, type=type, description=description, created_by=created_by, created_at=_now()))


def _count_owners(session: Session, project_id: int) -> int:
    """Count current project owners."""
    return session.scalar(select(func.count()).select_from(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.role == "owner")) or 0


def _days_since(value: str | None) -> int:
    """Return whole days since a stored ISO date/datetime, never below zero."""
    if not value:
        return 0
    try:
        target = date.fromisoformat(value[:10])
    except ValueError:
        return 0
    return max((date.today() - target).days, 0)


def _member_names(session: Session, project_id: int) -> dict[str, str]:
    rows = session.execute(
        select(Profile.id, Profile.name)
        .join(ProjectMember, ProjectMember.user_id == Profile.id)
        .where(ProjectMember.project_id == project_id)
    ).all()
    return {user_id: name for user_id, name in rows}


def _overall_status(stages: list[Stage]) -> str:
    primary = next((stage for stage in stages if stage.is_primary), None)
    if primary is not None:
        return primary.status
    if stages and all(stage.status == "completed" for stage in stages):
        return "completed"
    if not stages or all(stage.status == "planned" for stage in stages):
        return "planned"
    # Fallback for data without a primary marker. Blockers take precedence over
    # acceptance and normal execution, matching the health semantics of the page.
    statuses = {stage.status for stage in stages}
    if "blocked" in statuses:
        return "blocked"
    if "pending_acceptance" in statuses:
        return "pending_acceptance"
    return "active"


def _risk(
    kind: str,
    severity: str,
    title: str,
    detail: str | None,
    owner_name: str | None,
    duration_days: int,
    overdue_days: int | None,
    stage_id: int | None,
    task_id: int | None,
    blocker_id: int | None,
) -> dict:
    return {
        "kind": kind,
        "severity": severity,
        "title": title,
        "detail": detail,
        "owner_name": owner_name,
        "duration_days": duration_days,
        "overdue_days": overdue_days,
        "stage_id": stage_id,
        "task_id": task_id,
        "blocker_id": blocker_id,
    }


def _quoted_values(description: str) -> list[str]:
    return re.findall(r"「([^」]+)」", description)


def _activity_target(
    activity: ProjectActivity,
    stages_by_id: dict[int, Stage],
    stages_by_name: dict[str, Stage],
    tasks_by_id: dict[int, Task],
    tasks_by_title: dict[str, Task],
) -> tuple[int | None, str | None, int | None, bool]:
    """Resolve the current business object referenced by an activity summary."""
    values = _quoted_values(activity.description)
    stage = next((stages_by_name[value] for value in values if value in stages_by_name), None)
    task = next((tasks_by_title[value] for value in values if value in tasks_by_title), None)

    is_task_event = activity.type.startswith("task_") or activity.type == "task_confirmed"
    target_deleted = activity.type.endswith("_deleted")
    if is_task_event:
        target_deleted = target_deleted or task is None
        return (task.stage_id if task else None, None, task.id if task else None, target_deleted)

    if stage is not None:
        return stage.id, stage.name, None, target_deleted

    # Deleted stages/tasks can no longer be resolved from current rows. Keep the
    # record visible, but expose no stale link target.
    return None, None, None, target_deleted


def get_project_overview(session: Session, project_id: int) -> dict:
    """Aggregate project identity, stage health, task metrics and recent activity."""
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    stages = list(
        session.scalars(
            select(Stage).where(Stage.project_id == project_id).order_by(Stage.position, Stage.id)
        )
    )
    tasks = list(
        session.scalars(
            select(Task).where(Task.project_id == project_id, Task.stage_id.is_not(None))
        )
    )
    owner_rows = session.execute(
        select(Profile.id, Profile.name)
        .join(ProjectMember, ProjectMember.user_id == Profile.id)
        .where(ProjectMember.project_id == project_id, ProjectMember.role == "owner")
        .order_by(Profile.name)
    ).all()
    starts = [stage.planned_start for stage in stages if stage.planned_start]
    ends = [stage.planned_end for stage in stages if stage.planned_end]
    primary = next((stage for stage in stages if stage.is_primary), None)

    return {
        "project": to_dict(project),
        "owners": [{"id": user_id, "name": name} for user_id, name in owner_rows],
        "planned_start": min(starts) if starts else None,
        "planned_end": max(ends) if ends else None,
        "overall_status": _overall_status(stages),
        "primary_stage": to_dict(primary),
        "parallel_stages": [
            to_dict(stage)
            for stage in stages
            if stage.status == "active" and (primary is None or stage.id != primary.id)
        ],
        "metrics": {
            "open_tasks": sum(task.status != "done" for task in tasks),
            "blocked_tasks": sum(task.status == "blocked" for task in tasks),
            "pending_acceptance_stages": sum(stage.status == "pending_acceptance" for stage in stages),
        },
        "recent_activities": list_activities(session, project_id, limit=5),
    }


def list_project_risks(session: Session, project_id: int) -> list[dict]:
    """Expose unresolved blockers and overdue high-priority work."""
    if session.get(Project, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")

    stages = list(
        session.scalars(
            select(Stage).where(Stage.project_id == project_id).order_by(Stage.position, Stage.id)
        )
    )
    stages_by_id = {stage.id: stage for stage in stages}
    tasks = list(
        session.scalars(
            select(Task).where(Task.project_id == project_id, Task.stage_id.is_not(None))
        )
    )
    tasks_by_id = {task.id: task for task in tasks}
    member_names = _member_names(session, project_id)
    risks: list[dict] = []

    stage_blockers = list(
        session.scalars(
            select(StageBlocker)
            .join(Stage, Stage.id == StageBlocker.stage_id)
            .where(Stage.project_id == project_id, StageBlocker.resolved_at.is_(None))
            .order_by(StageBlocker.created_at, StageBlocker.id)
        )
    )
    for blocker in stage_blockers:
        stage = stages_by_id[blocker.stage_id]
        risks.append(
            _risk(
                "stage_blocker",
                "high",
                f"{stage.name} 受阻",
                blocker.reason,
                member_names.get(blocker.handler_id or "", blocker.handler_id),
                max(1, _days_since(blocker.created_at)),
                None,
                stage.id,
                None,
                blocker.id,
            )
        )

    task_blockers = list(
        session.scalars(
            select(TaskBlocker)
            .join(Task, Task.id == TaskBlocker.task_id)
            .where(
                Task.project_id == project_id,
                Task.stage_id.is_not(None),
                Task.status == "blocked",
                Task.priority.in_(["urgent", "important"]),
                TaskBlocker.resolved_at.is_(None),
            )
            .order_by(TaskBlocker.created_at, TaskBlocker.id)
        )
    )
    for blocker in task_blockers:
        task = tasks_by_id[blocker.task_id]
        risks.append(
            _risk(
                "task_blocker",
                "high" if task.priority == "urgent" else "medium",
                f"{task.title} 受阻",
                blocker.reason,
                member_names.get(blocker.handler_id or task.assignee or "", blocker.handler_id or task.assignee),
                max(1, _days_since(blocker.created_at)),
                None,
                task.stage_id,
                task.id,
                blocker.id,
            )
        )

    today = date.today()
    for stage in stages:
        overdue = _days_since(stage.planned_end)
        if stage.status != "completed" and stage.planned_end and stage.planned_end < today.isoformat() and overdue:
            risks.append(
                _risk(
                    "overdue_stage",
                    "medium",
                    f"{stage.name} 逾期",
                    stage.goal,
                    member_names.get(stage.owner_id or "", stage.owner_id),
                    overdue,
                    overdue,
                    stage.id,
                    None,
                    None,
                )
            )

    for task in tasks:
        overdue = _days_since(task.planned_date)
        if (
            task.priority in ("urgent", "important")
            and task.status != "done"
            and task.planned_date
            and task.planned_date < today.isoformat()
            and overdue
        ):
            risks.append(
                _risk(
                    "overdue_task",
                    "high" if task.priority == "urgent" else "medium",
                    f"{task.title} 逾期",
                    f"计划日期：{task.planned_date}",
                    member_names.get(task.assignee or "", task.assignee),
                    overdue,
                    overdue,
                    task.stage_id,
                    task.id,
                    None,
                )
            )

    severity_order = {"high": 0, "medium": 1}
    risks.sort(key=lambda item: (severity_order[item["severity"]], item["kind"], item["title"]))
    return risks


def list_activities(
    session: Session,
    project_id: int,
    *,
    stage_id: int | None = None,
    type: str | None = None,
    created_by: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Query and enrich project activities; records themselves are immutable."""
    if session.get(Project, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")

    statement = (
        select(ProjectActivity, Profile.name)
        .outerjoin(Profile, Profile.id == ProjectActivity.created_by)
        .where(ProjectActivity.project_id == project_id)
    )
    if type:
        statement = statement.where(ProjectActivity.type == type)
    if created_by:
        statement = statement.where(ProjectActivity.created_by == created_by)
    statement = statement.order_by(ProjectActivity.created_at.desc(), ProjectActivity.id.desc())

    stages = list(
        session.scalars(select(Stage).where(Stage.project_id == project_id).order_by(Stage.position, Stage.id))
    )
    stages_by_id = {stage.id: stage for stage in stages}
    stages_by_name = {stage.name: stage for stage in stages}
    tasks = list(
        session.scalars(select(Task).where(Task.project_id == project_id, Task.stage_id.is_not(None)))
    )
    tasks_by_id = {task.id: task for task in tasks}
    tasks_by_title = {task.title: task for task in tasks}

    enriched: list[dict] = []
    for row in session.execute(statement).all():
        activity, created_by_name = row
        target_stage_id, stage_name, task_id, target_deleted = _activity_target(
            activity, stages_by_id, stages_by_name, tasks_by_id, tasks_by_title
        )
        if stage_id is not None and target_stage_id != stage_id:
            continue
        enriched.append(
            {
                "id": activity.id,
                "type": activity.type,
                "description": activity.description,
                "stage_id": target_stage_id,
                "stage_name": stage_name or stages_by_id.get(target_stage_id).name if target_stage_id else None,
                "task_id": task_id,
                "created_by": activity.created_by,
                "created_by_name": created_by_name or activity.created_by,
                "created_at": activity.created_at,
                "target_deleted": target_deleted,
            }
        )

    return enriched[offset : offset + limit]


def add_member(session: Session, project_id: int, user_id: str, name: str, email: str, role: str, created_by: str) -> dict:
    """Add a new member to the project. Enforces owner role requirement."""
    # Check if member already exists
    existing = session.get(ProjectMember, (project_id, user_id))
    if existing is not None:
        raise HTTPException(status_code=409, detail="该成员已在项目中")

    # Upsert profile
    profile = session.get(Profile, user_id)
    if profile is None:
        profile = Profile(id=user_id, name=name, email=email, created_at=_now())
        session.add(profile)
    else:
        profile.name = name
        profile.email = email

    # Add member
    member = ProjectMember(project_id=project_id, user_id=user_id, role=role)
    session.add(member)

    # Activity
    role_label = {"owner": "项目负责人", "member": "成员", "observer": "观察者"}[role]
    _activity(session, project_id, "member_added", f"添加{role_label}「{name}」", created_by)

    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {created_by} 将用户 {user_id}（{name}）添加为项目 {project_id} 的{role_label}失败")
        raise
    logger.info(f"操作者 {created_by} 将用户 {user_id}（{name}）添加为项目 {project_id} 的{role_label}成功")

    # Return member info
    row = session.execute(
        select(Profile.id, Profile.name, Profile.email, Profile.avatar_url, ProjectMember.role)
        .join_from(ProjectMember, Profile, Profile.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
    ).mappings().first()
    return dict(row)


def update_member_role(session: Session, project_id: int, user_id: str, new_role: str, updated_by: str) -> dict:
    """Update a member's role. Enforces minimum 2 owners constraint."""
    member = session.get(ProjectMember, (project_id, user_id))
    if member is None:
        raise HTTPException(status_code=404, detail="成员不存在")

    old_role = member.role
    if old_role == new_role:
        # No change needed
        row = session.execute(
            select(Profile.id, Profile.name, Profile.email, Profile.avatar_url, ProjectMember.role)
            .join_from(ProjectMember, Profile, Profile.id == ProjectMember.user_id)
            .where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        ).mappings().first()
        return dict(row)

    # Check owner constraint if downgrading from owner
    if old_role == "owner" and new_role != "owner":
        owner_count = _count_owners(session, project_id)
        if owner_count <= 2:
            raise HTTPException(status_code=409, detail="项目至少需要 2 名项目负责人以确保验收独立性")

    # Update role
    member.role = new_role

    # Activity
    role_label = {"owner": "项目负责人", "member": "成员", "observer": "观察者"}
    profile = session.get(Profile, user_id)
    _activity(session, project_id, "member_role_changed", f"将「{profile.name}」角色调整为{role_label[new_role]}", updated_by)

    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(
            f"操作者 {updated_by} 将用户 {user_id}（{profile.name}）在项目 {project_id} 的角色 "
            f"从 {old_role} 调整为 {new_role} 失败"
        )
        raise
    logger.info(
        f"操作者 {updated_by} 将用户 {user_id}（{profile.name}）在项目 {project_id} 的角色 "
        f"从 {old_role} 调整为 {new_role} 成功"
    )

    # Return updated member info
    row = session.execute(
        select(Profile.id, Profile.name, Profile.email, Profile.avatar_url, ProjectMember.role)
        .join_from(ProjectMember, Profile, Profile.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
    ).mappings().first()
    return dict(row)


def remove_member(session: Session, project_id: int, user_id: str, removed_by: str) -> dict:
    """Remove a member from the project. Enforces checks for stage ownership, tasks, and owner count."""
    member = session.get(ProjectMember, (project_id, user_id))
    if member is None:
        raise HTTPException(status_code=404, detail="成员不存在")

    profile = session.get(Profile, user_id)

    # Check 1: Is stage owner?
    stage_count = session.scalar(
        select(func.count()).select_from(Stage).where(Stage.project_id == project_id, Stage.owner_id == user_id)
    ) or 0
    if stage_count > 0:
        raise HTTPException(status_code=409, detail=f"该成员是 {stage_count} 个阶段的负责人，请先更换负责人")

    # Check 2: Has unfinished tasks?
    task_count = session.scalar(
        select(func.count()).select_from(Task).where(Task.project_id == project_id, Task.assignee == user_id, Task.status != "completed")
    ) or 0
    if task_count > 0:
        raise HTTPException(status_code=409, detail=f"该成员有 {task_count} 个未完成任务，请先重新分配")

    # Check 3: Owner count constraint
    if member.role == "owner":
        owner_count = _count_owners(session, project_id)
        if owner_count <= 2:
            raise HTTPException(status_code=409, detail="项目至少需要 2 名项目负责人以确保验收独立性")

    # Remove member
    member_name = profile.name if profile is not None else user_id
    session.delete(member)
    _activity(session, project_id, "member_removed", f"移除成员「{member_name}」", removed_by)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {removed_by} 将用户 {user_id}（{member_name}）从项目 {project_id} 移除失败")
        raise
    logger.info(f"操作者 {removed_by} 将用户 {user_id}（{member_name}）从项目 {project_id} 移除成功")

    return {"deleted": True}
