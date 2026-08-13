from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

from sqlalchemy import Engine, create_engine, event, func, select, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, sessionmaker
from loguru import logger

from app.core.config import database_path
from app.db.models import Base, Profile, Project, ProjectMember, ScopeChange, Sprint, SprintSnapshot, Task

_engines: dict[str, Engine] = {}

# expire_on_commit=False keeps freshly committed rows readable without a refresh,
# matching the previous "commit then return the row" flow.
SessionLocal = sessionmaker(expire_on_commit=False)


def _create_engine(path: Path) -> Engine:
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()

    return engine


def get_engine() -> Engine:
    """Return the engine for the configured SQLite path, cached per path.

    Caching by resolved path keeps tests cheap when they point
    ``VIBE_PM_DB_PATH`` at a fresh temporary file per case.
    """
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    key = str(path)
    engine = _engines.get(key)
    if engine is None:
        engine = _create_engine(path)
        _engines[key] = engine
    return engine


def get_session() -> Session:
    return SessionLocal(bind=get_engine())


def get_db():
    """FastAPI dependency: one session per request, always closed."""
    session = get_session()
    try:
        yield session
    finally:
        session.close()


def _seed_demo(session: Session) -> None:
    now = datetime.utcnow().isoformat()
    if session.get(Profile, "demo-user") is None:
        session.add(Profile(id="demo-user", name="演示用户", email="demo@example.com", created_at=now))
    existing_project_id = session.scalars(select(Project.id).order_by(Project.id).limit(1)).first()
    if existing_project_id is not None:
        if session.get(ProjectMember, (existing_project_id, "demo-user")) is None:
            session.add(ProjectMember(project_id=existing_project_id, user_id="demo-user", role="owner"))
        return
    project = Project(name="Vibe PM", description="Scope-aware project delivery", created_at=now)
    session.add(project)
    session.flush()
    session.add(ProjectMember(project_id=project.id, user_id="demo-user", role="owner"))
    start = date.today() - timedelta(days=7)
    end = start + timedelta(days=13)
    sprint = Sprint(
        project_id=project.id,
        name="Sprint 14",
        goal="Build the payment flow",
        start_date=start.isoformat(),
        end_date=end.isoformat(),
        status="active",
        initial_points=16,
        created_at=now,
    )
    session.add(sprint)
    session.flush()
    tasks = [
        ("Payment infrastructure", "done", 3, "P0", "SM"),
        ("WeChat Pay channel", "in_progress", 5, "P0", "AL"),
        ("Refund status sync", "in_review", 3, "P1", "JK"),
        ("Checkout result page", "todo", 2, "P2", "SM"),
        ("Reconciliation report", "todo", 3, "P2", "AL"),
        ("Order alerts", "todo", 2, "P1", "JK"),
        ("Conversion funnel", "done", 2, "P3", "SM"),
    ]
    for position, (title, status, points, priority, assignee) in enumerate(tasks):
        session.add(
            Task(
                project_id=project.id,
                sprint_id=sprint.id,
                title=title,
                status=status,
                story_points=points,
                priority=priority,
                assignee=assignee,
                position=position,
                created_at=now,
                updated_at=now,
            )
        )
    changes = [
        ("change_points", "Sprint started", 16, "Initial scope", start.isoformat() + "T09:00:00"),
        ("add_task", "Added WeChat Pay channel", 5, "CEO request", (start + timedelta(days=2)).isoformat() + "T09:15:00"),
        ("remove_task", "Removed reconciliation report", -3, "Priority lowered", (start + timedelta(days=4)).isoformat() + "T14:30:00"),
    ]
    for change_type, description, delta, reason, created_at in changes:
        session.add(
            ScopeChange(
                sprint_id=sprint.id,
                type=change_type,
                description=description,
                points_delta=delta,
                reason=reason,
                created_by="demo",
                created_at=created_at,
            )
        )


