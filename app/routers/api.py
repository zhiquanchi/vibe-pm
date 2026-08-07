from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.db.database import get_connection, snapshot
from app.schemas import ScopeChangeCreate, SprintCreate, TaskCreate, TaskUpdate
from app.services.common import rowdict

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/sprints")
def sprints():
    conn = get_connection()
    try:
        return [rowdict(row) for row in conn.execute("SELECT * FROM sprints ORDER BY start_date DESC")]
    finally:
        conn.close()


@router.post("/sprints")
def create_sprint(payload: SprintCreate):
    conn = get_connection()
    try:
        now = datetime.utcnow().isoformat()
        cursor = conn.execute(
            "INSERT INTO sprints(project_id,name,goal,start_date,end_date,created_at) VALUES(?,?,?,?,?,?)",
            (1, payload.name, payload.goal, payload.start_date.isoformat(), payload.end_date.isoformat(), now),
        )
        conn.commit()
        return rowdict(conn.execute("SELECT * FROM sprints WHERE id=?", (cursor.lastrowid,)).fetchone())
    finally:
        conn.close()


@router.get("/sprints/{sprint_id}")
def sprint(sprint_id: int):
    conn = get_connection()
    try:
        sprint_row = conn.execute("SELECT * FROM sprints WHERE id=?", (sprint_id,)).fetchone()
        if not sprint_row:
            raise HTTPException(404, "Sprint not found")
        tasks = conn.execute("SELECT * FROM tasks WHERE sprint_id=? ORDER BY position,id", (sprint_id,))
        changes = conn.execute("SELECT * FROM scope_changes WHERE sprint_id=? ORDER BY created_at DESC", (sprint_id,))
        return {"sprint": rowdict(sprint_row), "tasks": [rowdict(row) for row in tasks], "scope_changes": [rowdict(row) for row in changes]}
    finally:
        conn.close()


@router.get("/tasks")
def tasks(sprint_id: int | None = None):
    conn = get_connection()
    try:
        if sprint_id is None:
            rows = conn.execute("SELECT * FROM tasks ORDER BY position,id")
        else:
            rows = conn.execute("SELECT * FROM tasks WHERE sprint_id=? ORDER BY position,id", (sprint_id,))
        return [rowdict(row) for row in rows]
    finally:
        conn.close()


@router.post("/tasks")
def create_task(payload: TaskCreate):
    conn = get_connection()
    try:
        now = datetime.utcnow().isoformat()
        cursor = conn.execute(
            "INSERT INTO tasks(project_id,sprint_id,title,description,status,story_points,priority,assignee,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (payload.project_id, payload.sprint_id, payload.title, payload.description, payload.status, payload.story_points, payload.priority, payload.assignee, now, now),
        )
        if payload.sprint_id:
            snapshot(conn, payload.sprint_id)
        conn.commit()
        return rowdict(conn.execute("SELECT * FROM tasks WHERE id=?", (cursor.lastrowid,)).fetchone())
    finally:
        conn.close()


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, payload: TaskUpdate):
    conn = get_connection()
    try:
        task = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not task:
            raise HTTPException(404, "Task not found")
        data = payload.model_dump(exclude_none=True)
        fields = [f"{key}=?" for key in data]
        values = list(data.values())
        if fields:
            values.extend([datetime.utcnow().isoformat(), task_id])
            conn.execute(f"UPDATE tasks SET {','.join(fields)},updated_at=? WHERE id=?", values)
        if "story_points" in data and data["story_points"] != task["story_points"] and task["sprint_id"]:
            conn.execute(
                "INSERT INTO scope_changes(sprint_id,task_id,type,description,points_delta,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
                (task["sprint_id"], task_id, "change_points", f"Changed points for {task['title']}", data["story_points"] - task["story_points"], "current-user", datetime.utcnow().isoformat()),
            )
        if task["sprint_id"]:
            snapshot(conn, task["sprint_id"])
        conn.commit()
        return rowdict(conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())
    finally:
        conn.close()


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int):
    conn = get_connection()
    try:
        task = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not task:
            raise HTTPException(404, "Task not found")
        conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
        conn.commit()
        return {"deleted": True}
    finally:
        conn.close()


@router.get("/sprints/{sprint_id}/scope-changes")
def scope_changes(sprint_id: int):
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM scope_changes WHERE sprint_id=? ORDER BY created_at DESC", (sprint_id,))
        return [rowdict(row) for row in rows]
    finally:
        conn.close()


@router.post("/sprints/{sprint_id}/scope-changes")
def create_scope_change(sprint_id: int, payload: ScopeChangeCreate):
    conn = get_connection()
    try:
        if not conn.execute("SELECT 1 FROM sprints WHERE id=?", (sprint_id,)).fetchone():
            raise HTTPException(404, "Sprint not found")
        now = datetime.utcnow().isoformat()
        cursor = conn.execute(
            "INSERT INTO scope_changes(sprint_id,task_id,type,description,points_delta,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (sprint_id, payload.task_id, payload.type, payload.description, payload.points_delta, payload.reason, payload.created_by, now),
        )
        snapshot(conn, sprint_id)
        conn.commit()
        return rowdict(conn.execute("SELECT * FROM scope_changes WHERE id=?", (cursor.lastrowid,)).fetchone())
    finally:
        conn.close()


@router.get("/sprints/{sprint_id}/snapshots")
def snapshots(sprint_id: int):
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM sprint_snapshots WHERE sprint_id=? ORDER BY snapshot_date", (sprint_id,))
        return [rowdict(row) for row in rows]
    finally:
        conn.close()
