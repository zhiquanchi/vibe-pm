from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db.database import get_session, init_db
from app.db.models import Project, ScopeChange, Sprint, SprintSnapshot, Task
from app.routers.scope_changes import router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "scope.sqlite"))
    init_db(seed=False)
    session = get_session()
    start = date.today() - timedelta(days=2)
    session.add(Project(id=1, name="项目", created_at="now"))
    session.add(
        Sprint(id=1, project_id=1, name="Sprint", start_date=start.isoformat(), end_date=(start + timedelta(days=13)).isoformat(), status="active", initial_points=10, created_at="now")
    )
    session.add(Task(id=1, project_id=1, sprint_id=1, title="原任务", status="todo", story_points=10, created_at="now", updated_at="now"))
    session.commit()
    session.close()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_add_remove_change_points_and_capacity_warning(client):
    added = client.post('/api/sprints/1/scope-changes', json={'type': 'add_task', 'title': '新增需求', 'story_points': 3, 'reason': '老板要求'} )
    assert added.status_code == 201
    body = added.json()
    assert body['scope_change']['points_delta'] == 3
    assert body['snapshot']['total_scope'] == 13
    assert body['capacity_warning'] == '范围已增加 3 pt，当前容量可能不足'

    changed = client.post('/api/sprints/1/scope-changes', json={'type': 'change_points', 'task_id': 1, 'story_points': 8})
    assert changed.status_code == 201
    assert changed.json()['scope_change']['points_delta'] == -2

    removed = client.post('/api/sprints/1/scope-changes', json={'type': 'remove_task', 'task_id': 1, 'reason': '取消'})
    assert removed.status_code == 201
    assert removed.json()['scope_change']['points_delta'] == -8
    assert removed.json()['task']['sprint_id'] is None


def test_snapshot_generation_is_idempotent_and_preserves_history(client):
    session = get_session()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    session.add(SprintSnapshot(sprint_id=1, snapshot_date=yesterday, total_scope=99, completed_points=1, remaining_points=98, ideal_completed=2, ideal_remaining=8))
    session.commit()
    session.close()
    first = client.post('/api/sprints/1/snapshots/generate').json()
    second = client.post('/api/sprints/1/snapshots/generate').json()
    assert first['id'] == second['id']
    session = get_session()
    old = session.execute(
        select(SprintSnapshot.total_scope, SprintSnapshot.completed_points).where(SprintSnapshot.sprint_id == 1, SprintSnapshot.snapshot_date == yesterday)
    ).first()
    count = session.scalar(
        select(func.count()).select_from(SprintSnapshot).where(SprintSnapshot.sprint_id == 1, SprintSnapshot.snapshot_date == date.today().isoformat())
    )
    session.close()
    assert tuple(old) == (99.0, 1.0)
    assert count == 1


def test_scope_transaction_rolls_back_task_and_log_when_snapshot_fails(client, monkeypatch):
    import app.services.scope_changes as service
    from app.schemas.scope_changes import ScopeChangeCommand

    def fail_snapshot(*args, **kwargs):
        raise RuntimeError('snapshot failure')

    monkeypatch.setattr(service, 'snapshot', fail_snapshot)
    session = get_session()
    with pytest.raises(RuntimeError):
        service.apply_scope_change(session, 1, ScopeChangeCommand(type='add_task', title='必须回滚', story_points=3))
    session.close()
    session = get_session()
    assert session.scalar(select(func.count()).select_from(Task).where(Task.title == '必须回滚')) == 0
    assert session.scalar(select(func.count()).select_from(ScopeChange)) == 0
    session.close()
