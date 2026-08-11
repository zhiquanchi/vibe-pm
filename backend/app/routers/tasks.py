from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.domains.tasks import create_task, delete_task, list_tasks, update_task
from app.schemas.task import TaskCreateRequest, TaskUpdateRequest


router = APIRouter(prefix="/api", tags=["tasks"])


@router.get("/tasks")
def get_tasks(sprint_id: int | None = Query(default=None), session: Session = Depends(get_db)):
    return list_tasks(session, sprint_id)


@router.post("/tasks", status_code=201)
def post_task(payload: TaskCreateRequest, session: Session = Depends(get_db)):
    return create_task(session, payload.model_dump())


@router.patch("/tasks/{task_id}")
def patch_task(task_id: int, payload: TaskUpdateRequest, session: Session = Depends(get_db)):
    return update_task(session, task_id, payload.model_dump(exclude_unset=True))


@router.delete("/tasks/{task_id}")
def remove_task(task_id: int, reason: str | None = Query(default=None), created_by: str = Query(default="current-user"), session: Session = Depends(get_db)):
    delete_task(session, task_id, reason, created_by)
    return {"deleted": True}
