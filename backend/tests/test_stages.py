from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.database import get_session, init_db
from app.db.models import ProjectActivity
from app.routers.projects import router as projects_router
from app.routers.stages import router as stages_router
from app.services.stages import DEFAULT_STAGE_TEMPLATE

OWNER = {"X-User-Id": "stage-owner"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "stages.db"))
    init_db(seed=False)
    api = FastAPI()
    api.include_router(projects_router)
    api.include_router(stages_router)
    return TestClient(api)


def create_project(client, stages=None, headers=OWNER):
    payload = {"name": "阶段测试项目"}
    if stages is not None:
        payload["stages"] = stages
    response = client.post("/api/projects", json=payload, headers=headers)
    assert response.status_code == 200
    return response.json()["id"]


def list_stages(client, project_id, headers=OWNER):
    response = client.get(f"/api/projects/{project_id}/stages", headers=headers)
    assert response.status_code == 200
    return response.json()


def activity_types(project_id):
    session = get_session()
    rows = session.scalars(select(ProjectActivity.type).where(ProjectActivity.project_id == project_id).order_by(ProjectActivity.id)).all()
    session.close()
    return rows


# --- 4.1 模板化创建（spec 场景 1.x） ---


def test_stage_template_endpoint(client):
    body = client.get("/api/stage-template").json()
    assert [item["name"] for item in body] == DEFAULT_STAGE_TEMPLATE


def test_default_template_creation(client):
    project_id = create_project(client)
    stages = list_stages(client, project_id)
    assert [stage["name"] for stage in stages] == DEFAULT_STAGE_TEMPLATE
    assert [stage["position"] for stage in stages] == [0, 1, 2, 3, 4]
    assert {stage["status"] for stage in stages} == {"planned"}
    assert all(not stage["is_primary"] for stage in stages)
    assert "project_created" in activity_types(project_id)


def test_custom_stages_creation(client):
    custom = [
        {"name": "技术验证", "goal": "验证选型"},
        {"name": "开发", "planned_start": "2026-09-01", "planned_end": "2026-09-20"},
        {"name": "灰度发布"},
    ]
    project_id = create_project(client, stages=custom)
    stages = list_stages(client, project_id)
    assert [stage["name"] for stage in stages] == ["技术验证", "开发", "灰度发布"]
    assert stages[0]["goal"] == "验证选型"
    assert stages[1]["planned_start"] == "2026-09-01"


def test_empty_name_rejected(client):
    response = client.post("/api/projects", json={"name": "x", "stages": [{"name": ""}]}, headers=OWNER)
    assert response.status_code == 422


def test_duplicate_names_rejected(client):
    response = client.post("/api/projects", json={"name": "x", "stages": [{"name": "开发"}, {"name": "开发"}]}, headers=OWNER)
    assert response.status_code == 422


def test_empty_stage_list_rejected(client):
    response = client.post("/api/projects", json={"name": "x", "stages": []}, headers=OWNER)
    assert response.status_code == 422


# --- 4.2 结构管理（spec 场景 2.x） ---


def test_add_and_rename_stage(client):
    project_id = create_project(client, stages=[{"name": "开发"}, {"name": "测试"}])
    added = client.post(f"/api/projects/{project_id}/stages", json={"name": "发布"}, headers=OWNER)
    assert added.status_code == 201
    assert added.json()["position"] == 2
    assert added.json()["status"] == "planned"

    stage_id = added.json()["id"]
    renamed = client.patch(f"/api/projects/{project_id}/stages/{stage_id}", json={"name": "灰度发布"}, headers=OWNER)
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "灰度发布"

    conflict = client.patch(f"/api/projects/{project_id}/stages/{stage_id}", json={"name": "开发"}, headers=OWNER)
    assert conflict.status_code == 409
    assert activity_types(project_id) == ["project_created", "stage_created", "stage_renamed"]


def test_reorder_stages(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}, {"name": "三"}])
    ids = [stage["id"] for stage in list_stages(client, project_id)]
    reordered = client.put(f"/api/projects/{project_id}/stages/reorder", json={"stage_ids": [ids[2], ids[0], ids[1]]}, headers=OWNER)
    assert reordered.status_code == 200
    assert [stage["name"] for stage in reordered.json()] == ["三", "一", "二"]
    assert "stage_reordered" in activity_types(project_id)

    partial = client.put(f"/api/projects/{project_id}/stages/reorder", json={"stage_ids": [ids[0]]}, headers=OWNER)
    assert partial.status_code == 422


