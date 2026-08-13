from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from loguru import logger

from app.db.models import Profile, ProjectActivity, ProjectMember, Stage, Task


def _now() -> str:
    return datetime.utcnow().isoformat()


def _activity(session: Session, project_id: int, type: str, description: str, created_by: str) -> None:
    session.add(ProjectActivity(project_id=project_id, type=type, description=description, created_by=created_by, created_at=_now()))


def _count_owners(session: Session, project_id: int) -> int:
    """Count current project owners."""
    return session.scalar(select(func.count()).select_from(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.role == "owner")) or 0


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
