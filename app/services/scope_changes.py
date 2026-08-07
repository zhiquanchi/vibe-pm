from __future__ import annotations

import sqlite3
from datetime import date, datetime

from fastapi import HTTPException

from app.db.database import snapshot
from app.services.common import rowdict


def _now() -> str:
    return datetime.utcnow().isoformat()


def _sprint(conn: sqlite3.Connection, sprint_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM sprints WHERE id=?", (sprint_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return row


def _capacity_warning(conn: sqlite3.Connection, sprint_id: int) -> str | None:
    sprint = _sprint(conn, sprint_id)
    initial = float(sprint["initial_points"] or 0)
    total = float(conn.execute("SELECT COALESCE(SUM(story_points),0) FROM tasks WHERE sprint_id=?", (sprint_id,)).fetchone()[0])
    if initial > 0 and total > initial * 1.2:
        return f"范围已增加 {total - initial:g} pt，当前容量可能不足"
    return None


def apply_scope_change(conn: sqlite3.Connection, sprint_id: int, command) -> dict:
    """Apply one scope command atomically, including its log and today's snapshot."""
    sprint = _sprint(conn, sprint_id)
    savepoint = "scope_change_tx"
    try:
        conn.execute(f"SAVEPOINT {savepoint}")
        now = _now()
        task_id = command.task_id
        if command.type == "add_task":
            points = command.story_points or 1
            position = conn.execute("SELECT COALESCE(MAX(position),-1)+1 FROM tasks WHERE sprint_id=?", (sprint_id,)).fetchone()[0]
            cursor = conn.execute(
                "INSERT INTO tasks(project_id,sprint_id,title,description,status,story_points,priority,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (sprint["project_id"], sprint_id, command.title, command.description, "todo", points, "P2", position, now, now),
            )
            task_id = cursor.lastrowid
            delta = float(points)
            description = command.description or f"新增「{command.title}」"
        else:
            task = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            if not task:
                raise HTTPException(status_code=404, detail="Task not found")
            if task["sprint_id"] != sprint_id:
                raise HTTPException(status_code=409, detail="Task is not in this sprint")
            if command.type == "remove_task":
                delta = -float(task["story_points"])
                description = command.description or f"移出「{task['title']}」"
                conn.execute("UPDATE tasks SET sprint_id=NULL,updated_at=? WHERE id=?", (now, task_id))
            else:
                old = float(task["story_points"])
                new = float(command.story_points) if command.story_points is not None else old + float(command.points_delta or 0)
                if new < 1:
                    raise HTTPException(status_code=422, detail="Story points must be at least 1")
                delta = new - old
                description = command.description or f"修改「{task['title']}」点数"
                conn.execute("UPDATE tasks SET story_points=?,updated_at=? WHERE id=?", (new, now, task_id))

        cursor = conn.execute(
            "INSERT INTO scope_changes(sprint_id,task_id,type,description,points_delta,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (sprint_id, task_id, command.type, description, delta, command.reason, command.created_by, now),
        )
        change_id = cursor.lastrowid
        snapshot(conn, sprint_id, date.today(), change_id)
        snapshot_row = conn.execute("SELECT * FROM sprint_snapshots WHERE sprint_id=? AND snapshot_date=?", (sprint_id, date.today().isoformat())).fetchone()
        result = {
            "task": rowdict(conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()) if task_id else None,
            "scope_change": rowdict(conn.execute("SELECT * FROM scope_changes WHERE id=?", (change_id,)).fetchone()),
            "snapshot": rowdict(snapshot_row),
            "capacity_warning": _capacity_warning(conn, sprint_id),
        }
        conn.execute(f"RELEASE SAVEPOINT {savepoint}")
        conn.commit()
        return result
    except Exception:
        conn.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
        conn.execute(f"RELEASE SAVEPOINT {savepoint}")
        conn.rollback()
        raise


def generate_snapshot(conn: sqlite3.Connection, sprint_id: int, snapshot_date: date | None = None) -> dict:
    _sprint(conn, sprint_id)
    # Upsert is intentionally idempotent for the requested date.
    snapshot(conn, sprint_id, snapshot_date or date.today())
    conn.commit()
    return rowdict(conn.execute("SELECT * FROM sprint_snapshots WHERE sprint_id=? AND snapshot_date=?", (sprint_id, (snapshot_date or date.today()).isoformat())).fetchone())


def list_scope_changes(conn: sqlite3.Connection, sprint_id: int) -> list[dict]:
    _sprint(conn, sprint_id)
    return [rowdict(row) for row in conn.execute("SELECT * FROM scope_changes WHERE sprint_id=? ORDER BY created_at DESC,id DESC", (sprint_id,))]
