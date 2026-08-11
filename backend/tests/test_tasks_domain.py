from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.database import get_session, init_db
from app.db.models import Project, ScopeChange, Sprint
from app.routers.tasks import router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "tasks.db"))
    init_db(seed=False)
    session = get_session()
    session.add(Project(id=1, name="测试项目", created_at="now"))
    session.add(Sprint(id=1, project_id=1, name="进行中", start_date="2026-01-01", end_date="2026-01-14", status="active", created_at="now"))
    session.add(Sprint(id=2, project_id=1, name="规划中", start_date="2026-02-01", end_date="2026-02-14", status="planning", created_at="now"))
    session.commit()
    session.close()
    api = FastAPI()
    api.include_router(router)
    return TestClient(api)


def test_story_points_are_restricted_and_done_sets_completed_at(client):
    response = client.post("/api/tasks", json={"title": "非法点数", "story_points": 4})
    assert response.status_code == 422

    response = client.post("/api/tasks", json={"title": "上线", "story_points": 3, "sprint_id": 1, "status": "done"})
    assert response.status_code == 201
    task = response.json()
    assert task["completed_at"]
    assert task["position"] == 0


def test_active_sprint_scope_changes_are_logged_and_positions_are_ordered(client):
    first = client.post("/api/tasks", json={"title": "第一项", "story_points": 5, "sprint_id": 1}).json()
    second = client.post("/api/tasks", json={"title": "第二项", "story_points": 2, "sprint_id": 1}).json()
    assert (first["position"], second["position"]) == (0, 1)

    updated = client.patch(f"/api/tasks/{first['id']}", json={"story_points": 8, "reason": "需求扩大"}).json()
    assert updated["story_points"] == 8
    moved = client.patch(f"/api/tasks/{first['id']}", json={"sprint_id": None, "reason": "延期"})
    assert moved.status_code == 200

    session = get_session()
    changes = session.execute(
        select(ScopeChange.type, ScopeChange.points_delta, ScopeChange.reason).where(ScopeChange.sprint_id == 1).order_by(ScopeChange.id)
    ).all()
    session.close()
    assert [(row[0], row[1], row[2]) for row in changes] == [
        ("add_task", 5.0, None),
        ("add_task", 2.0, None),
        ("change_points", 3.0, "需求扩大"),
        ("remove_task", -8.0, "延期"),
    ]


def test_status_flow_and_delete_from_active_sprint_is_logged(client):
    task = client.post("/api/tasks", json={"title": "流转", "story_points": 1, "sprint_id": 1}).json()
    for status in ("in_progress", "in_review", "done"):
        response = client.patch(f"/api/tasks/{task['id']}", json={"status": status})
        assert response.status_code == 200
    assert client.delete(f"/api/tasks/{task['id']}?reason=取消").json() == {"deleted": True}
    session = get_session()
    last = session.execute(
        select(ScopeChange.type, ScopeChange.points_delta, ScopeChange.reason).where(ScopeChange.task_id == task["id"]).order_by(ScopeChange.id.desc()).limit(1)
    ).first()
    session.close()
    assert tuple(last) == ("remove_task", -1.0, "取消")
