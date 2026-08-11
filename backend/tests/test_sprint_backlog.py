from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db.database import get_session, init_db
from app.db.models import Project, Task
from app.routers.sprint_backlog import router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "sprint.sqlite"))
    init_db(seed=False)
    session = get_session()
    session.add(Project(id=1, name="Demo", created_at="now"))
    session.add(Task(project_id=1, title="Done task", status="done", story_points=3, created_at="now", updated_at="now"))
    session.add(Task(project_id=1, title="Todo task", status="todo", story_points=5, created_at="now", updated_at="now"))
    session.add(Task(project_id=1, title="Backlog task", status="todo", story_points=2, created_at="now", updated_at="now"))
    session.commit()
    session.close()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def dates():
    start = date.today()
    return {"start_date": start.isoformat(), "end_date": (start + timedelta(days=13)).isoformat()}


def test_create_start_and_complete_returns_unfinished_to_backlog(client):
    response = client.post("/api/sprints", json={"name": "Sprint 1", **dates()})
    assert response.status_code == 201
    sprint_id = response.json()["id"]

    # Put two tasks in the sprint, then start it. Initial points and first snapshot are captured at start.
    assert client.post(f"/api/sprints/{sprint_id}/tasks/1").status_code == 200
    assert client.post(f"/api/sprints/{sprint_id}/tasks/2").status_code == 200
    started = client.patch(f"/api/sprints/{sprint_id}", json={"status": "active"})
    assert started.status_code == 200
    assert started.json()["sprint"]["initial_points"] == 8
    assert len(client.get(f"/api/sprints/{sprint_id}").json()["tasks"]) == 2
    assert len(client.get(f"/api/sprints/{sprint_id}/snapshots").json()) == 1

    completed = client.patch(f"/api/sprints/{sprint_id}", json={"status": "completed"})
    assert completed.status_code == 200
    assert completed.json()["stats"]["total_points"] == 8
    assert completed.json()["stats"]["completed_points"] == 3
    backlog = client.get("/api/backlog").json()
    assert {task["title"] for task in backlog} >= {"Todo task", "Backlog task"}


def test_only_one_active_sprint_per_project_and_invalid_transition(client):
    first = client.post("/api/sprints", json={"name": "One", **dates()}).json()["id"]
    second = client.post("/api/sprints", json={"name": "Two", **dates()}).json()["id"]
    assert client.patch(f"/api/sprints/{first}", json={"status": "active"}).status_code == 200
    assert client.patch(f"/api/sprints/{second}", json={"status": "active"}).status_code == 409
    assert client.patch(f"/api/sprints/{first}", json={"status": "planning"}).status_code == 409


def test_dates_are_validated_and_task_can_leave_sprint(client):
    invalid = client.post("/api/sprints", json={"name": "Bad", "start_date": "2026-02-10", "end_date": "2026-02-01"})
    assert invalid.status_code == 422
    sprint_id = client.post("/api/sprints", json={"name": "Move", **dates()}).json()["id"]
    assert client.post(f"/api/sprints/{sprint_id}/tasks/3").status_code == 200
    assert client.delete(f"/api/sprints/{sprint_id}/tasks/3").status_code == 200
    assert any(task["id"] == 3 for task in client.get("/api/backlog").json())
