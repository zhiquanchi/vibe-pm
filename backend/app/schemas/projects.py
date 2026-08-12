from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.stages import StageTemplateItem, validate_stage_items


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    # 缺省时使用默认五阶段开发模板。
    stages: list[StageTemplateItem] | None = None

    @field_validator("stages")
    @classmethod
    def _validate_stages(cls, value):
        return validate_stage_items(value) if value is not None else value


class MemberCreate(BaseModel):
    user_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    role: str = "member"


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    default_sprint_weeks: Literal[1, 2] | None = None
