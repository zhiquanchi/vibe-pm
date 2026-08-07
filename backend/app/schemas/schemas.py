from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SprintCreate(BaseModel):
    name: str = Field(min_length=1)
    goal: str | None = None
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def valid_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be after start_date")
        return self


class TaskCreate(BaseModel):
    project_id: int = 1
    sprint_id: int | None = None
    title: str = Field(min_length=1)
    description: str | None = None
    status: Literal["todo", "in_progress", "in_review", "done"] = "todo"
    story_points: int = Field(ge=1)
    priority: Literal["P0", "P1", "P2", "P3"] = "P2"
    assignee: str | None = None


class TaskUpdate(BaseModel):
    status: Literal["todo", "in_progress", "in_review", "done"] | None = None
    title: str | None = Field(default=None, min_length=1)
    story_points: int | None = Field(default=None, ge=1)
    priority: Literal["P0", "P1", "P2", "P3"] | None = None
    assignee: str | None = None


class ScopeChangeCreate(BaseModel):
    task_id: int | None = None
    type: Literal["add_task", "remove_task", "change_points"]
    description: str = Field(min_length=1)
    points_delta: float
    reason: str | None = None
    created_by: str = "current-user"
