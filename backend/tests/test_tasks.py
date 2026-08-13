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


# --- PRD-04: 任务依赖与阻塞 (spec 1.x / 3.x / 4.x / 5.x) ---


def _get_stage(client, project_id, stage_id, headers=OWNER):
    stages = client.get(f"/api/projects/{project_id}/stages", headers=headers).json()
    return next(s for s in stages if s["id"] == stage_id)


def test_add_task_dependency_success(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    a = create_task(client, project_id, stage_id, title="A").json()["id"]
    b = create_task(client, project_id, stage_id, title="B").json()["id"]

    resp = client.post(f"/api/projects/{project_id}/tasks/{a}/dependencies", json={"dependency_id": b}, headers=OWNER)
    assert resp.status_code == 201
    assert "task_dependency_added" in activity_types(project_id)

    listed = client.get(f"/api/projects/{project_id}/tasks/{a}/dependencies", headers=OWNER).json()
    assert len(listed) == 1
    assert listed[0]["dependency"]["id"] == b
    assert listed[0]["dependency"]["title"] == "B"
    assert "status" in listed[0]["dependency"]


def test_self_dependency_rejected(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    a = create_task(client, project_id, stage_id, title="A").json()["id"]

    resp = client.post(f"/api/projects/{project_id}/tasks/{a}/dependencies", json={"dependency_id": a}, headers=OWNER)
    assert resp.status_code == 422
    assert resp.json()["detail"] == "任务不能依赖自身"


def test_direct_cycle_dependency_rejected(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    a = create_task(client, project_id, stage_id, title="A").json()["id"]
    b = create_task(client, project_id, stage_id, title="B").json()["id"]

    # A depends on B.
    assert client.post(f"/api/projects/{project_id}/tasks/{a}/dependencies", json={"dependency_id": b}, headers=OWNER).status_code == 201
    # Now B depends on A -> direct cycle.
    resp = client.post(f"/api/projects/{project_id}/tasks/{b}/dependencies", json={"dependency_id": a}, headers=OWNER)
    assert resp.status_code == 422
    assert "检测到循环依赖：A → B → A" in resp.json()["detail"]


def test_indirect_cycle_dependency_rejected(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    a = create_task(client, project_id, stage_id, title="A").json()["id"]
    b = create_task(client, project_id, stage_id, title="B").json()["id"]
    c = create_task(client, project_id, stage_id, title="C").json()["id"]

    assert client.post(f"/api/projects/{project_id}/tasks/{a}/dependencies", json={"dependency_id": b}, headers=OWNER).status_code == 201
    assert client.post(f"/api/projects/{project_id}/tasks/{b}/dependencies", json={"dependency_id": c}, headers=OWNER).status_code == 201
    # C depends on A -> indirect cycle.
    resp = client.post(f"/api/projects/{project_id}/tasks/{c}/dependencies", json={"dependency_id": a}, headers=OWNER)
    assert resp.status_code == 422
    assert "检测到循环依赖：A → B → C → A" in resp.json()["detail"]


def test_remove_dependency_record(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    a = create_task(client, project_id, stage_id, title="A").json()["id"]
    b = create_task(client, project_id, stage_id, title="B").json()["id"]

    dep = client.post(f"/api/projects/{project_id}/tasks/{a}/dependencies", json={"dependency_id": b}, headers=OWNER).json()
    resp = client.delete(f"/api/projects/{project_id}/tasks/{a}/dependencies/{dep['id']}", headers=OWNER)
    assert resp.status_code == 200
    assert client.get(f"/api/projects/{project_id}/tasks/{a}/dependencies", headers=OWNER).json() == []


def test_delete_dependent_task_rejected(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    a = create_task(client, project_id, stage_id, title="A").json()["id"]
    b = create_task(client, project_id, stage_id, title="B").json()["id"]

    client.post(f"/api/projects/{project_id}/tasks/{a}/dependencies", json={"dependency_id": b}, headers=OWNER)
    # Deleting B (which A depends on) must be blocked.
    resp = client.delete(f"/api/projects/{project_id}/tasks/{b}", headers=OWNER)
    assert resp.status_code == 409
    assert "被" in resp.json()["detail"]


def test_mark_task_blocked_success_and_requires_reason_handler(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    t = create_task(client, project_id, stage_id, title="受阻任务", assignee="task-owner").json()["id"]

    # Missing handler -> 422.
    resp = client.post(f"/api/projects/{project_id}/tasks/{t}/blockers", json={"reason": "卡住了"}, headers=OWNER)
    assert resp.status_code == 422
    # Missing reason -> pydantic 422.
    resp = client.post(f"/api/projects/{project_id}/tasks/{t}/blockers", json={"handler_id": "task-owner"}, headers=OWNER)
    assert resp.status_code == 422

    resp = client.post(f"/api/projects/{project_id}/tasks/{t}/blockers", json={"reason": "卡住了", "handler_id": "task-owner"}, headers=OWNER)
    assert resp.status_code == 201
    assert resp.json()["task_id"] == t
    assert resp.json()["resolved_at"] is None

    task = client.get(f"/api/projects/{project_id}/stages/{stage_id}/tasks", headers=OWNER).json()
    assert next(x for x in task if x["id"] == t)["status"] == "blocked"

    blockers = client.get(f"/api/projects/{project_id}/tasks/{t}/blockers", headers=OWNER).json()
    assert len(blockers) == 1
    assert blockers[0]["reason"] == "卡住了"


def test_resolve_task_blocker_to_pending_verification(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    t = create_task(client, project_id, stage_id, title="受阻任务", assignee="task-owner").json()["id"]

    blocker = client.post(
        f"/api/projects/{project_id}/tasks/{t}/blockers", json={"reason": "卡住了", "handler_id": "task-owner"}, headers=OWNER
    ).json()

    # Missing resolution -> 422.
    assert client.patch(f"/api/projects/{project_id}/tasks/{t}/blockers/{blocker['id']}", json={}, headers=OWNER).status_code == 422

    resp = client.patch(
        f"/api/projects/{project_id}/tasks/{t}/blockers/{blocker['id']}", json={"resolution": "已修复"}, headers=OWNER
    )
    assert resp.status_code == 200
    assert resp.json()["resolved_at"] is not None
    assert resp.json()["resolution"] == "已修复"

    task = client.get(f"/api/projects/{project_id}/stages/{stage_id}/tasks", headers=OWNER).json()
    assert next(x for x in task if x["id"] == t)["status"] == "pending_verification"


def test_mark_stage_blocked_owner_and_non_owner(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    _seed_roles(client, project_id)
    stage_id = list_stages(client, project_id)[0]["id"]

    # Non-owner (member) -> 403.
    resp = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/blockers", json={"reason": "阻塞", "handler_id": "task-owner"}, headers=MEMBER
    )
    assert resp.status_code == 403

    # Project owner -> success.
    resp = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/blockers", json={"reason": "阻塞", "handler_id": "task-owner"}, headers=OWNER
    )
    assert resp.status_code == 201
    assert _get_stage(client, project_id, stage_id)["status"] == "blocked"

    # Stage tasks stay untouched.
    blockers = client.get(f"/api/projects/{project_id}/stages/{stage_id}/blockers", headers=OWNER).json()
    assert len(blockers) == 1
    assert blockers[0]["previous_stage_status"] == "planned"


def test_resolve_stage_blocker_restores_status(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    client.post(f"/api/projects/{project_id}/stages/{stage_id}/start", json={}, headers=OWNER)
    assert _get_stage(client, project_id, stage_id)["status"] == "active"

    blocker = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/blockers", json={"reason": "阻塞", "handler_id": "task-owner"}, headers=OWNER
    ).json()
    assert _get_stage(client, project_id, stage_id)["status"] == "blocked"

    resp = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/blockers/{blocker['id']}", json={"resolution": "已解决"}, headers=OWNER
    )
    assert resp.status_code == 200
    assert _get_stage(client, project_id, stage_id)["status"] == "active"


def test_confirm_blocker_continue_and_reblock(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    stage_id = list_stages(client, project_id)[0]["id"]

    # continue
    t1 = create_task(client, project_id, stage_id, title="任务1", assignee="task-owner").json()["id"]
    b1 = client.post(f"/api/projects/{project_id}/tasks/{t1}/blockers", json={"reason": "x", "handler_id": "task-owner"}, headers=OWNER).json()
    client.patch(f"/api/projects/{project_id}/tasks/{t1}/blockers/{b1['id']}", json={"resolution": "ok"}, headers=OWNER)
    resp = client.post(f"/api/projects/{project_id}/tasks/{t1}/confirm-blocker", json={"action": "continue"}, headers=OWNER)
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"

    # reblock
    t2 = create_task(client, project_id, stage_id, title="任务2", assignee="task-owner").json()["id"]
    b2 = client.post(f"/api/projects/{project_id}/tasks/{t2}/blockers", json={"reason": "x", "handler_id": "task-owner"}, headers=OWNER).json()
    client.patch(f"/api/projects/{project_id}/tasks/{t2}/blockers/{b2['id']}", json={"resolution": "ok"}, headers=OWNER)
    resp = client.post(
        f"/api/projects/{project_id}/tasks/{t2}/confirm-blocker",
        json={"action": "reblock", "reason": "仍未解决", "handler_id": "task-owner"},
        headers=OWNER,
    )
    assert resp.status_code == 200
    assert resp.json()["task_id"] == t2
    assert resp.json()["resolved_at"] is None
    task = client.get(f"/api/projects/{project_id}/stages/{stage_id}/tasks", headers=OWNER).json()
    assert next(x for x in task if x["id"] == t2)["status"] == "blocked"
    blockers = client.get(f"/api/projects/{project_id}/tasks/{t2}/blockers", headers=OWNER).json()
    assert len(blockers) == 2


def test_confirm_blocker_requires_assignee(client):
    project_id = create_project(client, stages=[{"name": "开发"}])
    _seed_roles(client, project_id)
    stage_id = list_stages(client, project_id)[0]["id"]

    t = create_task(client, project_id, stage_id, title="任务", assignee="task-member").json()["id"]
    b = client.post(f"/api/projects/{project_id}/tasks/{t}/blockers", json={"reason": "x", "handler_id": "task-owner"}, headers=OWNER).json()
    client.patch(f"/api/projects/{project_id}/tasks/{t}/blockers/{b['id']}", json={"resolution": "ok"}, headers=OWNER)

    # Owner (non-assignee) tries to confirm -> 403.
    resp = client.post(f"/api/projects/{project_id}/tasks/{t}/confirm-blocker", json={"action": "continue"}, headers=OWNER)
    assert resp.status_code == 403
    assert "非任务负责人无法确认阻塞" in resp.json()["detail"]
