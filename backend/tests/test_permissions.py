"""Test server-side permission enforcement."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db.database import init_db
from app.routers.projects import router as projects_router
from app.routers.stages import router as stages_router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "permissions.db"))
    init_db(seed=False)
    api = FastAPI()
    api.include_router(projects_router)
    api.include_router(stages_router)
    return TestClient(api)


def test_non_member_cannot_read_project(client):
    """Test that non-members get 403 when accessing project resources."""
    # Create project as owner
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner"},
        json={"name": "权限测试项目"},
    ).json()
    project_id = project["id"]

    # Try to access as non-member
    response = client.get(f"/api/projects/{project_id}", headers={"X-User-Id": "outsider"})
    assert response.status_code == 403

    # Try to access members list
    response = client.get(f"/api/projects/{project_id}/members", headers={"X-User-Id": "outsider"})
    assert response.status_code == 403

    # Try to access stages
    response = client.get(f"/api/projects/{project_id}/stages", headers={"X-User-Id": "outsider"})
    assert response.status_code == 403


def test_observer_cannot_write(client):
    """Test that observers can only read, not write."""
    # Create project
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner"},
        json={"name": "观察者权限测试"},
    ).json()
    project_id = project["id"]

    # Add observer
    client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner"},
        json={"user_id": "observer", "name": "观察者", "email": "observer@test.local", "role": "observer"},
    )

    # Observer can read
    response = client.get(f"/api/projects/{project_id}", headers={"X-User-Id": "observer"})
    assert response.status_code == 200

    # Observer cannot add members
    response = client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "observer"},
        json={"user_id": "new-member", "name": "新成员", "email": "new@test.local"},
    )
    assert response.status_code == 403

    # Observer cannot modify project
    response = client.patch(
        f"/api/projects/{project_id}",
        headers={"X-User-Id": "observer"},
        json={"name": "修改后的名称"},
    )
    assert response.status_code == 403

    # Observer cannot add stages
    response = client.post(
        f"/api/projects/{project_id}/stages",
        headers={"X-User-Id": "observer"},
        json={"name": "新阶段"},
    )
    assert response.status_code == 403


def test_member_cannot_manage_members(client):
    """Test that regular members cannot add/remove members or change roles."""
    # Create project
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner"},
        json={"name": "成员权限测试"},
    ).json()
    project_id = project["id"]

    # Add regular member
    client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner"},
        json={"user_id": "member", "name": "成员", "email": "member@test.local", "role": "member"},
    )

    # Member cannot add other members
    response = client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "member"},
        json={"user_id": "new-member", "name": "新成员", "email": "new@test.local"},
    )
    assert response.status_code == 403

    # Member cannot change roles
    response = client.patch(
        f"/api/projects/{project_id}/members/member",
        headers={"X-User-Id": "member"},
        json={"role": "owner"},
    )
    assert response.status_code == 403

    # Member cannot remove members
    response = client.delete(
        f"/api/projects/{project_id}/members/owner",
        headers={"X-User-Id": "member"},
    )
    assert response.status_code == 403


def test_member_cannot_manage_stage_structure(client):
    """Test that regular members cannot add/delete/reorder stages."""
    # Create project
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner"},
        json={"name": "阶段权限测试"},
    ).json()
    project_id = project["id"]

    # Add member
    client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner"},
        json={"user_id": "member", "name": "成员", "email": "member@test.local", "role": "member"},
    )

    # Get stage
    stages = client.get(f"/api/projects/{project_id}/stages", headers={"X-User-Id": "owner"}).json()
    stage_id = stages[0]["id"]

    # Member cannot add stage
    response = client.post(
        f"/api/projects/{project_id}/stages",
        headers={"X-User-Id": "member"},
        json={"name": "新阶段"},
    )
    assert response.status_code == 403

    # Member cannot delete stage
    response = client.delete(
        f"/api/projects/{project_id}/stages/{stage_id}?confirm=true",
        headers={"X-User-Id": "member"},
    )
    assert response.status_code == 403

    # Member cannot assign stage owner
    response = client.patch(
        f"/api/projects/{project_id}/stages/{stage_id}/owner",
        headers={"X-User-Id": "member"},
        json={"owner_id": "member"},
    )
    assert response.status_code == 403


def test_only_project_owner_can_start_stages(client):
    """Test that only project owners can start stages."""
    # Create project
    project = client.post(
        "/api/projects",
        headers={"X-User-Id": "owner"},
        json={"name": "启动权限测试"},
    ).json()
    project_id = project["id"]

    # Add member
    client.post(
        f"/api/projects/{project_id}/members",
        headers={"X-User-Id": "owner"},
        json={"user_id": "member", "name": "成员", "email": "member@test.local", "role": "member"},
    )

    # Get stage
    stages = client.get(f"/api/projects/{project_id}/stages", headers={"X-User-Id": "owner"}).json()
    stage_id = stages[0]["id"]

    # Member cannot start stage
    response = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/start",
        headers={"X-User-Id": "member"},
        json={},
    )
    assert response.status_code == 403

    # Owner can start stage
    response = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/start",
        headers={"X-User-Id": "owner"},
        json={},
    )
    assert response.status_code == 200
