from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator


SprintStatus = Literal["planning", "active", "completed"]


class SprintCreateRequest(BaseModel):
    project_id: int = Field(default=1, ge=1)
    name: str = Field(min_length=1)
    goal: str | None = None
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class SprintStatusUpdate(BaseModel):
    status: SprintStatus


class SprintDatesUpdate(BaseModel):
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class SprintMoveTaskRequest(BaseModel):
    reason: str | None = None
