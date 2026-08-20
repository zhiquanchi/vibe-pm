from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.database import get_session, init_db
from app.db.models import ProjectActivity, Stage, StageBlocker
from app.routers.projects import router as projects_router
from app.routers.stages import router as stages_router
from app.routers.tasks import router as tasks_router
from app.services.stages import DEFAULT_STAGE_TEMPLATE

OWNER = {"X-User-Id": "stage-owner"}
OWNER2 = {"X-User-Id": "stage-owner-2"}
MEMBER = {"X-User-Id": "stage-member"}
OBSERVER = {"X-User-Id": "stage-observer"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "stages.db"))
    init_db(seed=False)
    api = FastAPI()
    api.include_router(projects_router)
    api.include_router(stages_router)
    api.include_router(tasks_router)
    return TestClient(api)


def create_project(client, stages=None, headers=OWNER):
    payload = {
        "name": "阶段测试项目",
        "members": [
            {"user_id": "stage-owner", "name": "负责人一", "email": "stage-owner@test.local", "role": "owner"},
            {"user_id": "stage-owner-2", "name": "负责人二", "email": "stage-owner-2@test.local", "role": "owner"},
        ],
    }
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


def seed_worker_roles(client, project_id):
    for user_id, name, role in (
        ("stage-member", "阶段负责人", "member"),
        ("stage-observer", "观察者", "observer"),
    ):
        response = client.post(
            f"/api/projects/{project_id}/members",
            json={"user_id": user_id, "name": name, "email": f"{user_id}@test.local", "role": role},
            headers=OWNER,
        )
        assert response.status_code == 200


def prepare_acceptance_stage(client, *, with_task=True, task_done=True, deliverable_content=True):
    project_id = create_project(client, stages=[{"name": "开发", "owner_id": "stage-member"}])
    stage_id = list_stages(client, project_id)[0]["id"]
    seed_worker_roles(client, project_id)
    if with_task:
        task = client.post(
            f"/api/projects/{project_id}/stages/{stage_id}/tasks",
            json={"title": "验收任务", "assignee": "stage-member"},
            headers=OWNER,
        ).json()
        marked = client.patch(
            f"/api/projects/{project_id}/tasks/{task['id']}",
            json={"acceptance_required": True},
            headers=OWNER,
        )
        assert marked.status_code == 200
        assert marked.json()["acceptance_required"] is True
        if task_done:
            assert client.patch(f"/api/projects/{project_id}/tasks/{task['id']}", json={"status": "in_progress"}, headers=MEMBER).status_code == 200
            assert client.patch(f"/api/projects/{project_id}/tasks/{task['id']}", json={"status": "done"}, headers=MEMBER).status_code == 200
    deliverable_payload = {
        "name": "部署说明",
        "type": "document",
        "content_kind": "link" if deliverable_content else "file",
    }
    if deliverable_content:
        deliverable_payload["link"] = "https://example.com/deploy"
    deliverable = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/deliverables",
        json=deliverable_payload,
        headers=MEMBER,
    ).json()
    marked = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable['id']}/mark-required",
        headers=OWNER,
    )
    assert marked.status_code == 200
    assert marked.json()["is_required"] is True
    assert client.post(f"/api/projects/{project_id}/stages/{stage_id}/start", json={}, headers=OWNER).status_code == 200
    return project_id, stage_id


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


# --- 4.5 阶段负责人管理（spec 场景 4.x） ---


def test_assign_stage_owner(client):
    """Test assigning a stage owner."""
    project_id = create_project(client)
    stages = list_stages(client, project_id)
    stage_id = stages[0]["id"]

    # Assign owner
    response = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/owner",
        json={"owner_id": "stage-owner"},
        headers=OWNER,
    )
    assert response.status_code == 200
    assert response.json()["owner_id"] == "stage-owner"
    assert "stage_owner_changed" in activity_types(project_id)


def test_change_stage_owner(client):
    """Test changing a stage owner to a different member."""
    project_id = create_project(client)

    # Add another member
    client.post(
        f"/api/projects/{project_id}/members",
        json={"user_id": "member-2", "name": "成员2", "email": "member2@test.local", "role": "member"},
        headers=OWNER,
    )

    stages = list_stages(client, project_id)
    stage_id = stages[0]["id"]

    # Assign first owner
    client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/owner",
        json={"owner_id": "stage-owner"},
        headers=OWNER,
    )

    # Change to second owner
    response = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/owner",
        json={"owner_id": "member-2"},
        headers=OWNER,
    )
    assert response.status_code == 200
    assert response.json()["owner_id"] == "member-2"


