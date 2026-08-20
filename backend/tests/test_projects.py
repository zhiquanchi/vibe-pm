from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.database import get_session, init_db
from app.db.models import Stage, StageBlocker, Task, TaskBlocker
from app.routers.api import router as api_router
from app.routers.projects import router
from app.routers.stages import router as stages_router
from app.routers.tasks import router as tasks_router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "projects.db"))
    init_db(seed=False)
    api = FastAPI()
    api.include_router(router)
    api.include_router(stages_router)
    api.include_router(tasks_router)
    api.include_router(api_router)
    return TestClient(api)


def test_my_projects_returns_only_membership(client):
    """GET /api/my-projects 仅返回当前用户为成员的项目。"""
    mine = client.post(
        "/api/projects",
        headers={"X-User-Id": "switcher-owner"},
        json={"name": "我的项目"},
    ).json()
    other = client.post(
        "/api/projects",
        headers={"X-User-Id": "someone-else"},
        json={"name": "别人的项目"},
    ).json()

    response = client.get("/api/my-projects", headers={"X-User-Id": "switcher-owner"})
    assert response.status_code == 200
    projects = response.json()
    assert [project["id"] for project in projects] == [mine["id"]]
    assert other["id"] not in [project["id"] for project in projects]
    assert projects[0]["name"] == "我的项目"


def test_project_create_and_detail_membership(client):
    response = client.post(
        "/api/projects",
        headers={"X-User-Id": "project-owner-test"},
        json={"name": "身份测试项目", "description": "项目详情"},
    )
    assert response.status_code == 200
    project_id = response.json()["id"]

    detail = client.get(f"/api/projects/{project_id}", headers={"X-User-Id": "project-owner-test"})
    assert detail.status_code == 200
    assert detail.json()["members"][0]["role"] == "owner"

    forbidden = client.get(f"/api/projects/{project_id}", headers={"X-User-Id": "not-a-member"})
    assert forbidden.status_code == 403


def test_member_can_be_added_and_listed(client):
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "member-owner-test"},
        json={"name": "成员测试项目"},
    ).json()
    project_id = project["id"]
    added = client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "member-owner-test"},
        json={"user_id": "new-member-test", "name": "新成员", "email": "new-member@test.local"},
    )
    assert added.status_code == 200
    members = client.get(f"/api/projects/{project_id}/members", headers={"X-User-Id": "new-member-test"})
    assert members.status_code == 200
    assert {member["id"] for member in members.json()} >= {"new-member-test", "member-owner-test"}


def test_add_member_with_observer_role(client):
    """Test adding a member with observer role."""
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner-observer-test"},
        json={"name": "观察者测试项目"},
    ).json()
    project_id = project["id"]

    added = client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner-observer-test"},
        json={"user_id": "observer-test", "name": "观察者", "email": "observer@test.local", "role": "observer"},
    )
    assert added.status_code == 200
    assert added.json()["role"] == "observer"


def test_cannot_add_duplicate_member(client):
    """Test that adding a duplicate member fails with 409."""
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner-dup-test"},
        json={"name": "重复成员测试"},
    ).json()
    project_id = project["id"]

    # Add member first time
    client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner-dup-test"},
        json={"user_id": "member-dup", "name": "成员", "email": "member@test.local"},
    )

    # Try to add again
    response = client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner-dup-test"},
        json={"user_id": "member-dup", "name": "成员", "email": "member@test.local"},
    )
    assert response.status_code == 409
    assert "已在项目中" in response.json()["detail"]


