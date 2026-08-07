from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.projects import router


test_app = FastAPI()
test_app.include_router(router)
client = TestClient(test_app)


def test_project_create_and_detail_membership():
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


def test_member_can_be_added_and_listed():
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
