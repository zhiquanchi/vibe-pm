from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db.database import get_connection, init_db
from app.routers.scope_changes import router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_PM_DB_PATH", str(tmp_path / "scope.sqlite"))
    init_db(seed=False)
    conn = get_connection()
    start = date.today() - timedelta(days=2)
    conn.execute("INSERT INTO projects(id,name,created_at) VALUES(1,'项目','now')")
    conn.execute(
        "INSERT INTO sprints(id,project_id,name,start_date,end_date,status,initial_points,created_at) VALUES(1,1,'Sprint',?,?,'active',10,'now')",
        (start.isoformat(), (start + timedelta(days=13)).isoformat()),
    )
    conn.execute("INSERT INTO tasks(id,project_id,sprint_id,title,status,story_points,created_at,updated_at) VALUES(1,1,1,'原任务','todo',10,'now','now')")
    conn.commit()
    conn.close()
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
    conn = get_connection()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    conn.execute("INSERT INTO sprint_snapshots(sprint_id,snapshot_date,total_scope,completed_points,remaining_points,ideal_completed,ideal_remaining) VALUES(1,?,?, ?,?,?,?)", (yesterday, 99, 1, 98, 2, 8))
    conn.commit()
    conn.close()
    first = client.post('/api/sprints/1/snapshots/generate').json()
    second = client.post('/api/sprints/1/snapshots/generate').json()
    assert first['id'] == second['id']
    conn = get_connection()
    old = conn.execute("SELECT total_scope,completed_points FROM sprint_snapshots WHERE sprint_id=1 AND snapshot_date=?", (yesterday,)).fetchone()
    count = conn.execute("SELECT COUNT(*) FROM sprint_snapshots WHERE sprint_id=1 AND snapshot_date=?", (date.today().isoformat(),)).fetchone()[0]
    conn.close()
    assert tuple(old) == (99.0, 1.0)
    assert count == 1


def test_scope_transaction_rolls_back_task_and_log_when_snapshot_fails(client, monkeypatch):
    import app.services.scope_changes as service
    from app.schemas.scope_changes import ScopeChangeCommand

    def fail_snapshot(*args, **kwargs):
        raise RuntimeError('snapshot failure')

    monkeypatch.setattr(service, 'snapshot', fail_snapshot)
    conn = get_connection()
    with pytest.raises(RuntimeError):
        service.apply_scope_change(conn, 1, ScopeChangeCommand(type='add_task', title='必须回滚', story_points=3))
    conn = get_connection()
    assert conn.execute("SELECT COUNT(*) FROM tasks WHERE title='必须回滚'").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM scope_changes").fetchone()[0] == 0
    conn.close()
