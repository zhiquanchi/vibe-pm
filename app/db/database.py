from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta

from app.core.config import database_path


SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, avatar_url TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_members (project_id INTEGER NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')), PRIMARY KEY(project_id,user_id), FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES profiles(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS sprints (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, goal TEXT, start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planning', initial_points REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, sprint_id INTEGER, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'todo', story_points REAL NOT NULL DEFAULT 1, priority TEXT NOT NULL DEFAULT 'P2', assignee TEXT, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scope_changes (id INTEGER PRIMARY KEY, sprint_id INTEGER NOT NULL, task_id INTEGER, type TEXT NOT NULL, description TEXT NOT NULL, points_delta REAL NOT NULL, reason TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sprint_snapshots (id INTEGER PRIMARY KEY, sprint_id INTEGER NOT NULL, snapshot_date TEXT NOT NULL, total_scope REAL NOT NULL, completed_points REAL NOT NULL, remaining_points REAL NOT NULL, UNIQUE(sprint_id, snapshot_date));
CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_scope_changes_sprint ON scope_changes(sprint_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_sprint ON sprint_snapshots(sprint_id, snapshot_date);
"""


def get_connection() -> sqlite3.Connection:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _seed_demo(conn: sqlite3.Connection) -> None:
    now = datetime.utcnow().isoformat()
    conn.execute("INSERT OR IGNORE INTO profiles(id,name,email,created_at) VALUES(?,?,?,?)", ("demo-user", "演示用户", "demo@example.com", now))
    existing_project = conn.execute("SELECT id FROM projects ORDER BY id LIMIT 1").fetchone()
    if existing_project:
        conn.execute("INSERT OR IGNORE INTO project_members(project_id,user_id,role) VALUES(?,?,?)", (existing_project[0], "demo-user", "owner"))
        return
    conn.execute("INSERT INTO projects(name,description,created_at) VALUES(?,?,?)", ("Vibe PM", "Scope-aware project delivery", now))
    project_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.execute("INSERT OR IGNORE INTO project_members(project_id,user_id,role) VALUES(?,?,?)", (project_id, "demo-user", "owner"))
    start = date.today() - timedelta(days=7)
    end = start + timedelta(days=13)
    conn.execute(
        "INSERT INTO sprints(project_id,name,goal,start_date,end_date,status,initial_points,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (project_id, "Sprint 14", "Build the payment flow", start.isoformat(), end.isoformat(), "active", 16, now),
    )
    sprint_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    tasks = [
        ("Payment infrastructure", "done", 3, "P0", "SM"),
        ("WeChat Pay channel", "in_progress", 5, "P0", "AL"),
        ("Refund status sync", "in_review", 3, "P1", "JK"),
        ("Checkout result page", "todo", 2, "P2", "SM"),
        ("Reconciliation report", "todo", 3, "P2", "AL"),
        ("Order alerts", "todo", 2, "P1", "JK"),
        ("Conversion funnel", "done", 2, "P3", "SM"),
    ]
    for position, (title, status, points, priority, assignee) in enumerate(tasks):
        conn.execute(
            "INSERT INTO tasks(project_id,sprint_id,title,status,story_points,priority,assignee,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (project_id, sprint_id, title, status, points, priority, assignee, position, now, now),
        )
    changes = [
        ("change_points", "Sprint started", 16, "Initial scope", start.isoformat() + "T09:00:00"),
        ("add_task", "Added WeChat Pay channel", 5, "CEO request", (start + timedelta(days=2)).isoformat() + "T09:15:00"),
        ("remove_task", "Removed reconciliation report", -3, "Priority lowered", (start + timedelta(days=4)).isoformat() + "T14:30:00"),
    ]
    for change_type, description, delta, reason, created_at in changes:
        conn.execute(
            "INSERT INTO scope_changes(sprint_id,type,description,points_delta,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
            (sprint_id, change_type, description, delta, reason, "demo", created_at),
        )


def init_db(seed: bool = True) -> None:
    conn = get_connection()
    try:
        conn.executescript(SCHEMA)
        if seed:
            _seed_demo(conn)
        conn.commit()
    finally:
        conn.close()


def snapshot(conn: sqlite3.Connection, sprint_id: int) -> None:
    total = conn.execute("SELECT COALESCE(SUM(story_points),0) FROM tasks WHERE sprint_id=?", (sprint_id,)).fetchone()[0]
    progress = {"done": 1, "in_review": 0.8, "in_progress": 0.5, "todo": 0}
    completed = sum(row[0] * progress[row[1]] for row in conn.execute("SELECT story_points,status FROM tasks WHERE sprint_id=?", (sprint_id,)))
    today = date.today().isoformat()
    conn.execute(
        "INSERT INTO sprint_snapshots(sprint_id,snapshot_date,total_scope,completed_points,remaining_points) VALUES(?,?,?,?,?) ON CONFLICT(sprint_id,snapshot_date) DO UPDATE SET total_scope=excluded.total_scope,completed_points=excluded.completed_points,remaining_points=excluded.remaining_points",
        (sprint_id, today, total, completed, total - completed),
    )
