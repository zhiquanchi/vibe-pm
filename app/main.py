from datetime import date, datetime, timedelta
from pathlib import Path
import sqlite3
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DB_PATH = Path(__file__).resolve().parents[1] / "vibe_pm.db"
app = FastAPI(title="Vibe PM API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def db():
    conn = sqlite3.connect(DB_PATH); conn.row_factory = sqlite3.Row; return conn

def init_db():
    conn = db(); conn.executescript("""
    CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sprints (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, goal TEXT, start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planning', initial_points REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, sprint_id INTEGER, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'todo', story_points REAL NOT NULL DEFAULT 1, priority TEXT NOT NULL DEFAULT 'P2', assignee TEXT, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scope_changes (id INTEGER PRIMARY KEY, sprint_id INTEGER NOT NULL, task_id INTEGER, type TEXT NOT NULL, description TEXT NOT NULL, points_delta REAL NOT NULL, reason TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sprint_snapshots (id INTEGER PRIMARY KEY, sprint_id INTEGER NOT NULL, snapshot_date TEXT NOT NULL, total_scope REAL NOT NULL, completed_points REAL NOT NULL, remaining_points REAL NOT NULL, UNIQUE(sprint_id, snapshot_date));
    """)
    if not conn.execute("SELECT 1 FROM projects LIMIT 1").fetchone():
        now=datetime.utcnow().isoformat(); conn.execute("INSERT INTO projects(name,description,created_at) VALUES(?,?,?)",("Vibe PM","Scope-aware project delivery",now)); pid=conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        start=date.today()-timedelta(days=7); end=start+timedelta(days=13); conn.execute("INSERT INTO sprints(project_id,name,goal,start_date,end_date,status,initial_points,created_at) VALUES(?,?,?,?,?,?,?,?)",(pid,"Sprint 14","Build the payment flow",start.isoformat(),end.isoformat(),"active",16,now)); sid=conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        tasks=[("Payment infrastructure","done",3,"P0","SM"),("WeChat Pay channel","in_progress",5,"P0","AL"),("Refund status sync","in_review",3,"P1","JK"),("Checkout result page","todo",2,"P2","SM"),("Reconciliation report","todo",3,"P2","AL"),("Order alerts","todo",2,"P1","JK"),("Conversion funnel","done",2,"P3","SM")]
        for i,(title,status,pts,priority,assignee) in enumerate(tasks): conn.execute("INSERT INTO tasks(project_id,sprint_id,title,status,story_points,priority,assignee,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",(pid,sid,title,status,pts,priority,assignee,i,now,now))
        for typ,desc,delta,reason,created in [("change_points","Sprint started",16,"Initial scope",start.isoformat()+"T09:00:00"),("add_task","Added WeChat Pay channel",5,"CEO request",(start+timedelta(days=2)).isoformat()+"T09:15:00"),("remove_task","Removed reconciliation report",-3,"Priority lowered",(start+timedelta(days=4)).isoformat()+"T14:30:00")]: conn.execute("INSERT INTO scope_changes(sprint_id,type,description,points_delta,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)",(sid,typ,desc,delta,reason,"demo",created))
    conn.commit(); conn.close()

def rowdict(row): return dict(row) if row else None
def snapshot(conn, sprint_id:int):
    total=conn.execute("SELECT COALESCE(SUM(story_points),0) FROM tasks WHERE sprint_id=?",(sprint_id,)).fetchone()[0]; progress={"done":1,"in_review":.8,"in_progress":.5,"todo":0}; completed=sum(r[0]*progress[r[1]] for r in conn.execute("SELECT story_points,status FROM tasks WHERE sprint_id=?",(sprint_id,)).fetchall()); today=date.today().isoformat(); conn.execute("INSERT INTO sprint_snapshots(sprint_id,snapshot_date,total_scope,completed_points,remaining_points) VALUES(?,?,?,?,?) ON CONFLICT(sprint_id,snapshot_date) DO UPDATE SET total_scope=excluded.total_scope,completed_points=excluded.completed_points,remaining_points=excluded.remaining_points",(sprint_id,today,total,completed,total-completed)); conn.commit()

@app.on_event("startup")
def startup(): init_db()

init_db()

class SprintCreate(BaseModel): name:str; goal:str|None=None; start_date:date; end_date:date
class TaskCreate(BaseModel): project_id:int=1; sprint_id:int|None=None; title:str; description:str|None=None; status:Literal['todo','in_progress','in_review','done']='todo'; story_points:int=Field(ge=1); priority:Literal['P0','P1','P2','P3']='P2'; assignee:str|None=None
class TaskUpdate(BaseModel): status:Literal['todo','in_progress','in_review','done']|None=None; title:str|None=None; story_points:int|None=Field(default=None,ge=1); priority:Literal['P0','P1','P2','P3']|None=None; assignee:str|None=None
class ScopeChangeCreate(BaseModel): task_id:int|None=None; type:Literal['add_task','remove_task','change_points']; description:str; points_delta:float; reason:str|None=None; created_by:str='current-user'

@app.get('/api/health')
def health(): return {"status":"ok"}
@app.get('/api/sprints')
def sprints():
    conn=db(); rows=conn.execute('SELECT * FROM sprints ORDER BY start_date DESC').fetchall(); conn.close(); return [rowdict(r) for r in rows]
@app.post('/api/sprints')
def create_sprint(payload:SprintCreate):
    if payload.end_date<payload.start_date: raise HTTPException(400,'end_date must be after start_date')
    conn=db(); now=datetime.utcnow().isoformat(); cur=conn.execute('INSERT INTO sprints(project_id,name,goal,start_date,end_date,created_at) VALUES(?,?,?,?,?,?)',(1,payload.name,payload.goal,payload.start_date.isoformat(),payload.end_date.isoformat(),now)); conn.commit(); row=conn.execute('SELECT * FROM sprints WHERE id=?',(cur.lastrowid,)).fetchone(); conn.close(); return rowdict(row)
@app.get('/api/sprints/{sprint_id}')
def sprint(sprint_id:int):
    conn=db(); sprint=conn.execute('SELECT * FROM sprints WHERE id=?',(sprint_id,)).fetchone()
    if not sprint: raise HTTPException(404,'Sprint not found')
    tasks=conn.execute('SELECT * FROM tasks WHERE sprint_id=? ORDER BY position,id',(sprint_id,)).fetchall(); changes=conn.execute('SELECT * FROM scope_changes WHERE sprint_id=? ORDER BY created_at DESC',(sprint_id,)).fetchall(); conn.close(); return {"sprint":rowdict(sprint),"tasks":[rowdict(x) for x in tasks],"scope_changes":[rowdict(x) for x in changes]}
@app.get('/api/tasks')
def tasks(sprint_id:int|None=None):
    conn=db(); query='SELECT * FROM tasks'; args=[]
    if sprint_id is not None: query+=' WHERE sprint_id=?'; args.append(sprint_id)
    rows=conn.execute(query+' ORDER BY position,id',args).fetchall(); conn.close(); return [rowdict(x) for x in rows]
@app.post('/api/tasks')
def create_task(payload:TaskCreate):
    conn=db(); now=datetime.utcnow().isoformat(); cur=conn.execute('INSERT INTO tasks(project_id,sprint_id,title,description,status,story_points,priority,assignee,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(payload.project_id,payload.sprint_id,payload.title,payload.description,payload.status,payload.story_points,payload.priority,payload.assignee,now,now)); conn.commit(); task=conn.execute('SELECT * FROM tasks WHERE id=?',(cur.lastrowid,)).fetchone();
    if payload.sprint_id: snapshot(conn,payload.sprint_id)
    conn.close(); return rowdict(task)
@app.patch('/api/tasks/{task_id}')
def update_task(task_id:int,payload:TaskUpdate):
    conn=db(); task=conn.execute('SELECT * FROM tasks WHERE id=?',(task_id,)).fetchone()
    if not task: raise HTTPException(404,'Task not found')
    data=payload.model_dump(exclude_none=True); old_points=task['story_points']; fields=[]; values=[]
    for key,val in data.items(): fields.append(f'{key}=?'); values.append(val)
    if fields: values.extend([datetime.utcnow().isoformat(),task_id]); conn.execute(f"UPDATE tasks SET {','.join(fields)},updated_at=? WHERE id=?",values)
    if 'story_points' in data and data['story_points']!=old_points: conn.execute('INSERT INTO scope_changes(sprint_id,task_id,type,description,points_delta,created_by,created_at) VALUES(?,?,?,?,?,?,?)',(task['sprint_id'],task_id,'change_points',f'Changed points for {task["title"]}',data['story_points']-old_points,'current-user',datetime.utcnow().isoformat()))
    conn.commit();
    if task['sprint_id']: snapshot(conn,task['sprint_id'])
    updated=conn.execute('SELECT * FROM tasks WHERE id=?',(task_id,)).fetchone(); conn.close(); return rowdict(updated)
@app.delete('/api/tasks/{task_id}')
def delete_task(task_id:int):
    conn=db(); task=conn.execute('SELECT * FROM tasks WHERE id=?',(task_id,)).fetchone()
    if not task: raise HTTPException(404,'Task not found')
    conn.execute('DELETE FROM tasks WHERE id=?',(task_id,)); conn.commit(); conn.close(); return {"deleted":True}
@app.get('/api/sprints/{sprint_id}/scope-changes')
def scope_changes(sprint_id:int):
    conn=db(); rows=conn.execute('SELECT * FROM scope_changes WHERE sprint_id=? ORDER BY created_at DESC',(sprint_id,)).fetchall(); conn.close(); return [rowdict(x) for x in rows]
@app.post('/api/sprints/{sprint_id}/scope-changes')
def create_scope_change(sprint_id:int,payload:ScopeChangeCreate):
    conn=db(); now=datetime.utcnow().isoformat(); cur=conn.execute('INSERT INTO scope_changes(sprint_id,task_id,type,description,points_delta,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',(sprint_id,payload.task_id,payload.type,payload.description,payload.points_delta,payload.reason,payload.created_by,now)); conn.commit(); snapshot(conn,sprint_id); row=conn.execute('SELECT * FROM scope_changes WHERE id=?',(cur.lastrowid,)).fetchone(); conn.close(); return rowdict(row)
@app.get('/api/sprints/{sprint_id}/snapshots')
def snapshots(sprint_id:int):
    conn=db(); rows=conn.execute('SELECT * FROM sprint_snapshots WHERE sprint_id=? ORDER BY snapshot_date',(sprint_id,)).fetchall(); conn.close(); return [rowdict(x) for x in rows]
