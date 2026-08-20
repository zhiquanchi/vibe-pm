# Proposal: add-project-members-and-permissions

## Why

当前系统缺少完整的项目成员管理和权限控制机制：用户无法添加、移除成员或调整角色，阶段负责人职责未定义，服务端权限校验缺失。需要建立项目负责人、阶段负责人、成员和观察者四类职责，确保阶段配置、任务维护和阶段验收由正确的人执行。

## What Changes

- 新增项目成员管理实体（`project_members` 表已存在，扩展 role 字段支持 `owner`/`member`/`observer`）
- 新增阶段负责人分配机制（`stages.owner_id` FK → `profiles.id`）
- 新增成员管理 API：添加成员、调整角色、移除成员
- 新增阶段负责人管理 API：分配、更换阶段负责人
- 实现服务端权限校验：所有项目资源读取校验成员关系，所有写接口按角色和阶段职责校验
- 项目创建时强制指定至少 2 名项目负责人
- 项目负责人总数不能少于 2 人，移除时若剩余不足 2 人则阻止操作

## Capabilities

### New Capabilities
- `members-permissions`: 项目成员管理（添加、移除、角色调整）、阶段负责人分配、服务端权限校验

### Modified Capabilities
（无——现有 `members-permissions` spec 已存在，本变更实现其需求）

## Impact

- **后端**：扩展 `project_members.role` 支持 `observer`；新增成员管理、阶段负责人管理 API；服务端权限校验
- **API**：新增 `/api/projects/{id}/members` 系列端点；扩展阶段管理 API 支持负责人分配
- **前端**：新增成员列表页、阶段负责人分配 UI
- **依赖**：无新增第三方依赖