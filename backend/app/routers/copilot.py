from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.identity import current_user_id
from app.db.database import get_db
from app.routers.projects import require_project_member
from app.schemas.copilot import CopilotChatRequest
from app.services import copilot as copilot_service
from loguru import logger

router = APIRouter(prefix="/api", tags=["copilot"])


@router.post("/projects/{project_id}/copilot/summary")
def copilot_summary(
    project_id: int,
    _user_id: str = Depends(require_project_member),
    session: Session = Depends(get_db),
):
    logger.info(f"[endpoint POST /api/projects/{project_id}/copilot/summary] user_id={_user_id}")
    return copilot_service.generate_summary(session, project_id)


@router.post("/projects/{project_id}/stages/{stage_id}/copilot/analysis")
def copilot_stage_analysis(
    project_id: int,
    stage_id: int,
    _user_id: str = Depends(require_project_member),
    session: Session = Depends(get_db),
):
    logger.info(
        f"[endpoint POST /api/projects/{project_id}/stages/{stage_id}/copilot/analysis] "
        f"user_id={_user_id} stage_id={stage_id}"
    )
    return copilot_service.analyze_stage(session, project_id, stage_id)


@router.get("/my-tasks/copilot/advice")
def copilot_my_task_advice(
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    logger.info(f"[endpoint GET /api/my-tasks/copilot/advice] user_id={user_id}")
    return copilot_service.my_task_advice(session, user_id)


@router.post("/projects/{project_id}/copilot/chat")
def copilot_chat(
    project_id: int,
    payload: CopilotChatRequest,
    user_id: str = Depends(require_project_member),
    session: Session = Depends(get_db),
):
    logger.info(f"[endpoint POST /api/projects/{project_id}/copilot/chat] user_id={user_id}")
    history = [message.model_dump() for message in payload.history]
    return copilot_service.answer_project_question(
        session, project_id, payload.question, history, user_id
    )


@router.get("/projects/{project_id}/copilot/changes")
def copilot_changes(
    project_id: int,
    range_key: Literal["24h", "7d", "30d"] = Query(alias="range", default="7d"),
    _user_id: str = Depends(require_project_member),
    session: Session = Depends(get_db),
):
    logger.info(
        f"[endpoint GET /api/projects/{project_id}/copilot/changes] user_id={_user_id} range={range_key}"
    )
    return copilot_service.review_changes(session, project_id, range_key)