def test_delete_requires_confirm_and_repacks_positions(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}, {"name": "三"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    preview = client.delete(f"/api/projects/{project_id}/stages/{stage_id}", headers=OWNER)
    assert preview.status_code == 409
    detail = preview.json()["detail"]
    assert detail["confirm_required"] is True
    assert detail["impact"] == {"tasks": 0, "deliverables": 0}
    assert len(list_stages(client, project_id)) == 3

    deleted = client.delete(f"/api/projects/{project_id}/stages/{stage_id}?confirm=true", headers=OWNER)
    assert deleted.json() == {"deleted": True}
    stages = list_stages(client, project_id)
    assert [stage["name"] for stage in stages] == ["二", "三"]
    assert [stage["position"] for stage in stages] == [0, 1]
    assert "stage_deleted" in activity_types(project_id)


def _start_and_complete(client, project_id, stage_id, headers=OWNER):
    assert client.post(f"/api/projects/{project_id}/stages/{stage_id}/start", json={}, headers=headers).status_code == 200
    assert client.post(f"/api/projects/{project_id}/stages/{stage_id}/complete", json={}, headers=headers).status_code == 200


def test_completed_stage_is_locked(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    _start_and_complete(client, project_id, stage_id)

    assert client.delete(f"/api/projects/{project_id}/stages/{stage_id}?confirm=true", headers=OWNER).status_code == 409
    assert client.patch(f"/api/projects/{project_id}/stages/{stage_id}", json={"name": "改名"}, headers=OWNER).status_code == 409
    reorder = client.put(f"/api/projects/{project_id}/stages/reorder", json={"stage_ids": [stage_id]}, headers=OWNER)
    assert reorder.status_code == 409
    # 负责人与日期仍可修改
    updated = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}",
        json={"owner_id": "stage-owner", "planned_start": "2026-09-01", "planned_end": "2026-09-10"},
        headers=OWNER,
    )
    assert updated.status_code == 200
    assert updated.json()["owner_id"] == "stage-owner"


def test_non_owner_cannot_modify_structure(client):
    project_id = create_project(client)
    added = client.post(
        f"/api/projects/{project_id}/members",
        json={"user_id": "plain-member", "name": "成员", "email": "member@test.local"},
        headers=OWNER,
    )
    assert added.status_code == 200
    member = {"X-User-Id": "plain-member"}
    stage_id = list_stages(client, project_id, headers=member)[0]["id"]

    assert client.post(f"/api/projects/{project_id}/stages", json={"name": "新阶段"}, headers=member).status_code == 403
    assert client.patch(f"/api/projects/{project_id}/stages/{stage_id}", json={"name": "改名"}, headers=member).status_code == 403
    assert client.put(f"/api/projects/{project_id}/stages/reorder", json={"stage_ids": [stage_id]}, headers=member).status_code == 403
    assert client.delete(f"/api/projects/{project_id}/stages/{stage_id}?confirm=true", headers=member).status_code == 403
    assert client.post(f"/api/projects/{project_id}/stages/{stage_id}/start", json={}, headers=member).status_code == 403


# --- 4.3 启动与主阶段（spec 场景 3.x） ---


def test_first_start_becomes_primary_and_parallel_start(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}, {"name": "三"}])
    first, second, _third = list_stages(client, project_id)

    started = client.post(f"/api/projects/{project_id}/stages/{first['id']}/start", json={}, headers=OWNER)
    assert started.status_code == 200
    assert started.json()["status"] == "active"
    assert started.json()["is_primary"] is True

    parallel = client.post(f"/api/projects/{project_id}/stages/{second['id']}/start", json={"primary": False}, headers=OWNER)
    assert parallel.json()["is_primary"] is False
    stages = list_stages(client, project_id)
    assert sum(1 for stage in stages if stage["is_primary"]) == 1
    assert activity_types(project_id).count("stage_started") == 2


