from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from loguru import logger

from app.db.models import (
    Profile,
    Project,
    ProjectActivity,
    ProjectMember,
    Stage,
    StageAcceptance,
    StageBlocker,
    StageDeliverable,
    Task,
)
from app.schemas.stages import StageTemplateItem
from app.services.common import to_dict


DEFAULT_STAGE_TEMPLATE = ["需求分析", "技术设计", "开发", "测试", "发布"]

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


def _require_writer(session: Session, project_id: int, user_id: str) -> None:
    member = session.get(ProjectMember, (project_id, user_id))
    if member is None or member.role == "observer":
        raise HTTPException(status_code=403, detail="观察者无权提交阶段交付物")


def _require_stage_owner_or_project_owner(session: Session, project_id: int, stage: Stage, user_id: str) -> None:
    member = session.get(ProjectMember, (project_id, user_id))
    if member is None or member.role == "observer":
        raise HTTPException(status_code=403, detail="只有阶段负责人或项目负责人可以提交阶段验收")
    if member.role != "owner" and stage.owner_id != user_id:
        raise HTTPException(status_code=403, detail="只有阶段负责人或项目负责人可以提交阶段验收")


def _require_stage_mutable(stage: Stage) -> None:
    if stage.status == "completed":
        raise HTTPException(status_code=409, detail="已完成阶段为只读")
    if stage.status == "pending_acceptance":
        raise HTTPException(status_code=409, detail="待验收阶段为只读")


def _deliverable_or_404(session: Session, stage_id: int, deliverable_id: int) -> StageDeliverable:
    deliverable = session.get(StageDeliverable, deliverable_id)
    if deliverable is None or deliverable.stage_id != stage_id:
        raise HTTPException(status_code=404, detail="Deliverable not found")
    return deliverable


def _acceptance_or_404(session: Session, stage_id: int, acceptance_id: int) -> StageAcceptance:
    acceptance = session.get(StageAcceptance, acceptance_id)
    if acceptance is None or acceptance.stage_id != stage_id:
        raise HTTPException(status_code=404, detail="Acceptance not found")
    return acceptance


def _deliverable_dict(deliverable: StageDeliverable) -> dict:
    result = to_dict(deliverable)
    # Keep the frontend-first PRD-05 contract working while the persisted schema
    # remains aligned with the OpenSpec design.
    result["file_url"] = deliverable.file_path
    return result


