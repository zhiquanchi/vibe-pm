from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.database import get_session, init_db
from app.db.models import (
    Profile,
    Project,
    ProjectActivity,
    ProjectMember,
    Stage,
    StageBlocker,
    Task,
    TaskBlocker,
    TaskDependency,
)
from app.routers.copilot import router as copilot_router
from app.routers.projects import router as projects_router
from app.routers.stages import router as stages_router
from app.routers.tasks import router as tasks_router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "copilot.db"))
    init_db(seed=False)
    api = FastAPI()
    api.include_router(projects_router)
    api.include_router(stages_router)
    api.include_router(tasks_router)
    api.include_router(copilot_router)
    return TestClient(api)


def seed_base_project() -> int:
    now = datetime.utcnow().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    with get_session() as session:
        for user_id, name in (("owner", "项目负责人"), ("handler", "处理人"), ("member", "成员")):
            session.add(Profile(id=user_id, name=name, email=f"{user_id}@test.local", created_at=now))
        project = Project(name="支付中台", description="支付能力升级", created_at=now)
        session.add(project)
        session.flush()
        session.add(ProjectMember(project_id=project.id, user_id="owner", role="owner"))
        primary = Stage(
            project_id=project.id,
            name="开发阶段",
            position=0,
            owner_id="owner",
            planned_start=(date.today() - timedelta(days=10)).isoformat(),
            planned_end=yesterday,
            status="active",
            is_primary=True,
            created_at=now,
        )
        parallel = Stage(
            project_id=project.id,
            name="测试阶段",
            position=1,
            owner_id="member",
            status="active",
            is_primary=False,
            created_at=now,
        )
        session.add_all([primary, parallel])
        session.flush()
        blocked = Task(
            project_id=project.id,
            stage_id=primary.id,
            title="接入支付通道",
            status="blocked",
            assignee="member",
            planned_date=yesterday,
            created_at=now,
            updated_at=now,
        )
        dependency_target = Task(
            project_id=project.id,
            stage_id=primary.id,
            title="定义支付接口",
            status="todo",
            assignee="owner",
            created_at=now,
            updated_at=now,
        )
        session.add_all([blocked, dependency_target])
        session.flush()
        session.add(
            TaskBlocker(
                task_id=blocked.id,
                reason="等待渠道证书",
                handler_id="handler",
                created_by="owner",
                created_at=(datetime.utcnow() - timedelta(days=3)).isoformat(),
            )
        )
        session.add(TaskDependency(task_id=blocked.id, dependency_id=dependency_target.id, created_at=now))
        session.commit()
        return project.id


def test_copilot_summary_primary_stage_risks_actions_and_realtime_refresh(client):
    project_id = seed_base_project()
    response = client.post(f"/api/projects/{project_id}/copilot/summary", headers={"X-User-Id": "owner"})
    assert response.status_code == 200
    body = response.json()

    assert body["project_name"] == "支付中台"
    assert body["primary_stage"]["name"] == "开发阶段"
    assert body["primary_stage"]["owner_name"] == "项目负责人"
    assert [item["name"] for item in body["parallel_stages"]] == ["测试阶段"]
    risk_text = "\n".join(item["text"] for item in body["risks"])
    assert "主阶段「开发阶段」" in risk_text
    assert "等待渠道证书" in risk_text
    assert "处理人：处理人" in risk_text
    assert "持续 3 天" in risk_text
    assert "已逾期" in risk_text
    assert "等待未完成前置任务「定义支付接口」" in risk_text
    assert all(item["link_path"] for item in body["risks"])
    assert len(body["actions"]) <= 5
    assert [item["order"] for item in body["actions"]] == list(range(1, len(body["actions"]) + 1))
    assert all(item["reason"] for item in body["actions"])

    with get_session() as session:
        stage = session.scalars(select_stage_by_project(project_id)).first()
        session.add(
            StageBlocker(
                stage_id=stage.id,
                reason="测试环境不可用",
                handler_id="handler",
                created_by="owner",
                created_at=datetime.utcnow().isoformat(),
            )
        )
        session.commit()

    refreshed = client.post(f"/api/projects/{project_id}/copilot/summary", headers={"X-User-Id": "owner"}).json()
    refreshed_text = "\n".join(item["text"] for item in refreshed["risks"])
    assert "测试环境不可用" in refreshed_text


def select_stage_by_project(project_id: int):
    from sqlalchemy import select

    return select(Stage).where(Stage.project_id == project_id)


