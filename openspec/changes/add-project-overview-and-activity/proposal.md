# Proposal: add-project-overview-and-activity

## Why

当前系统缺少项目总览和活动记录能力：用户无法聚合项目状态、风险、任务进度、阻塞、验收和近期变化，也没有可追溯的活动记录。需要为项目负责人提供主阶段、并行阶段、任务进度、阻塞、验收和近期变化的统一入口，并为所有成员提供可追溯活动记录。

## What Changes

- 新增项目总览聚合 API：主阶段、并行阶段、任务进度、阻塞、验收和近期变化
- 新增项目风险展示 API：未解除阻塞、逾期事项
- 新增活动记录查询 API：按阶段、事件类型和操作人筛选
- 新增统一导航 API：核心页面独立 URL
- 新增统一操作反馈 API：处理中、成功和失败反馈

## Capabilities

### New Capabilities
- `project-overview`: 项目总览聚合、风险展示、活动记录查询、统一导航、统一操作反馈

### Modified Capabilities
（无——现有 `project-overview` spec 已存在，本变更实现其需求）

## Impact

- **后端**：新增项目总览聚合 API、活动记录查询 API
- **API**：新增 `/api/projects/{id}/overview` 端点；新增 `/api/projects/{id}/risks` 端点；新增 `/api/projects/{id}/activities` 端点
- **前端**：新增项目总览页、活动记录页
- **依赖**：无新增第三方依赖