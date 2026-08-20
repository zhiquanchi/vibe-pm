## Context

后端为 FastAPI + SQLAlchemy 2.0，现有表：projects、profiles、project_members、stages、tasks、scope_changes、sprint_snapshots、project_activities。任务通过 `tasks.project_id` 和 `tasks.sprint_id` 关联，需要扩展支持 `tasks.stage_id`。权限沿用现有开发身份层：`X-User-Id` 请求头 + `project_members.role` 判定项目角色。

## Goals / Non-Goals

**Goals:**

- 新增任务管理 API：在阶段内创建任务、编辑任务、推进任务状态、移动任务、删除任务
- 新增阶段任务列表 API：按状态查看任务、筛选、排序
- 新增"我的任务"视图 API：跨项目的未完成任务列表
- 任务状态转换必须符合总纲定义的状态转换表
- 任务移动和删除时检查依赖关系和验收必需项

**Non-Goals:**

- 不实现子任务、周期任务或任务模板
- 不实现故事点、Velocity 或固定工时填报
- 不实现代码提交、PR 或 Issue 自动关联
- 首版不实现批量操作（批量移动、批量修改优先级、批量分配负责人）
- 首版不实现看板视图

## Decisions

### D1：任务扩展 `stage_id` 字段

在 `tasks` 表新增 `stage_id` FK → `stages.id`，与 `sprint_id` 并存。任务可归属阶段或 Sprint（过渡期），`stage_id` 优先用于 PRD-03。

### D2：任务状态转换表

任务状态转换必须符合总纲定义的状态转换表：
- `todo` → `in_progress`
- `in_progress` → `done`
- `in_progress` → `blocked`
- `blocked` → `pending_verification`
- `pending_verification` → `done`

### D3：任务移动和删除检查

- 移动任务：检查目标阶段未完成；移出已启动阶段需填写原因
- 删除任务：检查未被依赖；检查非验收必需
- 失败回滚：写操作失败时任务恢复原状态

### D4：我的任务视图

跨项目的未完成任务列表，默认按计划日期升序排序。支持按项目、阶段、状态和优先级筛选。逾期和受阻任务具有文字与视觉标识。

### D5：API 形态

挂到既有 `/api/projects` 前缀：

- `POST /api/projects/{id}/stages/{sid}/tasks`：创建任务
- `GET /api/projects/{id}/stages/{sid}/tasks`：阶段任务列表（支持筛选和排序）
- `PATCH /api/projects/{id}/tasks/{tid}`：编辑任务
- `PUT /api/projects/{id}/tasks/{tid}/move`：移动任务
- `DELETE /api/projects/{id}/tasks/{tid}`：删除任务
- `GET /my-tasks`：我的任务列表

### D6：活动记录类型扩展

新增活动记录类型：
- `task_created`：创建任务
- `task_updated`：编辑任务
- `task_moved`：移动任务
- `task_deleted`：删除任务
- `task_status_changed`：任务状态变化

## Risks / Trade-offs

- [任务可归属 Sprint 或阶段，语义上可能让使用者困惑] → 本变更刻意不打通，PRD-03 统一任务归属时再收敛；在 API 文档与提案中明确并存是过渡态
- [任务状态转换表可能需要扩展] → 首版实现基本转换，后续版本可扩展

## Migration Plan

无数据迁移。`init_db` 的 `create_all` 自动创建新表（如有）；现有库与数据完全不动。回滚 = 删除新路由与服务，不影响存量功能。

## Open Questions

- 首版是否允许任务同时归属 Sprint 和阶段？当前默认只允许一种归属。