def test_stage_owner_must_be_project_member(client):
    """Test that stage owner must be a project member."""
    project_id = create_project(client)
    stages = list_stages(client, project_id)
    stage_id = stages[0]["id"]

    # Try to assign non-member as owner
    response = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/owner",
        json={"owner_id": "non-member"},
        headers=OWNER,
    )
    assert response.status_code == 422
    assert "必须是项目成员" in response.json()["detail"]


def test_only_project_owner_can_assign_stage_owner(client):
    """Test that only project owners can assign stage owners."""
    project_id = create_project(client)

    # Add a regular member
    client.post(
        f"/api/projects/{project_id}/members",
        json={"user_id": "regular-member", "name": "成员", "email": "member@test.local", "role": "member"},
        headers=OWNER,
    )

    stages = list_stages(client, project_id)
    stage_id = stages[0]["id"]

    # Try to assign owner as regular member
    response = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/owner",
        json={"owner_id": "regular-member"},
        headers={"X-User-Id": "regular-member"},
    )
    assert response.status_code == 403


# --- PRD-05: stage deliverables & acceptance ---


def test_deliverable_crud_member_and_observer_permissions(client):
    project_id, stage_id = prepare_acceptance_stage(client, with_task=False, deliverable_content=True)

    observer_create = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/deliverables",
        json={"name": "观察者产物", "type": "other", "content_kind": "link", "link": "https://example.com/no"},
        headers=OBSERVER,
    )
    assert observer_create.status_code == 403

    created = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/deliverables",
        json={"name": "接口文档", "type": "document", "content_kind": "link", "link": "https://example.com/api"},
        headers=MEMBER,
    )
    assert created.status_code == 201
    body = created.json()
    assert body["submitted_by"] == "stage-member"
    assert body["submitted_at"]
    assert body["is_required"] is False

    updated = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/deliverables/{body['id']}",
        json={"name": "接口文档 v2", "type": "code", "content_kind": "file", "link": None, "file_path": "/share/api.md", "file_name": "api.md"},
        headers=OWNER2,
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "接口文档 v2"
    assert updated.json()["file_path"] == "/share/api.md"
    assert updated.json()["file_url"] == "/share/api.md"
    assert updated.json()["submitted_by"] == "stage-owner-2"

    listed = client.get(f"/api/projects/{project_id}/stages/{stage_id}/deliverables", headers=OBSERVER)
    assert listed.status_code == 200
    assert [item["name"] for item in listed.json()] == ["接口文档 v2", "部署说明"]

    deleted = client.delete(f"/api/projects/{project_id}/stages/{stage_id}/deliverables/{body['id']}", headers=MEMBER)
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}
    activities = set(activity_types(project_id))
    assert {"stage_deliverable_added", "stage_deliverable_updated", "stage_deliverable_removed"} <= activities


def test_deliverable_required_flag_permissions_and_completed_read_only(client):
    project_id, stage_id = prepare_acceptance_stage(client, with_task=False, deliverable_content=True)
    deliverables = client.get(f"/api/projects/{project_id}/stages/{stage_id}/deliverables", headers=OWNER).json()
    deliverable_id = deliverables[0]["id"]

    forbidden = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}/mark-required",
        headers=MEMBER,
    )
    assert forbidden.status_code == 403

    unrequired = client.delete(
        f"/api/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}/mark-required",
        headers=OWNER2,
    )
    assert unrequired.status_code == 200
    assert unrequired.json()["is_required"] is False
    assert "stage_deliverable_optional" in activity_types(project_id)

    required = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}/mark-required",
        headers=OWNER,
    )
    assert required.status_code == 200
    assert required.json()["is_required"] is True
    assert "stage_deliverable_required" in activity_types(project_id)

    assert client.post(f"/api/projects/{project_id}/stages/{stage_id}/complete", json={}, headers=OWNER).status_code == 200
    read_only = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/deliverables/{deliverable_id}",
        json={"name": "不能修改"},
        headers=OWNER,
    )
    assert read_only.status_code == 409
    assert read_only.json()["detail"] == "已完成阶段为只读"


def test_submit_acceptance_lists_all_unmet_conditions(client):
    project_id, stage_id = prepare_acceptance_stage(client, with_task=True, task_done=False, deliverable_content=False)
    session = get_session()
    session.add(
        StageBlocker(
            stage_id=stage_id,
            reason="环境不可用",
            handler_id="stage-owner",
            created_by="stage-member",
            created_at="2026-08-20T10:00:00",
            previous_stage_status="active",
        )
    )
    session.commit()
    session.close()

    response = client.post(f"/api/projects/{project_id}/stages/{stage_id}/acceptances", json={"notes": "申请验收"}, headers=MEMBER)
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["message"] == "阶段验收条件未满足"
    assert detail["incomplete_required_tasks"] == [{"id": detail["incomplete_required_tasks"][0]["id"], "title": "验收任务"}]
    assert detail["missing_required_deliverables"] == [{"id": detail["missing_required_deliverables"][0]["id"], "name": "部署说明"}]
    assert detail["unresolved_stage_blockers"][0]["reason"] == "环境不可用"
    assert list_stages(client, project_id)[0]["status"] == "active"


