# Proposal: add-project-stage-foundation

## Why

当前系统只有 Sprint/任务模型，缺少 PRD-01 定义的「项目阶段」骨架：用户无法从开发模板创建带阶段结构的项目，也无法表达主阶段/并行阶段的推进方向。需要建立阶段实体及其规则，为后续 PRD-03（阶段任务管理）、PRD-05（交付物与验收）提供归属基础。

## What Changes

- 新增项目阶段实体（`stages` 表）：名称、目标、顺序、负责人、计划日期、状态、主阶段标记，归属项目。
- 新增项目活动记录实体（`project_activities` 表）：记录阶段结构变化和主阶段变化（FR-9）。
- 项目创建接口支持五阶段默认开发模板（需求分析、技术设计、开发、测试、发布），创建前可增删、重命名、排序阶段；阶段名非空且项目内唯一，至少保留一个阶段。
- 新增阶段管理接口：新增、重命名、调整未完成阶段顺序；删除含任务或交付物的阶段需返回影响范围供二次确认；已完成阶段禁止删除/调序；仅项目负责人（project_members role='owner'）可修改结构。
- 新增阶段启动与主阶段接口：未开始阶段可启动为主阶段或并行阶段；首个启动的阶段自动成为主阶段；指定新主阶段后原主阶段转为并行（状态不变）；存在活动阶段时必须且只能有一个主阶段，由后端强制。
- 新增阶段列表接口：展示名称、顺序、负责人、状态、计划日期与主/并行标识。
- 阶段与现有 Sprint 模型**并存不动**：本变更不迁移、不清空现有 Sprint 演示数据，任务暂不关联阶段（留给 PRD-03）。

## Capabilities

### New Capabilities

- `project-stages`: 项目阶段的模板化创建、结构管理（增删改排序）、状态与主阶段规则，以及阶段结构和主阶段变化的活动记录。

### Modified Capabilities

（无——`openspec/specs/` 当前为空，且本变更不改变现有 Sprint/任务行为。）

## Impact

- **后端**：新增 `stages`、`project_activities` 两张表及 ORM 模型；新增 `app/routers/stages.py`（或并入 projects 路由）与对应 service/domain；`app/schemas/` 新增阶段相关 Pydantic 模型；`init_db` 的 `create_all` 自动覆盖新表，无数据迁移。
- **API**：新增 `/api/projects/{id}/stages` 系列端点；项目创建接口扩展可选的阶段模板参数（向后兼容，不传则用默认模板）。
- **前端**：新增 `/projects/new` 创建页与 `/projects/:projectId/stages` 阶段列表页、`/projects/:projectId/stages/:stageId` 工作台占位页（PRD §5）。
- **依赖**：无新增第三方依赖。
- **不影响**：现有 Sprint、任务、范围变更、快照接口及其数据。
