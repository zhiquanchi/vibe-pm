from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.database import get_session, init_db
from app.db.models import ProjectActivity, Task
from app.routers.projects import router as projects_router
from app.routers.stages import router as stages_router
from app.routers.tasks import router as tasks_router

OWNER = {"X-User-Id": "task-owner"}
MEMBER = {"X-User-Id": "task-member"}
OBSERVER = {"X-User-Id": "task-observer"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "tasks.db"))
    init_db(seed=False)
    api = FastAPI()
    api.include_router(projects_router)
    api.include_router(stages_router)
    api.include_router(tasks_router)
    return TestClient(api)


def create_project(client, stages=None, headers=OWNER):
    payload = {"name": "任务测试项目"}
    if stages is not None:
        payload["stages"] = stages
    response = client.post("/api/projects", json=payload, headers=headers)
    assert response.status_code == 200
    return response.json()["id"]


def list_stages(client, project_id, headers=OWNER):
    response = client.get(f"/api/projects/{project_id}/stages", headers=headers)
    assert response.status_code == 200
    return response.json()


def create_task(client, project_id, stage_id, title="新任务", headers=OWNER, **overrides):
    payload = {"title": title, "stage_id": stage_id, "project_id": project_id}
    payload.update(overrides)
    return client.post(f"/api/projects/{project_id}/stages/{stage_id}/tasks", json=payload, headers=headers)


def activity_types(project_id):
    session = get_session()
    rows = session.scalars(select(ProjectActivity.type).where(ProjectActivity.project_id == project_id).order_by(ProjectActivity.id)).all()
    session.close()
    return rows


def _seed_roles(client, project_id):
    client.post(
        f"/api/projects/{project_id}/members",
        json={"user_id": "task-member", "name": "成员", "email": "m@test.local", "role": "member"},
        headers=OWNER,
    )
    client.post(
        f"/api/projects/{project_id}/members",
        json={"user_id": "task-observer", "name": "观察", "email": "o@test.local", "role": "observer"},
        headers=OWNER,
    )


def _start_and_complete(client, project_id, stage_id, successor_id=None):
    assert client.post(f"/api/projects/{project_id}/stages/{stage_id}/start", json={}, headers=OWNER).status_code == 200
    body = {"successor_stage_id": successor_id} if successor_id else {}
    assert client.post(f"/api/projects/{project_id}/stages/{stage_id}/complete", json=body, headers=OWNER).status_code == 200


# --- 4.1 创建 / 编辑 / 推进任务 (spec 1.x / 3.x) ---