def test_switch_primary_keeps_old_stage_active(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    first, second = list_stages(client, project_id)
    client.post(f"/api/projects/{project_id}/stages/{first['id']}/start", json={}, headers=OWNER)
    client.post(f"/api/projects/{project_id}/stages/{second['id']}/start", json={}, headers=OWNER)

    switched = client.post(f"/api/projects/{project_id}/stages/{second['id']}/primary", headers=OWNER)
    assert switched.status_code == 200
    assert switched.json()["is_primary"] is True
    stages = {stage["id"]: stage for stage in list_stages(client, project_id)}
    assert stages[first["id"]]["is_primary"] is False
    assert stages[first["id"]]["status"] == "active"
    assert "primary_changed" in activity_types(project_id)


def test_start_with_primary_flag_switches(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    first, second = list_stages(client, project_id)
    client.post(f"/api/projects/{project_id}/stages/{first['id']}/start", json={}, headers=OWNER)
    started = client.post(f"/api/projects/{project_id}/stages/{second['id']}/start", json={"primary": True}, headers=OWNER)
    assert started.json()["is_primary"] is True
    stages = list_stages(client, project_id)
    assert sum(1 for stage in stages if stage["is_primary"]) == 1


def test_complete_primary_requires_successor(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    first, second = list_stages(client, project_id)
    client.post(f"/api/projects/{project_id}/stages/{first['id']}/start", json={}, headers=OWNER)
    client.post(f"/api/projects/{project_id}/stages/{second['id']}/start", json={}, headers=OWNER)

    rejected = client.post(f"/api/projects/{project_id}/stages/{first['id']}/complete", json={}, headers=OWNER)
    assert rejected.status_code == 409
    completed = client.post(
        f"/api/projects/{project_id}/stages/{first['id']}/complete",
        json={"successor_stage_id": second["id"]},
        headers=OWNER,
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    stages = {stage["id"]: stage for stage in list_stages(client, project_id)}
    assert stages[second["id"]]["is_primary"] is True
    assert activity_types(project_id).count("primary_changed") == 1


def test_delete_primary_promotes_next_active_stage(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    first, second = list_stages(client, project_id)
    client.post(f"/api/projects/{project_id}/stages/{first['id']}/start", json={}, headers=OWNER)
    client.post(f"/api/projects/{project_id}/stages/{second['id']}/start", json={}, headers=OWNER)

    deleted = client.delete(f"/api/projects/{project_id}/stages/{first['id']}?confirm=true", headers=OWNER)
    assert deleted.json() == {"deleted": True}
    stages = list_stages(client, project_id)
    assert len(stages) == 1
    assert stages[0]["is_primary"] is True
    assert "primary_changed" in activity_types(project_id)


def test_invalid_transitions_rejected(client):
    project_id = create_project(client, stages=[{"name": "一"}, {"name": "二"}])
    first, second = list_stages(client, project_id)
    assert client.post(f"/api/projects/{project_id}/stages/{first['id']}/complete", json={}, headers=OWNER).status_code == 409
    assert client.post(f"/api/projects/{project_id}/stages/{second['id']}/primary", headers=OWNER).status_code == 409
    client.post(f"/api/projects/{project_id}/stages/{first['id']}/start", json={}, headers=OWNER)
    assert client.post(f"/api/projects/{project_id}/stages/{first['id']}/start", json={}, headers=OWNER).status_code == 409


# --- 4.4 列表（spec 场景 4.x） ---


def test_list_contains_all_fields_and_flags(client):
    project_id = create_project(client, stages=[{"name": "一", "goal": "目标"}, {"name": "二"}])
    first = list_stages(client, project_id)[0]
    client.post(f"/api/projects/{project_id}/stages/{first['id']}/start", json={}, headers=OWNER)
    stages = list_stages(client, project_id)
    expected_keys = {"id", "project_id", "name", "goal", "position", "owner_id", "planned_start", "planned_end", "status", "is_primary", "created_at"}
    assert expected_keys <= set(stages[0])
    assert [stage["position"] for stage in stages] == [0, 1]
    assert stages[0]["is_primary"] is True
    assert stages[0]["status"] == "active"
    assert stages[1]["status"] == "planned"

    # 普通成员也可查看
    client.post(f"/api/projects/{project_id}/members", json={"user_id": "viewer", "name": "观察", "email": "v@test.local"}, headers=OWNER)
    assert client.get(f"/api/projects/{project_id}/stages", headers={"X-User-Id": "viewer"}).status_code == 200
