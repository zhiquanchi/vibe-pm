## Context

后端为 FastAPI + SQLAlchemy 2.0，现有表：projects、profiles、project_members、stages、tasks、scope_changes、sprint_snapshots、project_activities。权限沿用现有开发身份层：`X-User-Id` 请求头 + `project_members.role` 判定项目角色（`app/routers/projects.py` 已有同款模式）。阶段负责人通过 `stages.owner_id` FK → `profiles.id` 实现。

## Goals / Non-Goals

**Goals:**

- 新增成员管理 API：添加、调整角色、移除成员
- 新增阶段负责人管理 API：分配、更换阶段负责人
- 实现服务端权限校验：所有项目资源读取校验成员关系，所有写接口按角色和阶段职责校验
- 项目创建时强制指定至少 2 名项目负责人
- 项目负责人总数不能少于 2 人，移除时若剩余不足 2 人则阻止操作

**Non-Goals:**

- 不实现完全自定义角色或逐字段权限
- 不实现企业组织架构、用户组、SSO 或外部目录同步
- 不实现临时访问链接和公开项目
- 不实现活动记录的查询页（PRD-06）

## Decisions

### D1：角色扩展为三态，保留 observer 用于后续 PRD

`project_members.role` 扩展为 `owner | member | observer`。观察者只读查看项目、阶段、任务和活动。本变更中仅实现 owner 和 member，observer 保留字段供后续 PRD 使用。

### D2：阶段负责人通过 `stages.owner_id` 实现

阶段负责人是一项阶段职责，不替代成员的项目角色。`stages.owner_id` FK → `profiles.id`，与现有 `ProjectMember.user_id` 分离。阶段负责人只能处理自己负责阶段的阶段级操作（如提交验收）。

### D3：服务端权限校验统一模式

复用 `require_project_member` 模式，扩展为 `require_project_role(project_id, required_roles)`：

- 读取权限：检查 `project_members` 记录存在（任意 role）
- 写入权限：检查 `project_members.role` 在允许列表中
- 阶段级操作：额外检查 `stages.owner_id == user_id` 或 `project_members.role == 'owner'`

### D4：项目负责人至少 2 人强制保证

- 创建项目时：`ProjectCreate` schema 校验至少 2 名 owner
- 添加成员时：若添加 owner，检查总数 ≥ 2
- 移除成员时：若移除 owner，检查移除后总数 ≥ 2
- 更换角色时：若从 owner 改为其他，检查移除后总数 ≥ 2

### D5：移除成员的三重检查

移除成员时检查：
1. 是否是阶段负责人（阻止并列出负责的阶段）
2. 是否有未完成任务（阻止并列出任务数）
3. 移除后是否导致 owner 不足 2 人（阻止）

### D6：活动记录类型扩展

新增活动记录类型：
- `member_added`：添加成员
- `member_role_changed`：调整成员角色
- `member_removed`：移除成员
- `stage_owner_changed`：更换阶段负责人

### D7：API 形态

挂到既有 `/api/projects` 前缀：

- `GET /api/projects/{id}/members`：成员列表（所有成员可查看）
- `POST /api/projects/{id}/members`：添加成员（owner 限定）
- `PATCH /api/projects/{id}/members/{user_id}`：调整角色（owner 限定）
- `DELETE /api/projects/{id}/members/{user_id}`：移除成员（owner 限定）
- `PATCH /api/projects/{id}/stages/{sid}/owner`：分配/更换阶段负责人（owner 限定）

## Risks / Trade-offs

- [阶段负责人与项目负责人职责重叠] → 阶段负责人只能处理自己负责阶段的阶段级操作，项目负责人可处理全部阶段
- [权限校验增加 API 复杂度] → 统一使用 `require_project_role` 装饰器，减少重复代码
- [项目负责人至少 2 人可能限制小团队] → 首版强制要求，后续版本可考虑可选

## Migration Plan

无数据迁移。`init_db` 的 `create_all` 自动创建新表（如有）；现有库与数据完全不动。回滚 = 删除新路由与服务，不影响存量功能。

## Open Questions

- 首版是否允许一个阶段同时有多名阶段负责人？当前默认只允许一名。