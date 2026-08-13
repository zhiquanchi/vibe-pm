from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.domains.tasks import create_task, delete_task, list_tasks, update_task
from app.routers.projects import require_project_member
from app.schemas.stages import TaskListFilters
from app.schemas.task import TaskCreate, TaskCreateRequest, TaskUpdateRequest
from app.services import tasks as task_service


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


# --- PRD-03: stage-based task management ---


@router.post("/projects/{project_id}/stages/{stage_id}/tasks", status_code=201)
def create_stage_task(project_id: int, stage_id: int, payload: TaskCreate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    return task_service.create_stage_task(session, project_id, stage_id, payload, user_id)


@router.get("/projects/{project_id}/stages/{stage_id}/tasks")
def list_stage_tasks(
    project_id: int,
    stage_id: int,
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    assignee: str | None = Query(default=None),
    search: str | None = Query(default=None),
    sort: str = Query(default="created_at"),
    _user_id: str = Depends(require_project_member),
    session: Session = Depends(get_db),
):
    filters = TaskListFilters(status=status, priority=priority, assignee=assignee, search=search, sort=sort)
    return task_service.list_stage_tasks(session, project_id, stage_id, filters)