def test_non_stage_owner_cannot_submit_acceptance(client):
    project_id, stage_id = prepare_acceptance_stage(client)
    plain = {"X-User-Id": "plain-member"}
    assert client.post(f"/api/projects/{project_id}/members", json={"user_id": "plain-member", "name": "普通成员", "email": "plain@test.local"}, headers=OWNER).status_code == 200
    response = client.post(f"/api/projects/{project_id}/stages/{stage_id}/acceptances", json={}, headers=plain)
    assert response.status_code == 403
    assert response.json()["detail"] == "只有阶段负责人或项目负责人可以提交阶段验收"


def test_submit_acceptance_success_and_pending_stage_is_read_only(client):
    project_id, stage_id = prepare_acceptance_stage(client)
    response = client.post(f"/api/projects/{project_id}/stages/{stage_id}/acceptances", json={"note": "材料齐备"}, headers=MEMBER)
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "pending"
    assert body["submitted_by"] == "stage-member"
    assert body["submitted_at"]
    assert body["handled_by"] is None
    assert body["notes"] == "材料齐备"
    assert body["note"] == "材料齐备"
    assert list_stages(client, project_id)[0]["status"] == "pending_acceptance"
    assert "stage_acceptance_submitted" in activity_types(project_id)

    deliverables = client.get(f"/api/projects/{project_id}/stages/{stage_id}/deliverables", headers=OWNER).json()
    frozen = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/deliverables/{deliverables[0]['id']}",
        json={"name": "不能修改"},
        headers=MEMBER,
    )
    assert frozen.status_code == 409
    assert frozen.json()["detail"] == "待验收阶段为只读"


def test_approve_acceptance_then_reopen_completed_stage(client):
    project_id, stage_id = prepare_acceptance_stage(client)
    acceptance = client.post(f"/api/projects/{project_id}/stages/{stage_id}/acceptances", json={}, headers=MEMBER).json()

    approved = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/acceptances/{acceptance['id']}",
        json={"action": "approve", "note": "验收通过"},
        headers=OWNER,
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["handled_by"] == "stage-owner"
    assert approved.json()["reviewed_by"] == "stage-owner"
    assert approved.json()["handled_at"]
    assert approved.json()["notes"] == "验收通过"
    assert list_stages(client, project_id)[0]["status"] == "completed"
    assert "stage_acceptance_approved" in activity_types(project_id)

    no_reason = client.post(f"/api/projects/{project_id}/stages/{stage_id}/reopen", json={"reason": " "}, headers=OWNER2)
    assert no_reason.status_code == 422
    member_reopen = client.post(f"/api/projects/{project_id}/stages/{stage_id}/reopen", json={"reason": "补充材料"}, headers=MEMBER)
    assert member_reopen.status_code == 403
    reopened = client.post(f"/api/projects/{project_id}/stages/{stage_id}/reopen", json={"reason": "需求补充"}, headers=OWNER2)
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "active"
    records = client.get(f"/api/projects/{project_id}/stages/{stage_id}/acceptances", headers=MEMBER).json()
    assert records[0]["status"] == "approved"
    assert "stage_reopened" in activity_types(project_id)


def test_reject_acceptance_requires_reason_and_independent_handler(client):
    project_id, stage_id = prepare_acceptance_stage(client)
    acceptance = client.post(f"/api/projects/{project_id}/stages/{stage_id}/acceptances", json={}, headers=OWNER).json()

    self_review = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/acceptances/{acceptance['id']}",
        json={"action": "approve"},
        headers=OWNER,
    )
    assert self_review.status_code == 403
    assert self_review.json()["detail"] == "不能验收自己提交的阶段"

    missing_reason = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/acceptances/{acceptance['id']}",
        json={"action": "reject"},
        headers=OWNER2,
    )
    assert missing_reason.status_code == 422

    rejected = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/acceptances/{acceptance['id']}",
        json={"action": "reject", "rejection_reason": "材料不完整"},
        headers=OWNER2,
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["rejection_reason"] == "材料不完整"
    assert list_stages(client, project_id)[0]["status"] == "active"
    assert "stage_acceptance_rejected" in activity_types(project_id)