def _acceptance_dict(acceptance: StageAcceptance) -> dict:
    result = to_dict(acceptance)
    result.update(
        {
            "reviewed_by": acceptance.handled_by,
            "reviewed_at": acceptance.handled_at,
            "note": acceptance.notes,
        }
    )
    return result


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
        # Development identities are provisioned on first use so a stage owner
        # who is not yet a member still satisfies the profiles FK.
        if item.owner_id and session.get(Profile, item.owner_id) is None:
            session.add(Profile(id=item.owner_id, name=item.owner_id, email=f"{item.owner_id}@local.invalid", created_at=now))
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
        task_count = session.scalar(select(func.count()).select_from(Task).where(Task.stage_id == stage_id)) or 0
        deliverable_count = session.scalar(select(func.count()).select_from(StageDeliverable).where(StageDeliverable.stage_id == stage_id)) or 0
        raise HTTPException(
            status_code=409,
            detail={
                "message": "删除阶段前请确认影响范围",
                "impact": {"tasks": task_count, "deliverables": deliverable_count},
                "confirm_required": True,
            },
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


def list_deliverables(session: Session, project_id: int, stage_id: int) -> list[dict]:
    _stage_or_404(session, project_id, stage_id)
    deliverables = session.scalars(
        select(StageDeliverable)
        .where(StageDeliverable.stage_id == stage_id)
        .order_by(StageDeliverable.submitted_at.desc(), StageDeliverable.id.desc())
    ).all()
    return [_deliverable_dict(item) for item in deliverables]


def _stored_file_path(payload) -> str | None:
    file_path = getattr(payload, "file_path", None)
    file_url = getattr(payload, "file_url", None)
    return file_path or file_url


def _infer_content_kind(payload) -> str:
    kind = payload.content_kind
    file_path = _stored_file_path(payload)
    if kind == "link" and not payload.link:
        if file_path:
            return "file"
        if payload.text:
            return "text"
    return kind


def add_deliverable(session: Session, project_id: int, stage_id: int, payload, user_id: str) -> dict:
    _require_writer(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    _require_stage_mutable(stage)
    now = _now()
    deliverable = StageDeliverable(
        stage_id=stage_id,
        name=payload.name.strip(),
        type=payload.type,
        content_kind=_infer_content_kind(payload),
        text=payload.text,
        link=payload.link,
        file_path=_stored_file_path(payload),
        file_name=payload.file_name,
        file_size=payload.file_size,
        submitted_by=user_id,
        submitted_at=now,
        is_required=False,
    )
    session.add(deliverable)
    _activity(session, project_id, "stage_deliverable_added", f"添加阶段交付物「{deliverable.name}」", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 在阶段 {stage_id} 添加交付物「{deliverable.name}」失败")
        raise
    logger.info(f"操作者 {user_id} 在阶段 {stage_id} 添加交付物「{deliverable.name}」(deliverable_id={deliverable.id}) 成功")
    return _deliverable_dict(deliverable)


def update_deliverable(session: Session, project_id: int, stage_id: int, deliverable_id: int, payload, user_id: str) -> dict:
    _require_writer(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    _require_stage_mutable(stage)
    deliverable = _deliverable_or_404(session, stage_id, deliverable_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("name") is None or "type" in data and data["type"] is None:
        raise HTTPException(status_code=422, detail="交付物名称和类型不能为空")

    for key in ("name", "type", "content_kind", "text", "link", "file_name", "file_size"):
        if key in data:
            setattr(deliverable, key, data[key])
    if "file_path" in data or "file_url" in data:
        deliverable.file_path = data.get("file_path", data.get("file_url"))
    deliverable.submitted_by = user_id
    deliverable.submitted_at = _now()
    _activity(session, project_id, "stage_deliverable_updated", f"更新阶段交付物「{deliverable.name}」", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 更新阶段 {stage_id} 交付物 {deliverable_id} 失败")
        raise
    logger.info(f"操作者 {user_id} 更新阶段 {stage_id} 交付物 {deliverable_id} 成功")
    return _deliverable_dict(deliverable)


def delete_deliverable(session: Session, project_id: int, stage_id: int, deliverable_id: int, user_id: str) -> dict:
    _require_writer(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    _require_stage_mutable(stage)
    deliverable = _deliverable_or_404(session, stage_id, deliverable_id)
    name = deliverable.name
    session.delete(deliverable)
    _activity(session, project_id, "stage_deliverable_removed", f"删除阶段交付物「{name}」", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 删除阶段 {stage_id} 交付物「{name}」失败")
        raise
    logger.info(f"操作者 {user_id} 删除阶段 {stage_id} 交付物「{name}」(deliverable_id={deliverable_id}) 成功")
    return {"deleted": True}


def set_deliverable_required(
    session: Session,
    project_id: int,
    stage_id: int,
    deliverable_id: int,
    required: bool,
    user_id: str,
) -> dict:
    _require_owner(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    _require_stage_mutable(stage)
    deliverable = _deliverable_or_404(session, stage_id, deliverable_id)
    if deliverable.is_required != required:
        deliverable.is_required = required
        activity_type = "stage_deliverable_required" if required else "stage_deliverable_optional"
        description = f"阶段交付物「{deliverable.name}」设为验收必需" if required else f"阶段交付物「{deliverable.name}」取消验收必需"
        _activity(session, project_id, activity_type, description, user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 调整阶段 {stage_id} 交付物 {deliverable_id} 验收必需状态失败")
        raise
    logger.info(f"操作者 {user_id} 调整阶段 {stage_id} 交付物 {deliverable_id} 验收必需状态为 {required} 成功")
    return _deliverable_dict(deliverable)


def list_acceptances(session: Session, project_id: int, stage_id: int) -> list[dict]:
    _stage_or_404(session, project_id, stage_id)
    acceptances = session.scalars(select(StageAcceptance).where(StageAcceptance.stage_id == stage_id).order_by(StageAcceptance.id.desc())).all()
    return [_acceptance_dict(item) for item in acceptances]


def _acceptance_conditions(session: Session, stage_id: int) -> dict:
    incomplete_tasks = session.execute(
        select(Task.id, Task.title)
        .where(Task.stage_id == stage_id, Task.acceptance_required.is_(True), Task.status != "done")
        .order_by(Task.id)
    ).all()
    required_deliverables = session.execute(
        select(StageDeliverable.id, StageDeliverable.name, StageDeliverable.link, StageDeliverable.file_path, StageDeliverable.text)
        .where(
            StageDeliverable.stage_id == stage_id,
            StageDeliverable.is_required.is_(True),
        )
        .order_by(StageDeliverable.id)
    ).mappings().all()
    missing_deliverables = [
        {"id": row["id"], "name": row["name"]}
        for row in required_deliverables
        if not any(row[key] for key in ("link", "file_path", "text"))
    ]
    unresolved_blockers = session.execute(
        select(StageBlocker.id, StageBlocker.reason)
        .where(StageBlocker.stage_id == stage_id, StageBlocker.resolved_at.is_(None))
        .order_by(StageBlocker.id)
    ).all()
    return {
        "incomplete_required_tasks": [{"id": row.id, "title": row.title} for row in incomplete_tasks],
        "missing_required_deliverables": missing_deliverables,
        "unresolved_stage_blockers": [{"id": row.id, "reason": row.reason} for row in unresolved_blockers],
    }


def submit_acceptance(session: Session, project_id: int, stage_id: int, payload, user_id: str) -> dict:
    stage = _stage_or_404(session, project_id, stage_id)
    _require_stage_owner_or_project_owner(session, project_id, stage, user_id)
    if stage.status != "active":
        raise HTTPException(status_code=409, detail="仅进行中阶段可以提交验收")
    owner_count = session.scalar(select(func.count()).select_from(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.role == "owner")) or 0
    if owner_count < 2:
        raise HTTPException(status_code=409, detail="项目至少需要 2 名项目负责人以确保验收独立性")
    pending = session.scalars(select(StageAcceptance.id).where(StageAcceptance.stage_id == stage_id, StageAcceptance.status == "pending").limit(1)).first()
    if pending is not None:
        raise HTTPException(status_code=409, detail="该阶段已有待处理验收")
    conditions = _acceptance_conditions(session, stage_id)
    if any(conditions.values()):
        raise HTTPException(
            status_code=409,
            detail={"message": "阶段验收条件未满足", **conditions},
        )

    acceptance = StageAcceptance(
        stage_id=stage_id,
        submitted_by=user_id,
        submitted_at=_now(),
        status="pending",
        notes=payload.notes.strip() if payload and payload.notes else None,
    )
    stage.status = "pending_acceptance"
    session.add(acceptance)
    _activity(session, project_id, "stage_acceptance_submitted", f"阶段「{stage.name}」提交验收", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 提交阶段「{stage.name}」(stage_id={stage_id}) 验收失败")
        raise
    logger.info(f"操作者 {user_id} 提交阶段「{stage.name}」(stage_id={stage_id}) 验收成功")
    return _acceptance_dict(acceptance)


def handle_acceptance(session: Session, project_id: int, stage_id: int, acceptance_id: int, payload, user_id: str) -> dict:
    _require_owner(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    acceptance = _acceptance_or_404(session, stage_id, acceptance_id)
    if acceptance.status != "pending":
        raise HTTPException(status_code=409, detail="该验收记录已处理")
    if stage.status != "pending_acceptance":
        raise HTTPException(status_code=409, detail="阶段不在待验收状态")
    if acceptance.submitted_by == user_id:
        raise HTTPException(status_code=403, detail="不能验收自己提交的阶段")

    now = _now()
    acceptance.handled_by = user_id
    acceptance.handled_at = now
    acceptance.notes = payload.notes.strip() if payload.notes else None
    if payload.action == "approve":
        acceptance.status = "approved"
        successor = None
        if stage.is_primary:
            successor = session.scalars(
                select(Stage)
                .where(Stage.project_id == project_id, Stage.status == "active", Stage.id != stage_id)
                .order_by(Stage.position, Stage.id)
                .limit(1)
            ).first()
            stage.is_primary = False
            if successor is not None:
                successor.is_primary = True
                _activity(session, project_id, "primary_changed", f"主阶段切换为「{successor.name}」", user_id)
        stage.status = "completed"
        _activity(session, project_id, "stage_acceptance_approved", f"确认阶段「{stage.name}」验收", user_id)
    else:
        acceptance.status = "rejected"
        acceptance.rejection_reason = payload.rejection_reason.strip()
        stage.status = "active"
        _activity(session, project_id, "stage_acceptance_rejected", f"驳回阶段「{stage.name}」验收：{acceptance.rejection_reason}", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 处理阶段 {stage_id} 验收 {acceptance_id} 失败")
        raise
    logger.info(f"操作者 {user_id} 处理阶段 {stage_id} 验收 {acceptance_id} 成功：{payload.action}")
    return _acceptance_dict(acceptance)


def reopen_stage(session: Session, project_id: int, stage_id: int, reason: str, user_id: str) -> dict:
    _require_owner(session, project_id, user_id)
    stage = _stage_or_404(session, project_id, stage_id)
    if stage.status != "completed":
        raise HTTPException(status_code=409, detail="仅已完成阶段可以重新打开")
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise HTTPException(status_code=422, detail="重新打开阶段时必须填写原因")
    stage.status = "active"
    has_primary = session.scalars(select(Stage.id).where(Stage.project_id == project_id, Stage.is_primary.is_(True), Stage.id != stage_id).limit(1)).first() is not None
    if not has_primary and not session.scalars(select(Stage.id).where(Stage.project_id == project_id, Stage.status == "active", Stage.id != stage_id).limit(1)).first():
        stage.is_primary = True
    _activity(session, project_id, "stage_reopened", f"重新打开阶段「{stage.name}」：{normalized_reason}", user_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(f"操作者 {user_id} 重新打开阶段「{stage.name}」(stage_id={stage_id}) 失败")
        raise
    logger.info(f"操作者 {user_id} 重新打开阶段「{stage.name}」(stage_id={stage_id}) 成功")
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