def test_copilot_summary_empty_project(client):
    now = datetime.utcnow().isoformat()
    with get_session() as session:
        session.add(Profile(id="empty-owner", name="空项目负责人", email="empty@test.local", created_at=now))
        project = Project(name="空项目", created_at=now)
        session.add(project)
        session.flush()
        session.add(ProjectMember(project_id=project.id, user_id="empty-owner", role="owner"))
        session.add(Stage(project_id=project.id, name="需求分析", position=0, status="planned", created_at=now))
        session.commit()
        project_id = project.id

    body = client.post(
        f"/api/projects/{project_id}/copilot/summary", headers={"X-User-Id": "empty-owner"}
    ).json()
    assert body["primary_stage"] is None
    assert body["parallel_stages"] == []
    assert body["insufficient_data"] is True
    assert body["risks"][0]["text"] == "项目尚未启动，数据不足"
    assert body["actions"] == []


def test_copilot_stage_analysis_distinguishes_facts_inference_suggestion(client):
    project_id = seed_base_project()
    stage_id = get_primary_stage_id(project_id)
    response = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/copilot/analysis",
        headers={"X-User-Id": "owner"},
    )
    assert response.status_code == 200
    body = response.json()
    kinds = {item["kind"] for item in body["items"]}
    text = "\n".join(item["text"] for item in body["items"])

    assert body["has_risk"] is True
    assert {"fact", "inference", "suggestion"} <= kinds
    assert "未解除阻塞" in text
    assert "已逾期" in text
    assert "等待未完成前置任务" in text
    assert "没有负责人" not in text  # seed 中阻塞任务和前置任务均有负责人
    assert "信息不足，无法判断" in text
    assert "需要您确认执行" in text
    assert all(item["link_path"] for item in body["items"] if item["kind"] == "fact")
    assert all(not item["link_path"] for item in body["items"] if item["kind"] == "inference")


def test_copilot_stage_analysis_no_risk_and_no_mutation(client):
    project_id = seed_base_project()
    stage_id = get_primary_stage_id(project_id)
    now = datetime.utcnow().isoformat()
    with get_session() as session:
        stage = session.get(Stage, stage_id)
        stage.status = "active"
        stage.planned_end = date.today().isoformat()
        session.query(Task).filter(Task.stage_id == stage_id).update(
            {"status": "in_progress", "assignee": "member", "planned_date": date.today().isoformat()},
            synchronize_session=False,
        )
        for blocker in session.query(TaskBlocker).all():
            blocker.resolved_at = now
        for dependency in session.query(TaskDependency).all():
            session.delete(dependency)
        session.commit()

    body = client.post(
        f"/api/projects/{project_id}/stages/{stage_id}/copilot/analysis",
        headers={"X-User-Id": "owner"},
    ).json()
    assert body["has_risk"] is False
    assert any("当前未发现该阶段的风险" in item["text"] for item in body["items"])
    with get_session() as session:
        assert all(task.status == "in_progress" for task in session.query(Task).filter_by(stage_id=stage_id).all())


def get_primary_stage_id(project_id: int) -> int:
    with get_session() as session:
        from sqlalchemy import select

        return session.scalars(
            select(Stage).where(Stage.project_id == project_id, Stage.is_primary.is_(True))
        ).one().id


def test_copilot_personal_advice_priority_and_permission_boundary(client):
    now = datetime.utcnow().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    with get_session() as session:
        for user_id in ("owner", "member", "hidden-owner"):
            session.add(Profile(id=user_id, name=user_id, email=f"{user_id}@test.local", created_at=now))
        visible = Project(name="可见项目", created_at=now)
        hidden = Project(name="无权项目", created_at=now)
        session.add_all([visible, hidden])
        session.flush()
        session.add(ProjectMember(project_id=visible.id, user_id="owner", role="owner"))
        session.add(ProjectMember(project_id=visible.id, user_id="member", role="member"))
        session.add(ProjectMember(project_id=hidden.id, user_id="hidden-owner", role="owner"))
        primary = Stage(project_id=visible.id, name="主阶段", position=0, status="active", is_primary=True, created_at=now)
        normal = Stage(project_id=visible.id, name="普通阶段", position=1, status="active", created_at=now)
        hidden_stage = Stage(project_id=hidden.id, name="隐藏阶段", position=0, status="active", is_primary=True, created_at=now)
        session.add_all([primary, normal, hidden_stage])
        session.flush()
        blocked = Task(project_id=visible.id, stage_id=normal.id, title="受阻任务", status="blocked", assignee="member", created_at=now, updated_at=now)
        overdue = Task(project_id=visible.id, stage_id=normal.id, title="逾期任务", status="todo", assignee="member", planned_date=yesterday, created_at=now, updated_at=now)
        primary_task = Task(project_id=visible.id, stage_id=primary.id, title="主阶段任务", status="todo", assignee="member", created_at=now, updated_at=now)
        hidden_task = Task(project_id=hidden.id, stage_id=hidden_stage.id, title="无权任务", status="blocked", assignee="member", created_at=now, updated_at=now)
        session.add_all([blocked, overdue, primary_task, hidden_task])
        session.flush()
        session.add(TaskBlocker(task_id=blocked.id, reason="等待审批", handler_id="owner", created_by="owner", created_at=now))
        session.commit()

    response = client.get("/api/my-tasks/copilot/advice", headers={"X-User-Id": "member"})
    assert response.status_code == 200
    advice = response.json()
    assert [item["task_title"] for item in advice] == ["受阻任务", "逾期任务", "主阶段任务"]
    assert advice[0]["reason"] == "任务受阻：等待审批（处理人：owner）"
    assert advice[1]["reason"] == "任务已逾期 1 天"
    assert advice[2]["reason"] == "该任务属于项目当前主推进方向"
    assert advice[0]["link_path"].startswith("/projects/")
    assert all(item["project_name"] != "无权项目" for item in advice)

    empty = client.get("/api/my-tasks/copilot/advice", headers={"X-User-Id": "owner"})
    assert empty.json() == []