def test_update_member_role(client):
    """Test updating a member's role."""
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner-role-test"},
        json={"name": "角色调整测试"},
    ).json()
    project_id = project["id"]

    # Add a member
    client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner-role-test"},
        json={"user_id": "member-role", "name": "成员", "email": "member@test.local", "role": "member"},
    )

    # Update role to owner
    response = client.patch(
        f"/api/projects/{project_id}/members/member-role",
        headers={"X-User-Id": "owner-role-test"},
        json={"role": "owner"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "owner"


def test_cannot_remove_owner_if_less_than_two_remain(client):
    """Test that removing an owner fails if it would leave less than 2 owners."""
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner-remove-test"},
        json={"name": "移除负责人测试"},
    ).json()
    project_id = project["id"]

    # Add second owner
    client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner-remove-test"},
        json={"user_id": "owner-2", "name": "负责人2", "email": "owner2@test.local", "role": "owner"},
    )

    # Try to remove one owner (should fail - only 2 owners)
    response = client.delete(
        f"/api/projects/{project_id}/members/owner-2",
        headers={"X-User-Id": "owner-remove-test"},
    )
    assert response.status_code == 409
    assert "至少需要 2 名项目负责人" in response.json()["detail"]


def test_remove_regular_member(client):
    """Test removing a regular member succeeds."""
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner-remove-member-test"},
        json={"name": "移除成员测试"},
    ).json()
    project_id = project["id"]

    # Add a member
    client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner-remove-member-test"},
        json={"user_id": "member-remove", "name": "成员", "email": "member@test.local", "role": "member"},
    )

    # Remove the member
    response = client.delete(
        f"/api/projects/{project_id}/members/member-remove",
        headers={"X-User-Id": "owner-remove-member-test"},
    )
    assert response.status_code == 200
    assert response.json()["deleted"] is True


def test_non_owner_cannot_add_member(client):
    """Test that non-owners cannot add members."""
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner-perm-test"},
        json={"name": "权限测试"},
    ).json()
    project_id = project["id"]

    # Add a regular member
    client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner-perm-test"},
        json={"user_id": "member-perm", "name": "成员", "email": "member@test.local", "role": "member"},
    )

    # Try to add another member as regular member
    response = client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "member-perm"},
        json={"user_id": "new-member", "name": "新成员", "email": "new@test.local"},
    )
    assert response.status_code == 403


def test_project_create_with_members(client):
    """Test creating a project with initial members list (at least 2 owners required)."""
    response = client.post(
        "/api/projects",
        headers={"X-User-Id": "creator-multi"},
        json={
            "name": "多负责人项目",
            "members": [
                {"user_id": "owner-a", "name": "负责人A", "email": "a@test.local", "role": "owner"},
                {"user_id": "owner-b", "name": "负责人B", "email": "b@test.local", "role": "owner"},
                {"user_id": "member-c", "name": "成员C", "email": "c@test.local", "role": "member"},
            ],
        },
    )
    assert response.status_code == 200
    project_id = response.json()["id"]

    # Verify members
    members = client.get(f"/api/projects/{project_id}/members", headers={"X-User-Id": "owner-a"})
    assert members.status_code == 200
    member_ids = {m["id"] for m in members.json()}
    assert member_ids == {"owner-a", "owner-b", "member-c"}


def test_project_create_with_insufficient_owners_fails(client):
    """Test that creating a project with less than 2 owners fails."""
    response = client.post(
        "/api/projects",
        headers={"X-User-Id": "creator-single"},
        json={
            "name": "单负责人项目",
            "members": [
                {"user_id": "owner-only", "name": "唯一负责人", "email": "only@test.local", "role": "owner"},
            ],
        },
    )
    assert response.status_code == 422
    assert "至少需要 2 名项目负责人" in response.text