def _apply_legacy_column_patches(session: Session) -> None:
    """Keep existing SQLite databases compatible with columns added later."""

    def _apply_migration(name: str, ddl_hint: str, op) -> None:
        """Run a single risky schema migration with full logging.

        Logs a warning before running, info on success, and exception on failure
        so that otherwise-silent ALTER failures are never lost.
        """
        logger.warning(f"[schema-migration] about to run: {name} | {ddl_hint}")
        try:
            op()
            logger.info(f"[schema-migration] succeeded: {name}")
        except Exception:
            logger.exception(f"[schema-migration] FAILED: {name} | {ddl_hint}")
            raise

    logger.info("Applying legacy schema column patches to existing SQLite database")

    task_columns = {row[1] for row in session.execute(text("PRAGMA table_info(tasks)"))}
    if "completed_at" not in task_columns:
        _apply_migration(
            "add tasks.completed_at",
            "ALTER TABLE tasks ADD COLUMN completed_at TEXT",
            lambda: session.execute(text("ALTER TABLE tasks ADD COLUMN completed_at TEXT")),
        )
    # PRD-03: link tasks to stages and track a planned date.
    if "stage_id" not in task_columns:
        _apply_migration(
            "add tasks.stage_id + index",
            "ALTER TABLE tasks ADD COLUMN stage_id INTEGER REFERENCES stages(id); CREATE INDEX idx_tasks_stage",
            lambda: [
                session.execute(text("ALTER TABLE tasks ADD COLUMN stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL")),
                session.execute(text("CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage_id, status)")),
            ],
        )
    if "planned_date" not in task_columns:
        _apply_migration(
            "add tasks.planned_date",
            "ALTER TABLE tasks ADD COLUMN planned_date TEXT",
            lambda: session.execute(text("ALTER TABLE tasks ADD COLUMN planned_date TEXT")),
        )
    project_columns = {row[1] for row in session.execute(text("PRAGMA table_info(projects)"))}
    if "default_sprint_weeks" not in project_columns:
        _apply_migration(
            "add projects.default_sprint_weeks",
            "ALTER TABLE projects ADD COLUMN default_sprint_weeks INTEGER NOT NULL DEFAULT 2",
            lambda: session.execute(text("ALTER TABLE projects ADD COLUMN default_sprint_weeks INTEGER NOT NULL DEFAULT 2")),
        )
    snapshot_columns = {row[1] for row in session.execute(text("PRAGMA table_info(sprint_snapshots)"))}
    if "ideal_completed" not in snapshot_columns:
        _apply_migration(
            "add sprint_snapshots.ideal_completed",
            "ALTER TABLE sprint_snapshots ADD COLUMN ideal_completed REAL",
            lambda: session.execute(text("ALTER TABLE sprint_snapshots ADD COLUMN ideal_completed REAL")),
        )
    if "ideal_remaining" not in snapshot_columns:
        _apply_migration(
            "add sprint_snapshots.ideal_remaining",
            "ALTER TABLE sprint_snapshots ADD COLUMN ideal_remaining REAL",
            lambda: session.execute(text("ALTER TABLE sprint_snapshots ADD COLUMN ideal_remaining REAL")),
        )
    if "scope_change_id" not in snapshot_columns:
        _apply_migration(
            "add sprint_snapshots.scope_change_id",
            "ALTER TABLE sprint_snapshots ADD COLUMN scope_change_id INTEGER",
            lambda: session.execute(text("ALTER TABLE sprint_snapshots ADD COLUMN scope_change_id INTEGER")),
        )

    # Migrate project_members role constraint to support observer.
    # SQLite doesn't support ALTER TABLE ... DROP CONSTRAINT, so we recreate the table.
    try:
        # Test if observer role is accepted by trying to query with it.
        session.execute(text("SELECT 1 FROM project_members WHERE role = 'observer' LIMIT 1"))
    except Exception:
        # If observer role causes a constraint violation, we rebuild the table
        # with a CHECK that allows 'observer'. This is a complex migration.
        logger.warning(
            "[schema-migration] observer role not yet supported; rebuilding project_members table"
        )
        try:
            session.execute(text("""
                CREATE TABLE project_members_new (
                    project_id INTEGER NOT NULL,
                    user_id TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'member',
                    PRIMARY KEY (project_id, user_id),
                    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE,
                    FOREIGN KEY(user_id) REFERENCES profiles (id) ON DELETE CASCADE,
                    CHECK (role IN ('owner','member','observer'))
                )
            """))
            session.execute(text("INSERT INTO project_members_new SELECT * FROM project_members"))
            session.execute(text("DROP TABLE project_members"))
            session.execute(text("ALTER TABLE project_members_new RENAME TO project_members"))
            session.commit()
            logger.info("[schema-migration] succeeded: project_members observer-role rebuild")
        except Exception:
            logger.exception("[schema-migration] FAILED: project_members observer-role rebuild")
            raise