def test_copilot_chat_answers_project_questions_and_refusals(client):
    project_id = seed_base_project()
    now = datetime.utcnow().isoformat()
    with get_session() as session:
        session.add(
            ProjectActivity(
                project_id=project_id,
                type="task_status_changed",
                description="任务「定义支付接口」状态 未开始 → 进行中",
                created_by="owner",
                created_at=now,
            )
        )
        session.commit()

    status = client.post(
        f"/api/projects/{project_id}/copilot/chat",
        headers={"X-User-Id": "owner"},
        json={"question": "项目现在是什么状态", "history": []},
    ).json()
    assert "支付中台" in status["content"]
    assert "主阶段「开发阶段」" in status["content"]
    assert status["links"][0]["path"] == f"/projects/{project_id}"

    stage = client.post(
        f"/api/projects/{project_id}/copilot/chat",
        headers={"X-User-Id": "owner"},
        json={"question": "开发阶段进展如何", "history": []},
    ).json()
    assert "阶段「开发阶段」" in stage["content"]
    assert stage["links"][0]["path"] == f"/projects/{project_id}/stages/{get_primary_stage_id(project_id)}"

    dependency = client.post(
        f"/api/projects/{project_id}/copilot/chat",
        headers={"X-User-Id": "owner"},
        json={"question": "任务 接入支付通道 被什么任务阻塞", "history": []},
    ).json()
    assert "「定义支付接口」" in dependency["content"]
    assert "等待渠道证书" in dependency["content"]

    recent = client.post(
        f"/api/projects/{project_id}/copilot/chat",
        headers={"X-User-Id": "owner"},
        json={"question": "最近 3 天项目有什么变化", "history": []},
    ).json()
    assert "状态 未开始 → 进行中" in recent["content"]

    followup = client.post(
        f"/api/projects/{project_id}/copilot/chat",
        headers={"X-User-Id": "owner"},
        json={
            "question": "它呢",
            "history": [{"role": "user", "content": "开发阶段进展如何"}],
        },
    ).json()
    assert "阶段「开发阶段」" in followup["content"]

    off_topic = client.post(
        f"/api/projects/{project_id}/copilot/chat",
        headers={"X-User-Id": "owner"},
        json={"question": "今天天气如何", "history": []},
    ).json()
    assert off_topic["content"] == "该问题超出项目管理副驾驶职责范围，无法回答"

    missing = client.post(
        f"/api/projects/{project_id}/copilot/chat",
        headers={"X-User-Id": "owner"},
        json={"question": "任务 火星任务 是什么状态", "history": []},
    ).json()
    assert missing["content"] == "项目记录中没有相关信息"

    acceptance = client.post(
        f"/api/projects/{project_id}/copilot/chat",
        headers={"X-User-Id": "owner"},
        json={"question": "帮我确认这个阶段验收", "history": []},
    ).json()
    assert acceptance["content"] == "我无法代替您执行验收操作，验收需要由项目负责人确认"

    mutation = client.post(
        f"/api/projects/{project_id}/copilot/chat",
        headers={"X-User-Id": "owner"},
        json={"question": "帮我把任务 支付通道 改为已完成", "history": []},
    ).json()
    assert mutation["content"] == "我无法自动修改项目数据，请您在任务详情中手动更新状态"
    with get_session() as session:
        assert not any(task.title == "支付通道" and task.status == "done" for task in session.query(Task).all())


