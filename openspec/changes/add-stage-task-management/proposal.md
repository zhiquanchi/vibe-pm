# Proposal: add-stage-task-management

## Why

当前系统缺少阶段任务管理能力：用户无法在阶段内创建、编辑、推进任务，无法查看阶段任务列表，无法移动和删除任务，也没有跨项目的"我的任务"视图。需要为每个开发阶段提供任务管理能力，并提供跨项目的"我的任务"视图。

## What Changes

- 新增任务实体（`tasks` 表已存在，扩展 `project_id` 和 `sprint_id` 支持 `stage_id`）
- 新增任务管理 API：在阶段内创建任务、编辑任务、推进任务状态、移动任务、删除任务
- 新增阶段任务列表 API：按状态查看任务、筛选、排序
- 新增"我的任务"视图 API：跨项目的未完成任务列表
- 任务状态转换必须符合总纲定义的状态转换表
- 任务移动和删除时检查依赖关系和验收必需项

## Capabilities

### New Capabilities
- `task-management`: 阶段任务管理（创建、编辑、推进、移动、删除）、阶段任务列表、我的任务视图

### Modified Capabilities
（无——现有 `task-management` spec 已存在，本变更实现其需求）

## Impact

- **后端**：扩展 `tasks` 表支持 `stage_id`；新增任务管理 API；任务状态转换校验；依赖关系检查
- **API**：新增 `/api/projects/{id}/stages/{sid}/tasks` 系列端点；新增 `/my-tasks` 端点
- **前端**：新增阶段任务列表页、我的任务页
- **依赖**：无新增第三方依赖