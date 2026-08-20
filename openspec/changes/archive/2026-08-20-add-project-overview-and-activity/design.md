## Context

后端为 FastAPI + SQLAlchemy 2.0，现有表：projects、profiles、project_members、stages、tasks、task_dependencies、task_blockers、stage_blockers、scope_changes、sprint_snapshots、project_activities。活动记录通过 `project_activities` 表记录。

## Goals / Non-Goals

**Goals:**

- 新增项目总览聚合 API：主阶段、并行阶段、任务进度、阻塞、验收和近期变化
- 新增项目风险展示 API：未解除阻塞、逾期事项
- 新增活动记录查询 API：按阶段、事件类型和操作人筛选
- 新增统一导航 API：核心页面独立 URL
- 新增统一操作反馈 API：处理中、成功和失败反馈

**Non-Goals:**

- 不提供故事点、Velocity、燃起图或燃尽图
- 不实现跨项目管理驾驶舱
- 不实现邮件、短信、飞书或 Slack 通知
- 不实现可编辑或可删除的审计日志
- 首版不实现活动记录订阅、关注、@提及或推送通知

## Decisions

### D1：项目总览聚合 API

`GET /api/projects/{id}/overview` 返回：
- 项目基本信息（名称、负责人、计划日期）
- 项目整体状态（根据主阶段状态自动计算）
- 主阶段（唯一，视觉优先）
- 并行阶段（全部活动中的非主阶段）
- 未完成任务数、受阻任务数、待验收阶段数

### D2：项目风险展示 API

`GET /api/projects/{id}/risks` 返回：
- 未解除的阶段阻塞
- 高优先级任务阻塞（紧急/重要）
- 逾期阶段（计划日期早于当前日期且未完成）
- 逾期任务（高优先级任务，计划日期早于当前日期且未完成）

### D3：活动记录查询 API

`GET /api/projects/{id}/activities` 支持筛选：
- `stage_id`：按阶段筛选
- `type`：按事件类型筛选
- `created_by`：按操作人筛选

### D4：统一导航

核心页面独立 URL：
- `/projects/:projectId`：项目总览
- `/projects/:projectId/stages`：阶段列表
- `/my-tasks`：我的任务
- `/projects/:projectId/activity`：活动记录
- `/projects/:projectId/members`：成员列表
- `/projects/:projectId/settings`：项目设置

### D5：统一操作反馈

所有异步写操作返回：
- `processing`：处理中状态
- `success`：成功消息（中文）
- `error`：错误消息（中文）

## Risks / Trade-offs

- [项目总览聚合 API 可能影响性能] → 使用聚合查询或缓存
- [活动记录查询可能返回大量数据] → 分页支持

## Migration Plan

无数据迁移。`init_db` 的 `create_all` 自动创建新表（如有）；现有库与数据完全不动。回滚 = 删除新路由与服务，不影响存量功能。

## Open Questions

- 阶段逾期是否需要在后续版本自动产生通知？