def test_create_task_success(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    resp = create_task(client, project_id, stage_id, title="实现登录", assignee="task-owner", priority="urgent")
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "实现登录"
    assert body["status"] == "todo"
    assert body["priority"] == "urgent"
    assert "task_created" in activity_types(project_id)

    listed = client.get(f"/api/projects/{project_id}/stages/{stage_id}/tasks", headers=OWNER).json()
    assert len(listed) == 1
    assert listed[0]["id"] == body["id"]


def test_create_task_empty_title_rejected(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    resp = create_task(client, project_id, stage_id, title="")
    assert resp.status_code == 422


def test_edit_task_fields(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    task_id = create_task(client, project_id, stage_id).json()["id"]

    resp = client.patch(
        f"/api/projects/{project_id}/tasks/{task_id}",
        json={"title": "改名", "assignee": "task-owner", "priority": "low", "planned_date": "2026-09-01"},
        headers=OWNER,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "改名"
    assert body["priority"] == "low"
    assert body["planned_date"] == "2026-09-01"
    assert "task_updated" in activity_types(project_id)


def test_legal_status_transition(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    task_id = create_task(client, project_id, stage_id).json()["id"]

    r1 = client.patch(f"/api/projects/{project_id}/tasks/{task_id}", json={"status": "in_progress"}, headers=OWNER)
    assert r1.status_code == 200
    assert r1.json()["status"] == "in_progress"

    r2 = client.patch(f"/api/projects/{project_id}/tasks/{task_id}", json={"status": "done"}, headers=OWNER)
    assert r2.status_code == 200
    assert r2.json()["status"] == "done"
    assert "task_status_changed" in activity_types(project_id)


def test_illegal_status_transition_rejected(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    task_id = create_task(client, project_id, stage_id).json()["id"]

    resp = client.patch(f"/api/projects/{project_id}/tasks/{task_id}", json={"status": "blocked"}, headers=OWNER)
    assert resp.status_code == 422
    assert "未开始只能转为进行中" in resp.json()["detail"]


def test_observer_cannot_write(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    _seed_roles(client, project_id)
    stage_id = list_stages(client, project_id)[0]["id"]

    assert create_task(client, project_id, stage_id, headers=OBSERVER).status_code == 403
    task_id = create_task(client, project_id, stage_id).json()["id"]
    assert client.patch(f"/api/projects/{project_id}/tasks/{task_id}", json={"title": "x"}, headers=OBSERVER).status_code == 403


def test_completed_stage_task_readonly(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    stages = list_stages(client, project_id)
    client.post(f"/api/projects/{project_id}/stages/{stages[0]['id']}/start", json={}, headers=OWNER)
    client.post(f"/api/projects/{project_id}/stages/{stages[1]['id']}/start", json={}, headers=OWNER)
    task_id = create_task(client, project_id, stages[0]["id"]).json()["id"]
    complete = client.post(f"/api/projects/{project_id}/stages/{stages[0]['id']}/complete", json={"successor_stage_id": stages[1]["id"]}, headers=OWNER)
    assert complete.status_code == 200
    completed_stage_id = stages[0]["id"]

    assert create_task(client, project_id, completed_stage_id).status_code == 409
    assert client.patch(f"/api/projects/{project_id}/tasks/{task_id}", json={"title": "x"}, headers=OWNER).status_code == 409


# --- 4.2 移动 / 删除任务 (spec 4.x) ---


def test_move_task_to_another_stage(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    stages = list_stages(client, project_id)
    task_id = create_task(client, project_id, stages[0]["id"]).json()["id"]

    resp = client.put(f"/api/projects/{project_id}/tasks/{task_id}/move", json={"target_stage_id": stages[1]["id"]}, headers=OWNER)
    assert resp.status_code == 200
    assert resp.json()["stage_id"] == stages[1]["id"]
    assert "task_moved" in activity_types(project_id)


def test_move_out_of_active_stage_requires_reason(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    stages = list_stages(client, project_id)
    client.post(f"/api/projects/{project_id}/stages/{stages[0]['id']}/start", json={}, headers=OWNER)
    task_id = create_task(client, project_id, stages[0]["id"]).json()["id"]

    without = client.put(f"/api/projects/{project_id}/tasks/{task_id}/move", json={"target_stage_id": stages[1]["id"]}, headers=OWNER)
    assert without.status_code == 422

    with_reason = client.put(
        f"/api/projects/{project_id}/tasks/{task_id}/move",
        json={"target_stage_id": stages[1]["id"], "reason": "优先级调整"},
        headers=OWNER,
    )
    assert with_reason.status_code == 200
    assert with_reason.json()["stage_id"] == stages[1]["id"]


def test_move_done_task_rejected(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    stages = list_stages(client, project_id)
    task_id = create_task(client, project_id, stages[0]["id"]).json()["id"]
    client.patch(f"/api/projects/{project_id}/tasks/{task_id}", json={"status": "in_progress"}, headers=OWNER)
    client.patch(f"/api/projects/{project_id}/tasks/{task_id}", json={"status": "done"}, headers=OWNER)

    resp = client.put(f"/api/projects/{project_id}/tasks/{task_id}/move", json={"target_stage_id": stages[1]["id"]}, headers=OWNER)
    assert resp.status_code == 409


def test_move_into_completed_stage_rejected(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    stages = list_stages(client, project_id)
    client.post(f"/api/projects/{project_id}/stages/{stages[0]['id']}/start", json={}, headers=OWNER)
    client.post(f"/api/projects/{project_id}/stages/{stages[1]['id']}/start", json={}, headers=OWNER)
    complete = client.post(f"/api/projects/{project_id}/stages/{stages[1]['id']}/complete", json={"successor_stage_id": stages[0]["id"]}, headers=OWNER)
    assert complete.status_code == 200
    task_id = create_task(client, project_id, stages[0]["id"]).json()["id"]

    resp = client.put(f"/api/projects/{project_id}/tasks/{task_id}/move", json={"target_stage_id": stages[1]["id"]}, headers=OWNER)
    assert resp.status_code == 409


def test_delete_normal_task(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    task_id = create_task(client, project_id, stage_id).json()["id"]

    resp = client.delete(f"/api/projects/{project_id}/tasks/{task_id}", headers=OWNER)
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}
    assert "task_deleted" in activity_types(project_id)
    assert client.get(f"/api/projects/{project_id}/stages/{stage_id}/tasks", headers=OWNER).json() == []


def test_delete_in_completed_stage_rejected(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    stages = list_stages(client, project_id)
    task_id = create_task(client, project_id, stages[0]["id"]).json()["id"]
    _start_and_complete(client, project_id, stages[0]["id"], successor_id=stages[1]["id"])

    assert client.delete(f"/api/projects/{project_id}/tasks/{task_id}", headers=OWNER).status_code == 409


def test_observer_cannot_delete(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    _seed_roles(client, project_id)
    stage_id = list_stages(client, project_id)[0]["id"]
    task_id = create_task(client, project_id, stage_id).json()["id"]

    assert client.delete(f"/api/projects/{project_id}/tasks/{task_id}", headers=OBSERVER).status_code == 403


# --- 4.3 我的任务 (spec 5.x) ---


def test_my_tasks_shows_unfinished_only(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    t1 = create_task(client, project_id, stage_id, title="未完成", assignee="task-owner").json()["id"]
    create_task(client, project_id, stage_id, title="已完成", assignee="task-owner", status="done")

    body = client.get("/api/my-tasks", headers=OWNER).json()
    ids = [t["id"] for t in body]
    assert t1 in ids
    assert len(body) == 1


def test_my_tasks_filters_and_flags(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    create_task(client, project_id, stage_id, title="逾期任务", assignee="task-owner", priority="urgent", planned_date="2020-01-01")
    blocked = create_task(client, project_id, stage_id, title="受阻任务", assignee="task-owner", priority="low")
    client.patch(f"/api/projects/{project_id}/tasks/{blocked.json()['id']}", json={"status": "in_progress"}, headers=OWNER)
    client.patch(f"/api/projects/{project_id}/tasks/{blocked.json()['id']}", json={"status": "blocked"}, headers=OWNER)

    all_tasks = client.get("/api/my-tasks", headers=OWNER).json()
    overdue = next(t for t in all_tasks if t["title"] == "逾期任务")
    assert overdue["overdue"] is True
    blocked_task = next(t for t in all_tasks if t["title"] == "受阻任务")
    assert blocked_task["blocked"] is True

    by_priority = client.get("/api/my-tasks?priority=urgent", headers=OWNER).json()
    assert all(t["priority"] == "urgent" for t in by_priority)
    assert len(by_priority) == 1


def test_my_tasks_empty_for_user_with_no_tasks(client):
    create_project(client, stages=[{"name": "开发"}])
    body = client.get("/api/my-tasks", headers={"X-User-Id": "someone-else"}).json()
    assert body == []