def init_db(seed: bool = True) -> None:
    engine = get_engine()
    logger.info(f"init_db starting: ensuring {len(Base.metadata.tables)} tables via create_all")
    Base.metadata.create_all(engine)
    with SessionLocal(bind=engine) as session:
        _apply_legacy_column_patches(session)
        if seed:
            logger.info("init_db: seeding demo data")
            _seed_demo(session)
        # An active demo sprint should render immediately on a fresh install.
        active_sprint_ids = session.scalars(select(Sprint.id).where(Sprint.status == "active")).all()
        if active_sprint_ids:
            logger.info(f"init_db: generating snapshots for {len(active_sprint_ids)} active sprint(s)")
        for sprint_id in active_sprint_ids:
            snapshot(session, sprint_id)
        session.commit()
    logger.info("init_db completed successfully")


def snapshot(session: Session, sprint_id: int, snapshot_date: date | None = None, scope_change_id: int | None = None) -> None:
    """Upsert today's (or an explicitly requested date's) current snapshot.

    Existing historical rows are only updated when the caller explicitly asks
    for that date; normal mutations always use today and never rewrite history.
    """
    sprint = session.get(Sprint, sprint_id)
    if sprint is None:
        logger.warning(f"snapshot: sprint {sprint_id} not found, cannot snapshot")
        raise ValueError(f"Sprint {sprint_id} not found")
    logger.info(f"snapshot: upserting for sprint_id={sprint_id}, date={snapshot_date or date.today()}")
    total = float(session.scalar(select(func.coalesce(func.sum(Task.story_points), 0)).where(Task.sprint_id == sprint_id)))
    progress = {"done": 1.0, "in_review": 0.8, "in_progress": 0.5, "todo": 0.0}
    completed = sum(
        float(points) * progress[status]
        for points, status in session.execute(select(Task.story_points, Task.status).where(Task.sprint_id == sprint_id))
    )
    day = snapshot_date or date.today()
    start, end = date.fromisoformat(sprint.start_date), date.fromisoformat(sprint.end_date)
    duration = max((end - start).days, 1)
    ratio = min(max((day - start).days / duration, 0.0), 1.0)
    initial = float(sprint.initial_points or 0)
    ideal_completed = initial * ratio
    stmt = sqlite_insert(SprintSnapshot).values(
        sprint_id=sprint_id,
        snapshot_date=day.isoformat(),
        total_scope=total,
        completed_points=completed,
        remaining_points=total - completed,
        ideal_completed=ideal_completed,
        ideal_remaining=initial - ideal_completed,
        scope_change_id=scope_change_id,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["sprint_id", "snapshot_date"],
        set_={
            "total_scope": stmt.excluded.total_scope,
            "completed_points": stmt.excluded.completed_points,
            "remaining_points": stmt.excluded.remaining_points,
            "ideal_completed": stmt.excluded.ideal_completed,
            "ideal_remaining": stmt.excluded.ideal_remaining,
            "scope_change_id": func.coalesce(stmt.excluded.scope_change_id, SprintSnapshot.scope_change_id),
        },
    )
    session.execute(stmt)
    logger.info(f"snapshot: upserted snapshot for sprint_id={sprint_id}, date={day.isoformat()}")
