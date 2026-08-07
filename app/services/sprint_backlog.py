from __future__ import annotations

import sqlite3
from datetime import date, datetime

from fastapi import HTTPException

from app.db.database import snapshot
from app.services.common import rowdict


ALLOWED_TRANSITIONS = {"planning": {"planning", "active"}, "active": {"active", "completed"}, "completed": {"completed"}}


def _sprint(conn: sqlite3.Connection, sprint_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM sprints WHERE id=?", (sprint_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return row


def _project_exists(conn: sqlite3.Connection, project_id: int) -> bool:
    return conn.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone() is not None


def create_sprint(conn: sqlite3.Connection, payload) -> dict:
    if not _project_exists(conn, payload.project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    now = datetime.utcnow().isoformat()
    cursor = conn.execute(
        "INSERT INTO sprints(project_id,name,goal,start_date,end_date,status,initial_points,created_at) VALUES(?,?,?,?,?,?,0,?)",
        (payload.project_id, payload.name, payload.goal, payload.start_date.isoformat(), payload.end_date.isoformat(), "planning", now),
    )
    conn.commit()
    return rowdict(_sprint(conn, cursor.lastrowid))


def list_sprints(conn: sqlite3.Connection, project_id: int | None = None) -> list[dict]:
    if project_id is None:
        rows = conn.execute("SELECT * FROM sprints ORDER BY start_date DESC,id DESC")
    else:
        rows = conn.execute("SELECT * FROM sprints WHERE project_id=? ORDER BY start_date DESC,id DESC", (project_id,))
    return [rowdict(row) for row in rows]


def sprint_detail(conn: sqlite3.Connection, sprint_id: int) -> dict:
    sprint = _sprint(conn, sprint_id)
    tasks = conn.execute("SELECT * FROM tasks WHERE sprint_id=? ORDER BY position,id", (sprint_id,))
    return {"sprint": rowdict(sprint), "tasks": [rowdict(row) for row in tasks]}


def _stats(conn: sqlite3.Connection, sprint_id: int) -> dict:
    rows = conn.execute("SELECT status,story_points FROM tasks WHERE sprint_id=?", (sprint_id,))
    total = completed = 0.0
    count = completed_count = 0
    for row in rows:
        points = float(row["story_points"])
        total += points
        count += 1
        if row["status"] == "done":
            completed += points
            completed_count += 1
    return {"total_points": total, "completed_points": completed, "remaining_points": total - completed, "completion_rate": (completed / total if total else 0), "task_count": count, "completed_task_count": completed_count}


def update_status(conn: sqlite3.Connection, sprint_id: int, target: str) -> dict:
    sprint = _sprint(conn, sprint_id)
    current = sprint["status"]
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        raise HTTPException(status_code=409, detail=f"Invalid sprint transition: {current} -> {target}")
    if target == current:
        return {"sprint": rowdict(sprint), "stats": _stats(conn, sprint_id) if target == "completed" else None}

    if target == "active":
        active = conn.execute("SELECT id FROM sprints WHERE project_id=? AND status='active' AND id<>? LIMIT 1", (sprint["project_id"], sprint_id)).fetchone()
        if active:
            raise HTTPException(status_code=409, detail="Project already has an active sprint")
        points = conn.execute("SELECT COALESCE(SUM(story_points),0) FROM tasks WHERE sprint_id=?", (sprint_id,)).fetchone()[0]
        conn.execute("UPDATE sprints SET status='active',initial_points=? WHERE id=?", (points, sprint_id))
        snapshot(conn, sprint_id)
        conn.commit()
        return {"sprint": rowdict(_sprint(conn, sprint_id)), "stats": None}

    # Completing a sprint is one transaction: calculate first, then return unfinished work to backlog.
    stats = _stats(conn, sprint_id)
    conn.execute("UPDATE tasks SET sprint_id=NULL,updated_at=? WHERE sprint_id=? AND status<>'done'", (datetime.utcnow().isoformat(), sprint_id))
    conn.execute("UPDATE sprints SET status='completed' WHERE id=?", (sprint_id,))
    conn.commit()
    return {"sprint": rowdict(_sprint(conn, sprint_id)), "stats": stats}


def list_backlog(conn: sqlite3.Connection, project_id: int) -> list[dict]:
    if not _project_exists(conn, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    rows = conn.execute("SELECT * FROM tasks WHERE project_id=? AND sprint_id IS NULL ORDER BY position,id", (project_id,))
    return [rowdict(row) for row in rows]


def move_task(conn: sqlite3.Connection, sprint_id: int, task_id: int, into: bool, reason: str | None = None) -> dict:
    sprint = _sprint(conn, sprint_id)
    task = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["project_id"] != sprint["project_id"]:
        raise HTTPException(status_code=422, detail="Task and sprint belong to different projects")
    if into:
        if task["sprint_id"] is not None:
            raise HTTPException(status_code=409, detail="Task is already in a sprint")
        conn.execute("UPDATE tasks SET sprint_id=?,updated_at=? WHERE id=?", (sprint_id, datetime.utcnow().isoformat(), task_id))
        delta, kind = task["story_points"], "add_task"
        description = f"Added task: {task['title']}"
    else:
        if task["sprint_id"] != sprint_id:
            raise HTTPException(status_code=409, detail="Task is not in this sprint")
        conn.execute("UPDATE tasks SET sprint_id=NULL,updated_at=? WHERE id=?", (datetime.utcnow().isoformat(), task_id))
        delta, kind = -task["story_points"], "remove_task"
        description = f"Removed task: {task['title']}"
    if sprint["status"] == "active":
        conn.execute("INSERT INTO scope_changes(sprint_id,task_id,type,description,points_delta,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)", (sprint_id, task_id, kind, description, delta, reason, "current-user", datetime.utcnow().isoformat()))
        snapshot(conn, sprint_id)
    conn.commit()
    return rowdict(conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())
