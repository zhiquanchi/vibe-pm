from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    default_sprint_weeks: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    avatar_url: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (CheckConstraint("role IN ('owner','member','observer')"),)

    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String, nullable=False, default="member")


class Stage(Base):
    __tablename__ = "stages"
    __table_args__ = (
        # PRD-04: stages may be 'blocked' (阻塞).
        CheckConstraint("status IN ('planned','active','completed','blocked')"),
        # At most one primary stage per project, enforced at the database level.
        Index("uq_stages_primary", "project_id", unique=True, sqlite_where=text("is_primary = 1")),
        Index("idx_stages_project", "project_id", "position"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    goal: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("profiles.id"))
    planned_start: Mapped[str | None] = mapped_column(String)
    planned_end: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, nullable=False, default="planned")
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class ProjectActivity(Base):
    __tablename__ = "project_activities"
    __table_args__ = (Index("idx_project_activities_project", "project_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Sprint(Base):
    __tablename__ = "sprints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    goal: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[str] = mapped_column(String, nullable=False)
    end_date: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="planning")
    initial_points: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("idx_tasks_sprint", "sprint_id", "status"),
        Index("idx_tasks_project", "project_id"),
        Index("idx_tasks_stage", "stage_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, nullable=False)
    sprint_id: Mapped[int | None] = mapped_column(Integer)
    # PRD-03: tasks can also belong to a stage (coexists with sprint_id during transition).
    stage_id: Mapped[int | None] = mapped_column(ForeignKey("stages.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, nullable=False, default="todo")
    story_points: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    priority: Mapped[str] = mapped_column(String, nullable=False, default="P2")
    assignee: Mapped[str | None] = mapped_column(String)
    # PRD-03: planned date for the task (计划日期).
    planned_date: Mapped[str | None] = mapped_column(String)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)
    completed_at: Mapped[str | None] = mapped_column(String)


class ScopeChange(Base):
    __tablename__ = "scope_changes"
    __table_args__ = (Index("idx_scope_changes_sprint", "sprint_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sprint_id: Mapped[int] = mapped_column(Integer, nullable=False)
    task_id: Mapped[int | None] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    points_delta: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str | None] = mapped_column(String)
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class SprintSnapshot(Base):
    __tablename__ = "sprint_snapshots"
    __table_args__ = (
        UniqueConstraint("sprint_id", "snapshot_date"),
        Index("idx_snapshots_sprint", "sprint_id", "snapshot_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sprint_id: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot_date: Mapped[str] = mapped_column(String, nullable=False)
    total_scope: Mapped[float] = mapped_column(Float, nullable=False)
    completed_points: Mapped[float] = mapped_column(Float, nullable=False)
    remaining_points: Mapped[float] = mapped_column(Float, nullable=False)
    ideal_completed: Mapped[float | None] = mapped_column(Float)
    ideal_remaining: Mapped[float | None] = mapped_column(Float)
    scope_change_id: Mapped[int | None] = mapped_column(Integer)


# --- PRD-04: task dependency & blocker tables ---


class TaskDependency(Base):
    __tablename__ = "task_dependencies"
    __table_args__ = (
        UniqueConstraint("task_id", "dependency_id"),
        Index("idx_task_dependencies_task", "task_id"),
        Index("idx_task_dependencies_dependency", "dependency_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    dependency_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class TaskBlocker(Base):
    __tablename__ = "task_blockers"
    __table_args__ = (Index("idx_task_blockers_task", "task_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    handler_id: Mapped[str | None] = mapped_column(ForeignKey("profiles.id"))
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    resolved_at: Mapped[str | None] = mapped_column(String)
    resolution: Mapped[str | None] = mapped_column(String)


class StageBlocker(Base):
    __tablename__ = "stage_blockers"
    __table_args__ = (Index("idx_stage_blockers_stage", "stage_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stage_id: Mapped[int] = mapped_column(ForeignKey("stages.id", ondelete="CASCADE"), nullable=False)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    handler_id: Mapped[str | None] = mapped_column(ForeignKey("profiles.id"))
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    resolved_at: Mapped[str | None] = mapped_column(String)
    resolution: Mapped[str | None] = mapped_column(String)
    previous_stage_status: Mapped[str | None] = mapped_column(String)
