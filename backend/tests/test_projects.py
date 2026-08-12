from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db.database import init_db
from app.routers.projects import router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "projects.db"))
    init_db(seed=False)
    api = FastAPI()
    api.include_router(router)
    return TestClient(api)


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
