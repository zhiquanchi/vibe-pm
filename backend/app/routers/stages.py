from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.routers.projects import require_project_member
from app.schemas.stages import (
    ReorderRequest,
    StageAcceptanceHandle,
    StageAcceptanceSubmit,
    StageCompleteRequest,
    StageCreate,
    StageDeliverableCreate,
    StageDeliverableUpdate,
    StageOwnerRequest,
    StageReopenRequest,
    StageStartRequest,
    StageUpdate,
)
from app.services import stages as stage_service
from app.services.stages import DEFAULT_STAGE_TEMPLATE
from loguru import logger

router = APIRouter(prefix="/api", tags=["stages"])


@router.get("/stage-template")
def get_stage_template():
    logger.info("[endpoint GET /api/stage-template]")
    return [{"name": name} for name in DEFAULT_STAGE_TEMPLATE]


@router.get("/projects/{project_id}/stages")
def list_stages(project_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/projects/{project_id}/stages] listing")
    return stage_service.list_stages(session, project_id)


@router.post("/projects/{project_id}/stages", status_code=201)
def add_stage(project_id: int, payload: StageCreate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/stages] user_id={user_id} name={payload.name!r}")
    return stage_service.add_stage(session, project_id, payload, user_id)


@router.patch("/projects/{project_id}/stages/{stage_id}")
def update_stage(project_id: int, stage_id: int, payload: StageUpdate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/projects/{project_id}/stages/{stage_id}] user_id={user_id}")
    return stage_service.update_stage(session, project_id, stage_id, payload, user_id)


@router.put("/projects/{project_id}/stages/reorder")
def reorder_stages(project_id: int, payload: ReorderRequest, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PUT /api/projects/{project_id}/stages/reorder] user_id={user_id} count={len(payload.stage_ids)}")
    return stage_service.reorder_stages(session, project_id, payload.stage_ids, user_id)


@router.delete("/projects/{project_id}/stages/{stage_id}")
def delete_stage(project_id: int, stage_id: int, confirm: bool = Query(default=False), user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint DELETE /api/projects/{project_id}/stages/{stage_id}] user_id={user_id} confirm={confirm}")
    return stage_service.delete_stage(session, project_id, stage_id, confirm, user_id)


@router.post("/projects/{project_id}/stages/{stage_id}/start")
def start_stage(project_id: int, stage_id: int, payload: StageStartRequest | None = None, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/stages/{stage_id}/start] user_id={user_id}")
    return stage_service.start_stage(session, project_id, stage_id, payload.primary if payload else False, user_id)


@router.post("/projects/{project_id}/stages/{stage_id}/primary")
def set_primary(project_id: int, stage_id: int, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/stages/{stage_id}/primary] user_id={user_id}")
    return stage_service.set_primary(session, project_id, stage_id, user_id)


@router.post("/projects/{project_id}/stages/{stage_id}/complete")
def complete_stage(project_id: int, stage_id: int, payload: StageCompleteRequest | None = None, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/stages/{stage_id}/complete] user_id={user_id}")
    return stage_service.complete_stage(session, project_id, stage_id, payload.successor_stage_id if payload else None, user_id)


@router.patch("/projects/{project_id}/stages/{stage_id}/owner")
def update_stage_owner(project_id: int, stage_id: int, payload: StageOwnerRequest, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/projects/{project_id}/stages/{stage_id}/owner] user_id={user_id} owner_id={payload.owner_id!r}")
    return stage_service.update_stage_owner(session, project_id, stage_id, payload.owner_id, user_id)


# --- PRD-05: stage deliverables & acceptance ---


@router.get("/projects/{project_id}/stages/{stage_id}/deliverables")
def list_stage_deliverables(project_id: int, stage_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/projects/{project_id}/stages/{stage_id}/deliverables] user_id={_user_id}")
    return stage_service.list_deliverables(session, project_id, stage_id)


@router.post("/projects/{project_id}/stages/{stage_id}/deliverables", status_code=201)
def create_stage_deliverable(project_id: int, stage_id: int, payload: StageDeliverableCreate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/stages/{stage_id}/deliverables] user_id={user_id} name={payload.name!r}")
    return stage_service.add_deliverable(session, project_id, stage_id, payload, user_id)


@router.patch("/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}")
def update_stage_deliverable(project_id: int, stage_id: int, deliverable_id: int, payload: StageDeliverableUpdate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}] user_id={user_id}")
    return stage_service.update_deliverable(session, project_id, stage_id, deliverable_id, payload, user_id)


@router.delete("/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}")
def delete_stage_deliverable(project_id: int, stage_id: int, deliverable_id: int, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint DELETE /api/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}] user_id={user_id}")
    return stage_service.delete_deliverable(session, project_id, stage_id, deliverable_id, user_id)


@router.post("/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}/mark-required")
def mark_stage_deliverable_required(project_id: int, stage_id: int, deliverable_id: int, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}/mark-required] user_id={user_id}")
    return stage_service.set_deliverable_required(session, project_id, stage_id, deliverable_id, True, user_id)


@router.delete("/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}/mark-required")
def unmark_stage_deliverable_required(project_id: int, stage_id: int, deliverable_id: int, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint DELETE /api/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}/mark-required] user_id={user_id}")
    return stage_service.set_deliverable_required(session, project_id, stage_id, deliverable_id, False, user_id)


@router.get("/projects/{project_id}/stages/{stage_id}/acceptances")
def list_stage_acceptances(project_id: int, stage_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/projects/{project_id}/stages/{stage_id}/acceptances] user_id={_user_id}")
    return stage_service.list_acceptances(session, project_id, stage_id)


@router.post("/projects/{project_id}/stages/{stage_id}/acceptances", status_code=201)
def submit_stage_acceptance(project_id: int, stage_id: int, payload: StageAcceptanceSubmit | None = None, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/stages/{stage_id}/acceptances] user_id={user_id}")
    return stage_service.submit_acceptance(session, project_id, stage_id, payload, user_id)


@router.patch("/projects/{project_id}/stages/{stage_id}/acceptances/{acceptance_id}")
def handle_stage_acceptance(project_id: int, stage_id: int, acceptance_id: int, payload: StageAcceptanceHandle, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/projects/{project_id}/stages/{stage_id}/acceptances/{acceptance_id}] user_id={user_id} action={payload.action}")
    return stage_service.handle_acceptance(session, project_id, stage_id, acceptance_id, payload, user_id)


@router.post("/projects/{project_id}/stages/{stage_id}/reopen")
def reopen_stage(project_id: int, stage_id: int, payload: StageReopenRequest, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/stages/{stage_id}/reopen] user_id={user_id}")
    return stage_service.reopen_stage(session, project_id, stage_id, payload.reason, user_id)
