from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from loguru import logger

from app.db.models import Project, ProjectActivity, ProjectMember, Stage
from app.schemas.stages import StageTemplateItem
from app.services.common import to_dict


DEFAULT_STAGE_TEMPLATE = ["需求分析", "技术设计", "开发", "测试", "发布"]

# Delete-confirmation impact payload. Tasks and deliverables are not linked to
# stages yet (PRD-03/05); the protocol shape is fixed now, counts come later.
_DELETE_IMPACT = {"tasks": 0, "deliverables": 0}


def _now() -> str:
    return datetime.utcnow().isoformat()


def _activity(session: Session, project_id: int, type: str, description: str, created_by: str) -> None:
    session.add(ProjectActivity(project_id=project_id, type=type, description=description, created_by=created_by, created_at=_now()))


def _stage_or_404(session: Session, project_id: int, stage_id: int) -> Stage:
    stage = session.get(Stage, stage_id)
    if stage is None or stage.project_id != project_id:
        raise HTTPException(status_code=404, detail="Stage not found")
    return stage


def _require_owner(session: Session, project_id: int, user_id: str) -> None:
    member = session.get(ProjectMember, (project_id, user_id))
    if member is None or member.role != "owner":
        raise HTTPException(status_code=403, detail="只有项目负责人可以修改阶段结构")


def _name_taken(session: Session, project_id: int, name: str, exclude_id: int | None = None) -> bool:
    stmt = select(Stage.id).where(Stage.project_id == project_id, Stage.name == name)
    if exclude_id is not None:
        stmt = stmt.where(Stage.id != exclude_id)
    return session.scalars(stmt).first() is not None


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def create_stages_for_project(session: Session, project: Project, items: list[StageTemplateItem] | None, created_by: str) -> None:
    """Attach template (or caller-provided) stages to a freshly created project."""
    specs = items if items is not None else [StageTemplateItem(name=name) for name in DEFAULT_STAGE_TEMPLATE]
    now = _now()
    for position, item in enumerate(specs):
        session.add(
            Stage(
                project_id=project.id,
                name=item.name.strip(),
                goal=item.goal,
                position=position,
                owner_id=item.owner_id,
                planned_start=_iso(item.planned_start),
                planned_end=_iso(item.planned_end),
                status="planned",
                is_primary=False,
                created_at=now,
            )
        )
    _activity(session, project.id, "project_created", f"创建项目「{project.name}」（{len(specs)} 个阶段）", created_by)
    logger.info(f"操作者 {created_by} 创建项目「{project.name}」并初始化 {len(specs)} 个阶段")


def list_stages(session: Session, project_id: int) -> list[dict]:
    stages = session.scalars(select(Stage).where(Stage.project_id == project_id).order_by(Stage.position, Stage.id))
    return [to_dict(stage) for stage in stages]