def test_project_overview_aggregates_stages_tasks_and_recent_activities(client):
    """GET /overview 聚合主阶段、并行阶段、任务指标、验收与近期活动。"""
    created = client.post(
        "/api/projects",
        headers={"X-User-Id": "overview-owner"},
        json={
            "name": "总览项目",
            "stages": [
                {"name": "主阶段", "goal": "交付登录", "planned_start": "2026-08-01", "planned_end": "2026-08-31"},
                {"name": "并行阶段", "goal": "交付支付", "planned_start": "2026-08-10", "planned_end": "2026-09-10"},
            ],
        },
    )
    assert created.status_code == 200
    project_id = created.json()["id"]
    headers = {"X-User-Id": "overview-owner"}
    stages = client.get(f"/api/projects/{project_id}/stages", headers=headers).json()
    primary, parallel = stages
    assert client.post(f"/api/projects/{project_id}/stages/{primary['id']}/start", json={}, headers=headers).status_code == 200
    assert client.post(f"/api/projects/{project_id}/stages/{parallel['id']}/start", json={"primary": False}, headers=headers).status_code == 200

    for title, status in (
        ("未开始任务", "todo"),
        ("受阻任务", "in_progress"),
        ("待确认任务", "pending_verification"),
        ("已完成任务", "done"),
    ):
        response = client.post(
            f"/api/projects/{project_id}/stages/{primary['id']}/tasks",
            headers=headers,
            json={"project_id": project_id, "stage_id": primary["id"], "title": title, "status": status},
        )
        assert response.status_code == 201

    session = get_session()
    try:
        blocked = session.scalars(select(Task).where(Task.project_id == project_id, Task.title == "受阻任务")).one()
        blocked.status = "blocked"
        primary_row = session.get(Stage, primary["id"])
        primary_row.status = "pending_acceptance"
        session.commit()
    finally:
        session.close()

    response = client.get(f"/api/projects/{project_id}/overview", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["project"]["name"] == "总览项目"
    assert [owner["id"] for owner in body["owners"]] == ["overview-owner"]
    assert body["planned_start"] == "2026-08-01"
    assert body["planned_end"] == "2026-09-10"
    assert body["overall_status"] == "pending_acceptance"
    assert body["primary_stage"]["id"] == primary["id"]
    assert [stage["id"] for stage in body["parallel_stages"]] == [parallel["id"]]
    assert body["metrics"] == {
        "open_tasks": 3,
        "blocked_tasks": 1,
        "pending_acceptance_stages": 1,
    }
    assert body["recent_activities"]
    assert all(item["created_by_name"] for item in body["recent_activities"])


def test_project_overview_status_for_all_planned_and_all_completed(client):
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "status-owner"},
        json={"name": "状态项目", "stages": [{"name": "一"}, {"name": "二"}]},
    ).json()
    project_id = project["id"]
    headers = {"X-User-Id": "status-owner"}
    assert client.get(f"/api/projects/{project_id}/overview", headers=headers).json()["overall_status"] == "planned"

    session = get_session()
    try:
        for stage in session.scalars(select(Stage).where(Stage.project_id == project_id)):
            stage.status = "completed"
        session.commit()
    finally:
        session.close()
    assert client.get(f"/api/projects/{project_id}/overview", headers=headers).json()["overall_status"] == "completed"


def test_project_risks_show_blockers_and_overdue_high_priority_work(client):
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "risk-owner"},
        json={"name": "风险项目", "stages": [{"name": "交付阶段", "planned_end": yesterday}]},
    ).json()
    project_id = project["id"]
    headers = {"X-User-Id": "risk-owner"}
    stage = client.get(f"/api/projects/{project_id}/stages", headers=headers).json()[0]
    assert client.post(f"/api/projects/{project_id}/stages/{stage['id']}/start", json={}, headers=headers).status_code == 200

    task_specs = (
        ("紧急受阻任务", "urgent", "blocked", None),
        ("普通受阻任务", "normal", "blocked", None),
        ("紧急逾期任务", "urgent", "todo", yesterday),
    )
    for title, priority, status, planned_date in task_specs:
        payload = {
            "project_id": project_id,
            "stage_id": stage["id"],
            "title": title,
            "priority": priority,
            "status": status,
        }
        if planned_date:
            payload["planned_date"] = planned_date
        assert client.post(f"/api/projects/{project_id}/stages/{stage['id']}/tasks", json=payload, headers=headers).status_code == 201

    blocker_created_at = (date.today() - timedelta(days=3)).isoformat()
    session = get_session()
    try:
        tasks = {
            task.title: task
            for task in session.scalars(select(Task).where(Task.project_id == project_id))
        }
        for title in ("紧急受阻任务", "普通受阻任务"):
            session.add(
                TaskBlocker(
                    task_id=tasks[title].id,
                    reason=f"{title}的原因",
                    handler_id="risk-owner",
                    created_by="risk-owner",
                    created_at=blocker_created_at,
                )
            )
        session.add(
            StageBlocker(
                stage_id=stage["id"],
                reason="环境审批未完成",
                handler_id="risk-owner",
                created_by="risk-owner",
                created_at=blocker_created_at,
            )
        )
        session.commit()
    finally:
        session.close()

    response = client.get(f"/api/projects/{project_id}/risks", headers=headers)
    assert response.status_code == 200
    risks = response.json()
    assert {risk["kind"] for risk in risks} == {
        "stage_blocker",
        "task_blocker",
        "overdue_stage",
        "overdue_task",
    }
    assert all("普通受阻任务" not in risk["title"] for risk in risks)
    task_blocker = next(risk for risk in risks if risk["kind"] == "task_blocker")
    assert task_blocker["title"] == "紧急受阻任务 受阻"
    assert task_blocker["detail"] == "紧急受阻任务的原因"
    assert task_blocker["owner_name"] == "risk-owner"
    assert task_blocker["duration_days"] == 3
    overdue_task = next(risk for risk in risks if risk["kind"] == "overdue_task")
    assert overdue_task["title"] == "紧急逾期任务 逾期"
    assert overdue_task["overdue_days"] == 1
    overdue_stage = next(risk for risk in risks if risk["kind"] == "overdue_stage")
    assert overdue_stage["stage_id"] == stage["id"]
    assert overdue_stage["overdue_days"] == 1


