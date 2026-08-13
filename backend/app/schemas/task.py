from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


StoryPoints = Literal[1, 2, 3, 5, 8, 13]
TaskStatus = Literal["todo", "in_progress", "in_review", "done"]
Priority = Literal["P0", "P1", "P2", "P3"]

# PRD-03: stage-task priority vocabulary (紧急/重要/正常/低).
StageTaskStatus = Literal["todo", "in_progress", "blocked", "pending_verification", "done"]
StageTaskPriority = Literal["urgent", "important", "normal", "low"]


class TaskCreateRequest(BaseModel):
    project_id: int = 1
    sprint_id: int | None = None
    title: str = Field(min_length=1)
    description: str | None = None
    status: TaskStatus = "todo"
    story_points: StoryPoints
    priority: Priority = "P2"
    assignee: str | None = None
    position: int | None = Field(default=None, ge=0)
    reason: str | None = None
    created_by: str = "current-user"


class TaskUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    description: str | None = None
    status: TaskStatus | None = None
    story_points: StoryPoints | None = None
    priority: Priority | None = None
    assignee: str | None = None
    sprint_id: int | None = None
    position: int | None = Field(default=None, ge=0)
    reason: str | None = None
    created_by: str = "current-user"


class TaskResponse(BaseModel):
    id: int
    project_id: int
    sprint_id: int | None
    title: str
    description: str | None
    status: TaskStatus
    story_points: float
    priority: Priority
    assignee: str | None
    position: int
    created_at: datetime | str
    updated_at: datetime | str
    completed_at: datetime | str | None = None


# --- PRD-03: stage-based task schemas ---


class TaskCreate(BaseModel):
    """Create a task inside a stage (PRD-03)."""

    project_id: int
    stage_id: int | None = None
    title: str = Field(min_length=1)
    description: str | None = None
    status: StageTaskStatus = "todo"
    priority: StageTaskPriority = "normal"
    assignee: str | None = None
    planned_date: date | None = None
    created_by: str = "current-user"


class TaskUpdate(BaseModel):
    """Edit a stage task (PRD-03). All fields optional; empty title rejected."""

    title: str | None = Field(default=None, min_length=1)
    description: str | None = None
    status: StageTaskStatus | None = None
    priority: StageTaskPriority | None = None
    assignee: str | None = None
    planned_date: date | None = None
    position: int | None = Field(default=None, ge=0)
    reason: str | None = None
    created_by: str = "current-user"


class TaskMoveRequest(BaseModel):
    """Move a task to another (unfinished) stage, or set it unplanned."""

    target_stage_id: int | None = None
    reason: str | None = None


# --- PRD-04: dependency & blocker schemas ---


class TaskDependencyCreate(BaseModel):
    dependency_id: int
    created_by: str = "current-user"


class TaskBlockerCreate(BaseModel):
    reason: str = Field(min_length=1)
    handler_id: str | None = None
    created_by: str = "current-user"


class TaskBlockerResolve(BaseModel):
    resolution: str = Field(min_length=1)


class StageBlockerCreate(BaseModel):
    reason: str = Field(min_length=1)
    handler_id: str | None = None
    created_by: str = "current-user"


class StageBlockerResolve(BaseModel):
    resolution: str = Field(min_length=1)


class ConfirmBlockerRequest(BaseModel):
    action: Literal["continue", "reblock"]
    reason: str | None = None
    handler_id: str | None = None
