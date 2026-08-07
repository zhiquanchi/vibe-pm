from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from fastapi import HTTPException

from app.db.database import snapshot
from app.services.common import rowdict


def _now() -> str:
    return datetime.utcnow().isoformat()


def _active_sprint(conn: sqlite3.Connection, sprint_id: int | None) -> bool:
    return bool(sprint_id and conn.execute("SELECT 1 FROM sprints WHERE id=? AND status='active'", (sprint_id,)).fetchone())


def _require_sprint(conn: sqlite3.Connection, sprint_id: int | None) -> None:
    if sprint_id is not None and not conn.execute("SELECT 1 FROM sprints WHERE id=?", (sprint_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Sprint not found")


def _require_writable_sprint(conn: sqlite3.Connection, sprint_id: int | None) -> None:
    if sprint_id is not None and conn.execute("SELECT 1 FROM sprints WHERE id=? AND status<>'completed'", (sprint_id,)).fetchone() is None:
        raise HTTPException(status_code=409, detail="已完成 Sprint 为只读状态")


def _next_position(conn: sqlite3.Connection, sprint_id: int | None) -> int:
    row = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM tasks WHERE sprint_id IS ?", (sprint_id,)).fetchone()
    return int(row[0])


def _scope_change(
    conn: sqlite3.Connection,
    *,
    sprint_id: int,
    task_id: int | None,
    change_type: str,
    description: str,
    points_delta: float,
    reason: str | None,
    created_by: str,
) -> None:
    conn.execute(
        "INSERT INTO scope_changes(sprint_id,task_id,type,description,points_delta,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (sprint_id, task_id, change_type, description, points_delta, reason, created_by, _now()),
    )


def list_tasks(conn: sqlite3.Connection, sprint_id: int | None = None) -> list[dict[str, Any]]:
    if sprint_id is None:
        rows = conn.execute("SELECT * FROM tasks ORDER BY position,id")
    else:
        rows = conn.execute("SELECT * FROM tasks WHERE sprint_id=? ORDER BY position,id", (sprint_id,))
    return [rowdict(row) for row in rows]


def create_task(conn: sqlite3.Connection, data: dict[str, Any]) -> dict[str, Any]:
    sprint_id = data["sprint_id"]
    _require_sprint(conn, sprint_id)
    _require_writable_sprint(conn, sprint_id)
    position = data["position"] if data["position"] is not None else _next_position(conn, sprint_id)
    now = _now()
    completed_at = now if data["status"] == "done" else None
    cursor = conn.execute(
        "INSERT INTO tasks(project_id,sprint_id,title,description,status,story_points,priority,assignee,position,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (data["project_id"], sprint_id, data["title"], data["description"], data["status"], data["story_points"], data["priority"], data["assignee"], position, now, now, completed_at),
    )
    task_id = cursor.lastrowid
    if _active_sprint(conn, sprint_id):
        _scope_change(conn, sprint_id=sprint_id, task_id=task_id, change_type="add_task", description=f"Added {data['title']}", points_delta=data["story_points"], reason=data["reason"], created_by=data["created_by"])
        snapshot(conn, sprint_id)
    conn.commit()
    return rowdict(conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())


def update_task(conn: sqlite3.Connection, task_id: int, data: dict[str, Any]) -> dict[str, Any]:
    task = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    reason = data.pop("reason", None)
    created_by = data.pop("created_by", "current-user")
    # ``sprint_id=None`` explicitly moves a task back to the backlog; preserve it.
    data = {key: value for key, value in data.items() if value is not None or key == "sprint_id"}
    old_sprint = task["sprint_id"]
    new_sprint = data.get("sprint_id", old_sprint)
    _require_sprint(conn, new_sprint)
    _require_writable_sprint(conn, old_sprint)
    _require_writable_sprint(conn, new_sprint)
    now = _now()
    if "status" in data:
        data["completed_at"] = now if data["status"] == "done" else None
    if data:
        fields = [f"{key}=?" for key in data]
        conn.execute(f"UPDATE tasks SET {','.join(fields)},updated_at=? WHERE id=?", [*data.values(), now, task_id])

    old_active = _active_sprint(conn, old_sprint)
    new_active = _active_sprint(conn, new_sprint)
    old_points = float(task["story_points"])
    new_points = float(data.get("story_points", old_points))
    if old_active and new_sprint != old_sprint:
        _scope_change(conn, sprint_id=old_sprint, task_id=task_id, change_type="remove_task", description=f"Removed {task['title']}", points_delta=-old_points, reason=reason, created_by=created_by)
        snapshot(conn, old_sprint)
    if new_active and new_sprint != old_sprint:
        _scope_change(conn, sprint_id=new_sprint, task_id=task_id, change_type="add_task", description=f"Added {task['title']}", points_delta=new_points, reason=reason, created_by=created_by)
        snapshot(conn, new_sprint)
    elif old_active and "story_points" in data and new_points != old_points:
        _scope_change(conn, sprint_id=old_sprint, task_id=task_id, change_type="change_points", description=f"Changed points for {task['title']}", points_delta=new_points - old_points, reason=reason, created_by=created_by)
        snapshot(conn, old_sprint)
    conn.commit()
    return rowdict(conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())


def delete_task(conn: sqlite3.Connection, task_id: int, reason: str | None = None, created_by: str = "current-user") -> None:
    task = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    _require_writable_sprint(conn, task["sprint_id"])
    if _active_sprint(conn, task["sprint_id"]):
        _scope_change(conn, sprint_id=task["sprint_id"], task_id=task_id, change_type="remove_task", description=f"Deleted {task['title']}", points_delta=-float(task["story_points"]), reason=reason, created_by=created_by)
        snapshot(conn, task["sprint_id"])
    conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    conn.commit()