def test_project_activities_support_filters_links_and_descending_order(client):
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "activity-owner"},
        json={"name": "活动项目", "stages": [{"name": "开发阶段"}]},
    ).json()
    project_id = project["id"]
    owner = {"X-User-Id": "activity-owner"}
    member = {"X-User-Id": "activity-member"}
    stage = client.get(f"/api/projects/{project_id}/stages", headers=owner).json()[0]
    assert client.post(f"/api/projects/{project_id}/stages/{stage['id']}/start", json={}, headers=owner).status_code == 200
    assert client.post(
        f"/api/projects/{project_id}/members",
        headers=owner,
        json={"user_id": "activity-member", "name": "活动成员", "email": "activity-member@test.local"},
    ).status_code == 200
    created_task = client.post(
        f"/api/projects/{project_id}/stages/{stage['id']}/tasks",
        headers=member,
        json={"project_id": project_id, "stage_id": stage["id"], "title": "活动任务"},
    )
    assert created_task.status_code == 201

    response = client.get(f"/api/projects/{project_id}/activities", headers=owner)
    assert response.status_code == 200
    activities = response.json()
    assert len(activities) >= 4
    assert [item["id"] for item in activities] == sorted([item["id"] for item in activities], reverse=True)
    assert all(
        {"created_by_name", "created_at", "description", "stage_name", "target_deleted"} <= set(item)
        for item in activities
    )

    by_type = client.get(
        f"/api/projects/{project_id}/activities", headers=owner, params={"type": "task_created"}
    ).json()
    assert [item["type"] for item in by_type] == ["task_created"]
    assert by_type[0]["created_by"] == "activity-member"
    assert by_type[0]["created_by_name"] == "活动成员"
    assert by_type[0]["stage_id"] == stage["id"]
    assert by_type[0]["stage_name"] == "开发阶段"
    assert by_type[0]["task_id"] == created_task.json()["id"]
    assert by_type[0]["target_deleted"] is False

    by_operator = client.get(
        f"/api/projects/{project_id}/activities", headers=owner, params={"created_by": "activity-member"}
    ).json()
    assert by_operator
    assert {item["created_by"] for item in by_operator} == {"activity-member"}

    by_stage = client.get(
        f"/api/projects/{project_id}/activities", headers=owner, params={"stage_id": stage["id"]}
    ).json()
    assert {item["type"] for item in by_stage} == {"stage_started", "task_created"}


def test_project_overview_risks_and_activities_require_membership(client):
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "private-owner"},
        json={"name": "私有项目", "stages": [{"name": "阶段"}]},
    ).json()
    headers = {"X-User-Id": "not-a-member"}
    for path in ("overview", "risks", "activities"):
        response = client.get(f"/api/projects/{project['id']}/{path}", headers=headers)
        assert response.status_code == 403
