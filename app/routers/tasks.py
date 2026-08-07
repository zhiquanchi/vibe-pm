from __future__ import annotations

from fastapi import APIRouter, Query

from app.db.database import get_connection
from app.domains.tasks import create_task, delete_task, list_tasks, update_task
from app.schemas.task import TaskCreateRequest, TaskUpdateRequest


router = APIRouter(prefix="/api", tags=["tasks"])


@router.get("/tasks")
def get_tasks(sprint_id: int | None = Query(default=None)):
    conn = get_connection()
    try:
        return list_tasks(conn, sprint_id)
    finally:
        conn.close()


@router.post("/tasks", status_code=201)
def post_task(payload: TaskCreateRequest):
    conn = get_connection()
    try:
        return create_task(conn, payload.model_dump())
    finally:
        conn.close()


@router.patch("/tasks/{task_id}")
def patch_task(task_id: int, payload: TaskUpdateRequest):
    conn = get_connection()
    try:
        return update_task(conn, task_id, payload.model_dump(exclude_unset=True))
    finally:
        conn.close()


@router.delete("/tasks/{task_id}")
def remove_task(task_id: int, reason: str | None = Query(default=None), created_by: str = Query(default="current-user")):
    conn = get_connection()
    try:
        delete_task(conn, task_id, reason, created_by)
        return {"deleted": True}
    finally:
        conn.close()
