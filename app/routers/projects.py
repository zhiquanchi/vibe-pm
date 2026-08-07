from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from app.core.identity import current_user_id
from app.db.database import get_connection
from app.schemas.projects import MemberCreate, ProjectCreate, ProjectUpdate
from app.services.common import rowdict

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _project_or_404(conn, project_id: int):
    project = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def require_project_member(project_id: int, user_id: str = Depends(current_user_id)) -> str:
    conn = get_connection()
    try:
        _project_or_404(conn, project_id)
        member = conn.execute(
            "SELECT 1 FROM project_members WHERE project_id=? AND user_id=?",
            (project_id, user_id),
        ).fetchone()
        if not member:
            raise HTTPException(status_code=403, detail="Project membership required")
        return user_id
    finally:
        conn.close()


@router.post("")
def create_project(payload: ProjectCreate, user_id: str = Depends(current_user_id)):
    conn = get_connection()
    try:
        now = datetime.utcnow().isoformat()
        # Development identities are provisioned on first use.
        conn.execute(
            "INSERT OR IGNORE INTO profiles(id,name,email,created_at) VALUES(?,?,?,?)",
            (user_id, user_id, f"{user_id}@local.invalid", now),
        )
        cursor = conn.execute(
            "INSERT INTO projects(name,description,created_at) VALUES(?,?,?)",
            (payload.name, payload.description, now),
        )
        project_id = cursor.lastrowid
        conn.execute(
            "INSERT INTO project_members(project_id,user_id,role) VALUES(?,?,?)",
            (project_id, user_id, "owner"),
        )
        conn.commit()
        return rowdict(conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())
    finally:
        conn.close()


@router.get("/{project_id}")
def project_detail(project_id: int, _user_id: str = Depends(require_project_member)):
    conn = get_connection()
    try:
        project = _project_or_404(conn, project_id)
        members = conn.execute(
            "SELECT p.id,p.name,p.email,p.avatar_url,pm.role FROM project_members pm JOIN profiles p ON p.id=pm.user_id WHERE pm.project_id=? ORDER BY pm.role,p.name",
            (project_id,),
        )
        return {"project": rowdict(project), "members": [rowdict(row) for row in members]}
    finally:
        conn.close()


@router.get("/{project_id}/members")
def list_members(project_id: int, _user_id: str = Depends(require_project_member)):
    conn = get_connection()
    try:
        _project_or_404(conn, project_id)
        rows = conn.execute(
            "SELECT p.id,p.name,p.email,p.avatar_url,pm.role FROM project_members pm JOIN profiles p ON p.id=pm.user_id WHERE pm.project_id=? ORDER BY p.name",
            (project_id,),
        )
        return [rowdict(row) for row in rows]
    finally:
        conn.close()


@router.post("/{project_id}/members")
def add_member(project_id: int, payload: MemberCreate, _user_id: str = Depends(require_project_member)):
    if payload.role not in {"owner", "member"}:
        raise HTTPException(status_code=422, detail="Invalid member role")
    conn = get_connection()
    try:
        _project_or_404(conn, project_id)
        owner = conn.execute("SELECT role FROM project_members WHERE project_id=? AND user_id=?", (project_id, _user_id)).fetchone()
        if not owner or owner[0] != "owner":
            raise HTTPException(status_code=403, detail="只有项目 Owner 可以添加成员")
        if conn.execute("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?", (project_id, payload.user_id)).fetchone():
            raise HTTPException(status_code=409, detail="该成员已经在项目中")
        now = datetime.utcnow().isoformat()
        conn.execute(
            "INSERT INTO profiles(id,name,email,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
            (payload.user_id, payload.name, payload.email, now),
        )
        conn.execute(
            "INSERT INTO project_members(project_id,user_id,role) VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role",
            (project_id, payload.user_id, payload.role),
        )
        conn.commit()
        row = conn.execute(
            "SELECT p.id,p.name,p.email,p.avatar_url,pm.role FROM project_members pm JOIN profiles p ON p.id=pm.user_id WHERE pm.project_id=? AND pm.user_id=?",
            (project_id, payload.user_id),
        ).fetchone()
        return rowdict(row)
    finally:
        conn.close()


@router.patch("/{project_id}")
def update_project(project_id: int, payload: ProjectUpdate, user_id: str = Depends(require_project_member)):
    conn = get_connection()
    try:
        _project_or_404(conn, project_id)
        role = conn.execute("SELECT role FROM project_members WHERE project_id=? AND user_id=?", (project_id, user_id)).fetchone()
        if not role or role[0] != "owner":
            raise HTTPException(status_code=403, detail="只有项目 Owner 可以修改设置")
        data = payload.model_dump(exclude_none=True)
        if data:
            values = list(data.values()) + [project_id]
            conn.execute(f"UPDATE projects SET {','.join(f'{key}=?' for key in data)} WHERE id=?", values)
            conn.commit()
        return rowdict(conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())
    finally:
        conn.close()
