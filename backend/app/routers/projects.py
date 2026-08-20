from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.identity import current_user_id
from app.db.database import get_db
from app.db.models import Profile, Project, ProjectMember
from app.schemas.projects import MemberCreate, MemberUpdate, ProjectCreate, ProjectUpdate
from app.services import projects as project_service
from app.services import stages as stage_service
from app.services.common import to_dict
from loguru import logger

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _project_or_404(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        logger.warning(f"[endpoint project guard] 404 project not found: project_id={project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _member_rows(session: Session, project_id: int, order_by):
    stmt = (
        select(Profile.id, Profile.name, Profile.email, Profile.avatar_url, ProjectMember.role)
        .join_from(ProjectMember, Profile, Profile.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project_id)
        .order_by(*order_by)
    )
    return [dict(row) for row in session.execute(stmt).mappings()]


def require_project_member(project_id: int, user_id: str = Depends(current_user_id), session: Session = Depends(get_db)) -> str:
    _project_or_404(session, project_id)
    if session.get(ProjectMember, (project_id, user_id)) is None:
        logger.warning(f"[endpoint project guard] 403 membership required: project_id={project_id} user_id={user_id}")
        raise HTTPException(status_code=403, detail="Project membership required")
    return user_id


@router.post("")
def create_project(payload: ProjectCreate, user_id: str = Depends(current_user_id), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects] user_id={user_id} name={payload.name!r}")
    now = datetime.utcnow().isoformat()
    # Development identities are provisioned on first use.
    if session.get(Profile, user_id) is None:
        session.add(Profile(id=user_id, name=user_id, email=f"{user_id}@local.invalid", created_at=now))

    project = Project(name=payload.name, description=payload.description, created_at=now)
    session.add(project)
    session.flush()

    # Handle members
    if payload.members is not None:
        # Use provided members list (must have at least 2 owners - validated in schema)
        for member_spec in payload.members:
            # Upsert profile
            profile = session.get(Profile, member_spec.user_id)
            if profile is None:
                profile = Profile(id=member_spec.user_id, name=member_spec.name, email=member_spec.email, created_at=now)
                session.add(profile)
            else:
                profile.name = member_spec.name
                profile.email = member_spec.email
            # Add member
            session.add(ProjectMember(project_id=project.id, user_id=member_spec.user_id, role=member_spec.role))
    else:
        # Backward compatibility: creator becomes the only owner
        session.add(ProjectMember(project_id=project.id, user_id=user_id, role="owner"))

    stage_service.create_stages_for_project(session, project, payload.stages, user_id)
    session.commit()
    return to_dict(session.get(Project, project.id))


@router.get("/{project_id}")
def project_detail(project_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/projects/{project_id}] project detail")
    project = _project_or_404(session, project_id)
    members = _member_rows(session, project_id, (ProjectMember.role, Profile.name))
    return {"project": to_dict(project), "members": members}


@router.get("/{project_id}/overview")
def project_overview(project_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/projects/{project_id}/overview] user_id={_user_id}")
    return project_service.get_project_overview(session, project_id)


@router.get("/{project_id}/risks")
def project_risks(project_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/projects/{project_id}/risks] user_id={_user_id}")
    return project_service.list_project_risks(session, project_id)


@router.get("/{project_id}/activities")
def project_activities(
    project_id: int,
    stage_id: int | None = Query(default=None),
    type: str | None = Query(default=None),
    created_by: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _user_id: str = Depends(require_project_member),
    session: Session = Depends(get_db),
):
    logger.info(
        f"[endpoint GET /api/projects/{project_id}/activities] user_id={_user_id} "
        f"stage_id={stage_id} type={type!r} created_by={created_by!r}"
    )
    return project_service.list_activities(
        session,
        project_id,
        stage_id=stage_id,
        type=type,
        created_by=created_by,
        limit=limit,
        offset=offset,
    )


@router.get("/{project_id}/members")
def list_members(project_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/projects/{project_id}/members] listing")
    _project_or_404(session, project_id)
    return _member_rows(session, project_id, (Profile.name,))


@router.post("/{project_id}/members")
def add_member(project_id: int, payload: MemberCreate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/members] by user_id={user_id} add_user_id={payload.user_id}")
    _project_or_404(session, project_id)
    owner = session.get(ProjectMember, (project_id, user_id))
    if owner is None or owner.role != "owner":
        logger.warning(f"[endpoint POST /api/projects/{project_id}/members] 403 not owner: user_id={user_id}")
        raise HTTPException(status_code=403, detail="只有项目负责人可以添加成员")
    return project_service.add_member(session, project_id, payload.user_id, payload.name, payload.email, payload.role, user_id)


@router.patch("/{project_id}/members/{user_id}")
def update_member_role(project_id: int, user_id: str, payload: MemberUpdate, current_user: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/projects/{project_id}/members/{user_id}] by current_user={current_user} -> role={payload.role!r}")
    _project_or_404(session, project_id)
    owner = session.get(ProjectMember, (project_id, current_user))
    if owner is None or owner.role != "owner":
        logger.warning(f"[endpoint PATCH /api/projects/{project_id}/members/{user_id}] 403 not owner: current_user={current_user}")
        raise HTTPException(status_code=403, detail="只有项目负责人可以调整成员角色")
    return project_service.update_member_role(session, project_id, user_id, payload.role, current_user)


@router.delete("/{project_id}/members/{user_id}")
def remove_member(project_id: int, user_id: str, current_user: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint DELETE /api/projects/{project_id}/members/{user_id}] by current_user={current_user}")
    _project_or_404(session, project_id)
    owner = session.get(ProjectMember, (project_id, current_user))
    if owner is None or owner.role != "owner":
        logger.warning(f"[endpoint DELETE /api/projects/{project_id}/members/{user_id}] 403 not owner: current_user={current_user}")
        raise HTTPException(status_code=403, detail="只有项目负责人可以移除成员")
    return project_service.remove_member(session, project_id, user_id, current_user)


@router.patch("/{project_id}")
def update_project(project_id: int, payload: ProjectUpdate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/projects/{project_id}] by user_id={user_id}")
    project = _project_or_404(session, project_id)
    member = session.get(ProjectMember, (project_id, user_id))
    if member is None or member.role != "owner":
        logger.warning(f"[endpoint PATCH /api/projects/{project_id}] 403 not owner: user_id={user_id}")
        raise HTTPException(status_code=403, detail="只有项目 Owner 可以修改设置")
    data = payload.model_dump(exclude_none=True)
    if data:
        for key, value in data.items():
            setattr(project, key, value)
        session.commit()
    return to_dict(session.get(Project, project_id))
