from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.stages import StageTemplateItem, validate_stage_items


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    # 缺省时使用默认五阶段开发模板。
    stages: list[StageTemplateItem] | None = None
    # 可选的初始成员列表（向后兼容：若不提供，创建者自动成为唯一 owner）
    members: list[MemberCreate] | None = None

    @field_validator("stages")
    @classmethod
    def _validate_stages(cls, value):
        return validate_stage_items(value) if value is not None else value

    @model_validator(mode="after")
    def _validate_members(self):
        if self.members is not None:
            owner_count = sum(1 for m in self.members if m.role == "owner")
            if owner_count < 2:
                raise ValueError("项目至少需要 2 名项目负责人以确保验收独立性")
        return self


class MemberCreate(BaseModel):
    user_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    role: Literal["owner", "member", "observer"] = "member"


class MemberUpdate(BaseModel):
    role: Literal["owner", "member", "observer"]


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    default_sprint_weeks: Literal[1, 2] | None = None
