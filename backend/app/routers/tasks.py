from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.identity import current_user_id
from app.db.database import get_db
from app.domains.tasks import create_task, delete_task, list_tasks, update_task
from app.routers.projects import require_project_member
from app.schemas.stages import TaskListFilters
from app.schemas.task import (
    ConfirmBlockerRequest,
    StageBlockerCreate,
    StageBlockerResolve,
    TaskBlockerCreate,
    TaskBlockerResolve,
    TaskCreate,
    TaskCreateRequest,
    TaskDependencyCreate,
    TaskMoveRequest,
    TaskUpdate,
    TaskUpdateRequest,
)
from app.services import tasks as task_service
from loguru import logger


router = APIRouter(prefix="/api", tags=["tasks"])


@router.get("/tasks")
def get_tasks(sprint_id: int | None = Query(default=None), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/tasks] sprint_id={sprint_id}")
    return list_tasks(session, sprint_id)


@router.post("/tasks", status_code=201)
def post_task(payload: TaskCreateRequest, session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/tasks] project_id={payload.project_id} sprint_id={payload.sprint_id} title={payload.title!r}")
    return create_task(session, payload.model_dump())


@router.patch("/tasks/{task_id}")
def patch_task(task_id: int, payload: TaskUpdateRequest, session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/tasks/{task_id}] fields={list(payload.model_dump(exclude_unset=True).keys())}")
    return update_task(session, task_id, payload.model_dump(exclude_unset=True))


@router.delete("/tasks/{task_id}")
def remove_task(task_id: int, reason: str | None = Query(default=None), created_by: str = Query(default="current-user"), session: Session = Depends(get_db)):
    logger.info(f"[endpoint DELETE /api/tasks/{task_id}] created_by={created_by} (reason omitted)")
    delete_task(session, task_id, reason, created_by)
    return {"deleted": True}


# --- PRD-03: stage-based task management ---


@router.post("/projects/{project_id}/stages/{stage_id}/tasks", status_code=201)
def create_stage_task(project_id: int, stage_id: int, payload: TaskCreate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/stages/{stage_id}/tasks] user_id={user_id} title={payload.title!r}")
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
    logger.info(f"[endpoint GET /api/projects/{project_id}/stages/{stage_id}/tasks] status={status} priority={priority} assignee={assignee} sort={sort} (search omitted)")
    filters = TaskListFilters(status=status, priority=priority, assignee=assignee, search=search, sort=sort)
    return task_service.list_stage_tasks(session, project_id, stage_id, filters)


@router.patch("/projects/{project_id}/tasks/{task_id}")
def update_stage_task(project_id: int, task_id: int, payload: TaskUpdate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/projects/{project_id}/tasks/{task_id}] user_id={user_id}")
    return task_service.update_stage_task(session, project_id, task_id, payload, user_id)


@router.put("/projects/{project_id}/tasks/{task_id}/move")
def move_stage_task(project_id: int, task_id: int, payload: TaskMoveRequest, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PUT /api/projects/{project_id}/tasks/{task_id}/move] user_id={user_id} target_stage={payload.target_stage_id}")
    return task_service.move_task(session, project_id, task_id, payload, user_id)


@router.delete("/projects/{project_id}/tasks/{task_id}")
def delete_stage_task(project_id: int, task_id: int, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint DELETE /api/projects/{project_id}/tasks/{task_id}] user_id={user_id}")
    return task_service.delete_task(session, project_id, task_id, user_id)


@router.get("/my-tasks")
def my_tasks(
    project_id: int | None = Query(default=None),
    stage_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    sort: str = Query(default="planned_date"),
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    logger.info(f"[endpoint GET /api/my-tasks] user_id={user_id} project_id={project_id} status={status} priority={priority}")
    return task_service.list_my_tasks(session, user_id, project_id=project_id, stage_id=stage_id, status=status, priority=priority, sort=sort)


# --- PRD-04: task dependencies & blockers ---


@router.post("/projects/{project_id}/tasks/{task_id}/dependencies", status_code=201)
def add_task_dependency_endpoint(project_id: int, task_id: int, payload: TaskDependencyCreate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/tasks/{task_id}/dependencies] user_id={user_id} dependency_id={payload.dependency_id}")
    return task_service.add_task_dependency(session, project_id, task_id, payload.dependency_id, user_id)


@router.get("/projects/{project_id}/tasks/{task_id}/dependencies")
def list_task_dependencies_endpoint(project_id: int, task_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/projects/{project_id}/tasks/{task_id}/dependencies] user_id={_user_id}")
    return task_service.list_task_dependencies(session, project_id, task_id)


@router.delete("/projects/{project_id}/tasks/{task_id}/dependencies/{dep_id}")
def remove_task_dependency_endpoint(project_id: int, task_id: int, dep_id: int, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint DELETE /api/projects/{project_id}/tasks/{task_id}/dependencies/{dep_id}] user_id={user_id}")
    return task_service.remove_task_dependency(session, project_id, task_id, dep_id, user_id)


@router.post("/projects/{project_id}/tasks/{task_id}/blockers", status_code=201)
def mark_task_blocked_endpoint(project_id: int, task_id: int, payload: TaskBlockerCreate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/tasks/{task_id}/blockers] user_id={user_id} handler_id={payload.handler_id}")
    return task_service.mark_task_blocked(session, project_id, task_id, payload, user_id)


@router.get("/projects/{project_id}/tasks/{task_id}/blockers")
def list_task_blockers_endpoint(project_id: int, task_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/projects/{project_id}/tasks/{task_id}/blockers] user_id={_user_id}")
    return task_service.list_task_blockers(session, project_id, task_id)


@router.patch("/projects/{project_id}/tasks/{task_id}/blockers/{bid}")
def resolve_task_blocker_endpoint(project_id: int, task_id: int, bid: int, payload: TaskBlockerResolve, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/projects/{project_id}/tasks/{task_id}/blockers/{bid}] user_id={user_id}")
    return task_service.resolve_task_blocker(session, project_id, task_id, bid, payload, user_id)


@router.post("/projects/{project_id}/stages/{stage_id}/blockers", status_code=201)
def mark_stage_blocked_endpoint(project_id: int, stage_id: int, payload: StageBlockerCreate, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/stages/{stage_id}/blockers] user_id={user_id} handler_id={payload.handler_id}")
    return task_service.mark_stage_blocked(session, project_id, stage_id, payload, user_id)


@router.get("/projects/{project_id}/stages/{stage_id}/blockers")
def list_stage_blockers_endpoint(project_id: int, stage_id: int, _user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint GET /api/projects/{project_id}/stages/{stage_id}/blockers] user_id={_user_id}")
    return task_service.list_stage_blockers(session, project_id, stage_id)


@router.patch("/projects/{project_id}/stages/{stage_id}/blockers/{bid}")
def resolve_stage_blocker_endpoint(project_id: int, stage_id: int, bid: int, payload: StageBlockerResolve, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint PATCH /api/projects/{project_id}/stages/{stage_id}/blockers/{bid}] user_id={user_id}")
    return task_service.resolve_stage_blocker(session, project_id, stage_id, bid, payload, user_id)


@router.post("/projects/{project_id}/tasks/{task_id}/confirm-blocker")
def confirm_task_blocker_endpoint(project_id: int, task_id: int, payload: ConfirmBlockerRequest, user_id: str = Depends(require_project_member), session: Session = Depends(get_db)):
    logger.info(f"[endpoint POST /api/projects/{project_id}/tasks/{task_id}/confirm-blocker] user_id={user_id} action={payload.action}")
    return task_service.confirm_task_blocker(session, project_id, task_id, payload.action, payload, user_id)