def add_stage(session: Session, project_id: int, payload, user_id: str) -> dict:
    _require_owner(session, project_id, user_id)
    name = payload.name.strip()
    if _name_taken(session, project_id, name):
        raise HTTPException(status_code=409, detail="同一项目内阶段名称不能重复")
    position = session.scalar(select(func.coalesce(func.max(Stage.position), -1) + 1).where(Stage.project_id == project_id))
    stage = Stage(
        project_id=project_id,
        name=name,
        goal=payload.goal,
        position=position,
        owner_id=payload.owner_id,
        planned_start=_iso(payload.planned_start),
        planned_end=_iso(payload.planned_end),
        status="planned",
        is_primary=False,
        created_at=_now(),
    )
    session.add(stage)
    _activity(session, project_id, "stage_created", f"新增阶段「{name}」", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 在项目 {project_id} 新增阶段「{name}」失败")
        raise
    logger.info(f"操作者 {user_id} 在项目 {project_id} 新增阶段「{name}」(stage_id={stage.id}) 成功")
    return to_dict(stage)


def update_stage(session: Session, project_id: int, stage_id: int, payload, user_id: str) -> dict:
    _require_owner(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    data = payload.model_dump(exclude_unset=True)
    old_name = None
    if data.get("name") and data["name"].strip() != stage.name:
        if stage.status == "completed":
            raise HTTPException(status_code=409, detail="已完成阶段不能重命名")
        new_name = data["name"].strip()
        if _name_taken(session, project_id, new_name, exclude_id=stage_id):
            raise HTTPException(status_code=409, detail="同一项目内阶段名称不能重复")
        old_name, stage.name = stage.name, new_name
    for key in ("goal", "owner_id"):
        if key in data:
            setattr(stage, key, data[key])
    if "planned_start" in data:
        stage.planned_start = _iso(data["planned_start"])
    if "planned_end" in data:
        stage.planned_end = _iso(data["planned_end"])
    if stage.planned_start and stage.planned_end and stage.planned_end < stage.planned_start:
        raise HTTPException(status_code=422, detail="planned_end must be on or after planned_start")
    if old_name is not None:
        _activity(session, project_id, "stage_renamed", f"阶段「{old_name}」重命名为「{stage.name}」", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 更新阶段(stage_id={stage_id})失败")
        raise
    if old_name is not None:
        logger.info(f"操作者 {user_id} 将阶段「{old_name}」重命名为「{stage.name}」(stage_id={stage_id}) 成功")
    else:
        logger.info(f"操作者 {user_id} 更新阶段「{stage.name}」(stage_id={stage_id}) 成功")
    return to_dict(stage)


def reorder_stages(session: Session, project_id: int, stage_ids: list[int], user_id: str) -> list[dict]:
    _require_owner(session, project_id, user_id)
    stages = session.scalars(select(Stage).where(Stage.project_id == project_id)).all()
    by_id = {stage.id: stage for stage in stages}
    if any(stage_id not in by_id for stage_id in stage_ids):
        raise HTTPException(status_code=422, detail="存在不属于该项目的阶段")
    if len(set(stage_ids)) != len(stage_ids):
        raise HTTPException(status_code=422, detail="阶段 id 重复")
    if any(by_id[stage_id].status == "completed" for stage_id in stage_ids):
        raise HTTPException(status_code=409, detail="已完成阶段不能调整顺序")
    movable = [stage for stage in stages if stage.status != "completed"]
    if set(stage_ids) != {stage.id for stage in movable}:
        raise HTTPException(status_code=422, detail="必须提交全部未完成阶段")
    # Unfinished stages reorder among their own position slots; completed stay put.
    slots = sorted(stage.position for stage in movable)
    for slot, stage_id in zip(slots, stage_ids):
        by_id[stage_id].position = slot
    _activity(session, project_id, "stage_reordered", "调整阶段顺序", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 调整项目 {project_id} 阶段顺序失败")
        raise
    logger.info(f"操作者 {user_id} 调整项目 {project_id} 阶段顺序成功（共 {len(stage_ids)} 个阶段）")
    return list_stages(session, project_id)


def delete_stage(session: Session, project_id: int, stage_id: int, confirm: bool, user_id: str) -> dict:
    _require_owner(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    if stage.status == "completed":
        raise HTTPException(status_code=409, detail="已完成阶段不能删除")
    if not confirm:
        raise HTTPException(
            status_code=409,
            detail={"message": "删除阶段前请确认影响范围", "impact": dict(_DELETE_IMPACT), "confirm_required": True},
        )
    was_primary, name = stage.is_primary, stage.name
    session.delete(stage)
    session.flush()
    # Repack positions after removal.
    remaining = session.scalars(select(Stage).where(Stage.project_id == project_id).order_by(Stage.position, Stage.id)).all()
    for position, item in enumerate(remaining):
        item.position = position
    if was_primary:
        # Keep the single-primary invariant: promote the next active stage.
        successor = next((item for item in remaining if item.status == "active"), None)
        if successor is not None:
            successor.is_primary = True
            _activity(session, project_id, "primary_changed", f"主阶段切换为「{successor.name}」", user_id)
    _activity(session, project_id, "stage_deleted", f"删除阶段「{name}」", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 删除阶段「{name}」(stage_id={stage_id}) 失败")
        raise
    primary_msg = f"，主阶段切换为「{successor.name}」" if was_primary and successor is not None else ""
    logger.info(f"操作者 {user_id} 删除阶段「{name}」(stage_id={stage_id}) 成功{primary_msg}")
    return {"deleted": True}


def start_stage(session: Session, project_id: int, stage_id: int, primary: bool, user_id: str) -> dict:
    _require_owner(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    if stage.status != "planned":
        raise HTTPException(status_code=409, detail="仅未开始阶段可以启动")
    has_active = session.scalars(select(Stage.id).where(Stage.project_id == project_id, Stage.status == "active").limit(1)).first() is not None
    current_primary = session.scalars(select(Stage).where(Stage.project_id == project_id, Stage.is_primary.is_(True))).first()
    stage.status = "active"
    if not has_active:
        # The first started stage always becomes the primary stage.
        stage.is_primary = True
    elif primary:
        if current_primary is not None:
            current_primary.is_primary = False
        stage.is_primary = True
        _activity(session, project_id, "primary_changed", f"主阶段切换为「{stage.name}」", user_id)
    _activity(session, project_id, "stage_started", f"启动阶段「{stage.name}」", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 启动阶段「{stage.name}」(stage_id={stage_id}) 失败")
        raise
    primary_msg = "，并设为主阶段" if stage.is_primary else ""
    logger.info(f"操作者 {user_id} 启动阶段「{stage.name}」(stage_id={stage_id}) 成功{primary_msg}")
    return to_dict(stage)


def set_primary(session: Session, project_id: int, stage_id: int, user_id: str) -> dict:
    _require_owner(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    if stage.status != "active":
        raise HTTPException(status_code=409, detail="仅活动阶段可以指定为主阶段")
    if stage.is_primary:
        return to_dict(stage)
    current_primary = session.scalars(select(Stage).where(Stage.project_id == project_id, Stage.is_primary.is_(True))).first()
    if current_primary is not None:
        current_primary.is_primary = False
    stage.is_primary = True
    _activity(session, project_id, "primary_changed", f"主阶段切换为「{stage.name}」", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 将项目 {project_id} 主阶段切换为「{stage.name}」(stage_id={stage_id}) 失败")
        raise
    logger.info(f"操作者 {user_id} 将项目 {project_id} 主阶段切换为「{stage.name}」(stage_id={stage_id}) 成功")
    return to_dict(stage)


def complete_stage(session: Session, project_id: int, stage_id: int, successor_stage_id: int | None, user_id: str) -> dict:
    _require_owner(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    if stage.status != "active":
        raise HTTPException(status_code=409, detail="仅活动阶段可以完成")
    remaining_active = session.scalars(select(Stage.id).where(Stage.project_id == project_id, Stage.status == "active", Stage.id != stage.id)).all()
    successor = None
    if stage.is_primary and remaining_active:
        if successor_stage_id is None:
            raise HTTPException(status_code=409, detail="完成主阶段需指定继任主阶段")
        successor = _stage_or_404(session, project_id, successor_stage_id)
        if successor.status != "active":
            raise HTTPException(status_code=409, detail="继任主阶段必须是活动阶段")
    stage.is_primary = False
    stage.status = "completed"
    if successor is not None:
        successor.is_primary = True
        _activity(session, project_id, "primary_changed", f"主阶段切换为「{successor.name}」", user_id)
    _activity(session, project_id, "stage_completed", f"完成阶段「{stage.name}」", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 完成阶段「{stage.name}」(stage_id={stage_id}) 失败")
        raise
    successor_msg = f"，主阶段切换为「{successor.name}」" if successor is not None else ""
    logger.info(f"操作者 {user_id} 完成阶段「{stage.name}」(stage_id={stage_id}) 成功{successor_msg}")
    return to_dict(stage)


def update_stage_owner(session: Session, project_id: int, stage_id: int, new_owner_id: str, updated_by: str) -> dict:
    """Assign or change stage owner. Only project owners can do this."""
    _require_owner(session, project_id, updated_by)
    stage = _stage_or_404(session, project_id, stage_id)

    # Check if new owner is a project member
    new_owner_member = session.get(ProjectMember, (project_id, new_owner_id))
    if new_owner_member is None:
        raise HTTPException(status_code=422, detail="阶段负责人必须是项目成员")

    old_owner_id = stage.owner_id
    stage.owner_id = new_owner_id

    # Activity
    from app.db.models import Profile
    new_owner = session.get(Profile, new_owner_id)
    if old_owner_id is None:
        _activity(session, project_id, "stage_owner_changed", f"指定「{new_owner.name}」为阶段「{stage.name}」负责人", updated_by)
    else:
        old_owner = session.get(Profile, old_owner_id)
        _activity(session, project_id, "stage_owner_changed", f"阶段「{stage.name}」负责人从「{old_owner.name}」更换为「{new_owner.name}」", updated_by)

    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {updated_by} 变更阶段「{stage.name}」(stage_id={stage_id}) 负责人失败")
        raise
    if old_owner_id is None:
        logger.info(f"操作者 {updated_by} 指定「{new_owner.name}」为阶段「{stage.name}」(stage_id={stage_id}) 负责人成功")
    else:
        logger.info(
            f"操作者 {updated_by} 将阶段「{stage.name}」(stage_id={stage_id}) 负责人 "
            f"从「{old_owner.name}」更换为「{new_owner.name}」成功"
        )
    return to_dict(stage)
