from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.routers.projects import require_project_member
from app.schemas.stages import ReorderRequest, StageCompleteRequest, StageCreate, StageOwnerRequest, StageStartRequest, StageUpdate
from app.services import stages as stage_service
from app.services.stages import DEFAULT_STAGE_TEMPLATE

router = APIRouter(prefix="/api", tags=["stages"])


@router.get("/stage-template")
def get_stage_template():
    return [{"name": name} for name in DEFAULT_STAGE_TEMPLATE]


@router.get("/projects/{project_id}/stages")
def list_stages(project_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    return stage_service.list_stages(session, project_id)


@router.post("/projects/{project_id}/stages", status_code=201)
def add_stage(project_id: int, payload: StageCreate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    return stage_service.add_stage(session, project_id, payload, user_id)


@router.patch("/projects/{project_id}/stages/{stage_id}")
def update_stage(project_id: int, stage_id: int, payload: StageUpdate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    return stage_service.update_stage(session, project_id, stage_id, payload, user_id)


@router.put("/projects/{project_id}/stages/reorder")
def reorder_stages(project_id: int, payload: ReorderRequest, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    return stage_service.reorder_stages(session, project_id, payload.stage_ids, user_id)


@router.delete("/projects/{project_id}/stages/{stage_id}")
def delete_stage(project_id: int, stage_id: int, confirm: bool = Query(default=False), user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    return stage_service.delete_stage(session, project_id, stage_id, confirm, user_id)


@router.post("/projects/{project_id}/stages/{stage_id}/start")
def start_stage(project_id: int, stage_id: int, payload: StageStartRequest | None = None, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    return stage_service.start_stage(session, project_id, stage_id, payload.primary if payload else False, user_id)


@router.post("/projects/{project_id}/stages/{stage_id}/primary")
def set_primary(project_id: int, stage_id: int, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    return stage_service.set_primary(session, project_id, stage_id, user_id)


@router.post("/projects/{project_id}/stages/{stage_id}/complete")
def complete_stage(project_id: int, stage_id: int, payload: StageCompleteRequest | None = None, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    return stage_service.complete_stage(session, project_id, stage_id, payload.successor_stage_id if payload else None, user_id)


@router.patch("/projects/{project_id}/stages/{stage_id}/owner")
def update_stage_owner(project_id: int, stage_id: int, payload: StageOwnerRequest, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    return stage_service.update_stage_owner(session, project_id, stage_id, payload.owner_id, user_id)