def test_copilot_chat_rejects_unauthorized_project_name(client):
    project_id = seed_base_project()
    now = datetime.utcnow().isoformat()
    with get_session() as session:
        session.add(Profile(id="other-owner", name="其他负责人", email="other@test.local", created_at=now))
        hidden = Project(name="机密项目", created_at=now)
        session.add(hidden)
        session.flush()
        session.add(ProjectMember(project_id=hidden.id, user_id="other-owner", role="owner"))
        session.commit()

    body = client.post(
        f"/api/projects/{project_id}/copilot/chat",
        headers={"X-User-Id": "owner"},
        json={"question": "机密项目现在是什么状态", "history": []},
    ).json()
    assert body["content"] == "您没有访问该项目的权限，无法回答"


def test_copilot_changes_categories_ranges_deleted_objects_and_empty_state(client):
    project_id = seed_base_project()
    now_dt = datetime.utcnow()
    now = now_dt.isoformat()
    with get_session() as session:
        task = session.scalars(
            select_first_task_by_project(project_id)
        ).first()
        # Move the seeded unresolved blocker into the 24h window so it shows up
        # as both an unresolved item and a newly appeared risk.
        blocker = session.scalars(
            select(TaskBlocker).where(TaskBlocker.task_id == task.id, TaskBlocker.resolved_at.is_(None))
        ).first()
        if blocker is not None:
            blocker.created_at = now
        resolved = TaskBlocker(
            task_id=task.id,
            reason="旧阻塞",
            handler_id="owner",
            created_by="owner",
            created_at=now,
            resolved_at=now,
            resolution="已处理",
        )
        session.add(resolved)
        session.flush()
        session.add_all(
            [
                ProjectActivity(
                    project_id=project_id,
                    type="task_blocker_resolved",
                    description="任务「接入支付通道」阻塞已解除：已处理",
                    created_by="owner",
                    created_at=now,
                ),
                ProjectActivity(
                    project_id=project_id,
                    type="task_deleted",
                    description="删除任务「旧任务」",
                    created_by="owner",
                    created_at=now,
                ),
                ProjectActivity(
                    project_id=project_id,
                    type="member_added",
                    description="添加成员「新成员」",
                    created_by="owner",
                    created_at=(now_dt - timedelta(days=4)).isoformat(),
                ),
            ]
        )
        session.commit()

    day = client.get(
        f"/api/projects/{project_id}/copilot/changes?range=24h", headers={"X-User-Id": "owner"}
    ).json()
    assert any("阻塞已解除" in item["text"] for item in day["completed"])
    assert any(item["text"].startswith("对象已删除：") and item["link_path"] is None for item in day["completed"])
    assert not any("添加成员「新成员」" in item["text"] for item in day["completed"])
    assert any("仍未解决：任务「接入支付通道」阻塞待处理" in item["text"] for item in day["unresolved"])
    assert any("新出现风险：任务「接入支付通道」" in item["text"] for item in day["new_risks"])

    week = client.get(
        f"/api/projects/{project_id}/copilot/changes?range=7d", headers={"X-User-Id": "owner"}
    ).json()
    assert any("添加成员「新成员」" in item["text"] for item in week["completed"])

    invalid = client.get(
        f"/api/projects/{project_id}/copilot/changes?range=90d", headers={"X-User-Id": "owner"}
    )
    assert invalid.status_code == 422

    now = datetime.utcnow().isoformat()
    with get_session() as session:
        empty = Project(name="无活动项目", created_at=now)
        session.add(empty)
        session.flush()
        session.add(ProjectMember(project_id=empty.id, user_id="owner", role="owner"))
        session.commit()
        empty_id = empty.id
    empty_body = client.get(
        f"/api/projects/{empty_id}/copilot/changes?range=30d", headers={"X-User-Id": "owner"}
    ).json()
    assert empty_body == {"completed": [], "unresolved": [], "new_risks": []}


def select_first_task_by_project(project_id: int):
    from sqlalchemy import select

    return select(Task).where(Task.project_id == project_id).order_by(Task.id)


def test_copilot_project_endpoints_require_membership(client):
    project_id = seed_base_project()
    stage_id = get_primary_stage_id(project_id)
    headers = {"X-User-Id": "outsider"}
    assert client.post(f"/api/projects/{project_id}/copilot/summary", headers=headers).status_code == 403
    assert (
        client.post(
            f"/api/projects/{project_id}/stages/{stage_id}/copilot/analysis", headers=headers
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/projects/{project_id}/copilot/chat", headers=headers, json={"question": "项目状态"}
        ).status_code
        == 403
    )
    assert (
        client.get(f"/api/projects/{project_id}/copilot/changes?range=24h", headers=headers).status_code
        == 403
    )
