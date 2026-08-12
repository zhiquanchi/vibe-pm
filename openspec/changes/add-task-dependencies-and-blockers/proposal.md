# Proposal: add-task-dependencies-and-blockers

## Why

当前系统缺少任务依赖和阻塞管理能力：用户无法表达任务前置关系，无法记录任务或阶段无法继续推进的具体原因、处理人和解决结果。需要允许团队表达任务前置关系，并记录任务或阶段无法继续推进的具体原因、处理人和解决结果。

## What Changes

- 新增任务依赖实体（`task_dependencies` 表）
- 新增任务阻塞实体（`task_blockers` 表）
- 新增阶段阻塞实体（`stage_blockers` 表）
- 新增依赖管理 API：设置任务前置依赖、查看未完成前置任务
- 新增阻塞管理 API：标记和解除任务/阶段阻塞、确认阻塞已解除
- 循环依赖在写入前被阻止

## Capabilities

### New Capabilities
- `dependencies-blockers`: 任务依赖管理（前置依赖、循环依赖阻止）、任务/阶段阻塞管理、阻塞解除与确认

### Modified Capabilities
（无——现有 `dependencies-blockers` spec 已存在，本变更实现其需求）

## Impact

- **后端**：新增 `task_dependencies`、`task_blockers`、`stage_blockers` 表；新增依赖和阻塞管理 API
- **API**：新增 `/api/projects/{id}/tasks/{tid}/dependencies` 系列端点；新增 `/api/projects/{id}/tasks/{tid}/blockers` 系列端点；新增 `/api/projects/{id}/stages/{sid}/blockers` 系列端点
- **前端**：新增任务依赖设置 UI、任务/阶段阻塞管理 UI
- **依赖**：无新增第三方依赖