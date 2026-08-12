## Context

后端为 FastAPI + SQLAlchemy 2.0，现有表：projects、profiles、project_members、stages、tasks、task_dependencies、task_blockers、stage_blockers、scope_changes、sprint_snapshots、project_activities。依赖和阻塞通过外键关联任务和阶段。

## Goals / Non-Goals

**Goals:**

- 新增依赖管理 API：设置任务前置依赖、查看未完成前置任务
- 新增阻塞管理 API：标记和解除任务/阶段阻塞、确认阻塞已解除
- 循环依赖在写入前被阻止

**Non-Goals:**

- 不自动计算关键路径或重新排期
- 不根据依赖自动改变任务状态
- 不实现跨项目任务依赖
- 不向外部即时通讯工具推送阻塞通知

## Decisions

### D1：任务依赖表结构

`task_dependencies` 表包含 `task_id` FK → `tasks.id`（后置任务）和 `dependency_id` FK → `tasks.id`（前置任务）。支持多对多依赖关系。

### D2：循环依赖校验

使用深度优先搜索（DFS）校验循环依赖，支持任意深度的间接路径。校验在写入前执行，失败时返回依赖路径。

### D3：任务阻塞表结构

`task_blockers` 表包含 `task_id` FK → `tasks.id`、`reason`、`handler_id` FK → `profiles.id`、`created_by`、`created_at`、`resolved_at`、`resolution`。支持历史阻塞记录。

### D4：阶段阻塞表结构

`stage_blockers` 表包含 `stage_id` FK → `stages.id`、`reason`、`handler_id` FK → `profiles.id`、`created_by`、`created_at`、`resolved_at`、`resolution`。支持历史阻塞记录。

### D5：阻塞解除后任务待确认

处理人解除阻塞后，任务自动进入"待确认"状态。任务负责人可选择"确认继续"或"标记新阻塞"。

### D6：API 形态

挂到既有 `/api/projects` 前缀：

- `POST /api/projects/{id}/tasks/{tid}/dependencies`：添加前置依赖
- `GET /api/projects/{id}/tasks/{tid}/dependencies`：查看前置依赖
- `DELETE /api/projects/{id}/tasks/{tid}/dependencies/{dep_id}`：移除前置依赖
- `POST /api/projects/{id}/tasks/{tid}/blockers`：标记任务阻塞
- `PATCH /api/projects/{id}/tasks/{tid}/blockers/{bid}`：解除任务阻塞
- `GET /api/projects/{id}/tasks/{tid}/blockers`：查看历史阻塞记录
- `POST /api/projects/{id}/stages/{sid}/blockers`：标记阶段阻塞
- `PATCH /api/projects/{id}/stages/{sid}/blockers/{bid}`：解除阶段阻塞
- `GET /api/projects/{id}/stages/{sid}/blockers`：查看历史阻塞记录
- `POST /api/projects/{id}/tasks/{tid}/confirm-blocker`：确认阻塞已解除

### D7：活动记录类型扩展

新增活动记录类型：
- `task_dependency_added`：添加前置依赖
- `task_dependency_removed`：移除前置依赖
- `task_blocker_created`：标记任务阻塞
- `task_blocker_resolved`：解除任务阻塞
- `stage_blocker_created`：标记阶段阻塞
- `stage_blocker_resolved`：解除阶段阻塞

## Risks / Trade-offs

- [循环依赖校验可能影响性能] → 使用 DFS 算法，缓存校验结果
- [阻塞解除后任务待确认可能增加用户操作] → 首版不要求实时通知，任务负责人通过"我的任务"或项目总览发现待确认任务

## Migration Plan

无数据迁移。`init_db` 的 `create_all` 自动创建新表；现有库与数据完全不动。回滚 = 删除新路由与服务，不影响存量功能。

## Open Questions

- 未完成依赖是否应阻止任务进入"待确认"？当前仅提示，不强制阻止。