# Design: add-project-stage-foundation

## Context

后端为 FastAPI + SQLAlchemy 2.0（刚完成迁移），现有表：projects、profiles、project_members、sprints、tasks、scope_changes、sprint_snapshots。阶段（stage）是全新概念，与 Sprint 并存不动（见 proposal.md）。权限沿用现有开发身份层：`X-User-Id` 请求头 + `project_members.role='owner'` 判定项目负责人（`app/routers/projects.py` 已有同款模式）。

## Goals / Non-Goals

**Goals:**

- 新增 `stages` 与 `project_activities` 两张表及全部阶段管理 API。
- 主阶段唯一性由「事务内校验 + 数据库部分唯一索引」双重保证。
- 项目创建接口向后兼容：不传 stages 参数时用默认五阶段模板。

**Non-Goals:**

- 任务/交付物与阶段的关联（PRD-03/05），阶段验收流（PRD-05），活动记录的查询页（PRD-06）。
- Sprint 数据的迁移或清空。
- 真实认证（继续用 `X-User-Id` 开发头）。

## Decisions

### D1：阶段状态机保持三态，为后续状态预留扩展

`status: planned | active | completed`。受阻（blocked）、待验收（pending_acceptance）属于 PRD-04/05，本变更不引入；但「切换主阶段时原主阶段保持原状态转为并行」的逻辑按状态无关实现（只翻转 `is_primary`，不碰 `status`），天然满足「受阻或待验收阶段可保持主阶段身份」。替代方案（一次性引入全部状态）被否：非目标，且阻塞/验收语义未定义。

### D2：阶段如何进入 completed —— 提供最小手动完成动作

PRD-01 要求「已完成阶段不能删除或调整顺序」，但未定义完成路径（验收在 PRD-05）。为让锁定规则可达、可测，提供 owner 手动完成端点（仅 `active → completed`，不可逆，生成活动记录）。PRD-05 落地时改走验收流，此端点行为不变。

### D3：主阶段唯一性的双重保证

- 应用层：启动/指定主阶段在同一事务内完成「旧主阶段置并行 + 新主阶段置位」。
- 数据库层：`CREATE UNIQUE INDEX ... ON stages(project_id) WHERE is_primary = 1`（SQLite 部分索引，SQLAlchemy `Index(..., sqlite_where=...)`），兜底并发写入。「存在活动阶段时必须有主阶段」由应用层保证：首个启动阶段自动置主，主阶段不可直接取消（只能切换或随阶段完成而空置——完成主阶段后若仍有其他活动阶段，要求同请求指定新主阶段，否则拒绝）。

### D4：删除阶段的两段式确认协议

`DELETE /stages/{id}` 默认先返回 409 + 影响范围（关联任务数、交付物数），客户端二次确认时带 `?confirm=true` 执行删除。本变更中任务尚无 `stage_id`、交付物表不存在，影响计数恒为 0，但协议与测试先行固化；PRD-03/05 落地时只需替换计数查询。已完成阶段无论 confirm 与否一律 409。

### D5：活动记录独立成表，类型为自由字符串

`project_activities(id, project_id FK, type, description, created_by, created_at)`。类型如 `project_created / stage_created / stage_renamed / stage_reordered / stage_deleted / stage_started / primary_changed / stage_completed`。本变更只写不读（查询属 PRD-06），description 存人类可读文案，避免过早设计结构化 payload。

### D6：默认模板由后端提供

常量 `DEFAULT_STAGE_TEMPLATE = ["需求分析", "技术设计", "开发", "测试", "发布"]` 放后端，经 `GET /api/stage-template` 暴露给创建页（AC：创建页展示五个默认阶段），避免前后端各写一份漂移。

### D7：API 形态

挂到既有 `/api/projects` 前缀，复用 `require_project_member` 模式：

- `GET /api/stage-template`：默认模板。
- `POST /api/projects`：扩展可选 `stages` 数组（name 必填，goal/owner_id/planned_start/planned_end 可选），缺省用模板；创建后批量插入阶段并记录 `project_created` 活动。
- `GET /api/projects/{id}/stages`：按 position 返回阶段列表（含 is_primary 标识）。
- `POST /api/projects/{id}/stages`：新增阶段（owner 限定，追加到末尾）。
- `PATCH /api/projects/{id}/stages/{sid}`：重命名/目标/负责人/计划日期（owner 限定；已完成阶段仅允许改负责人与日期，名称与顺序锁定）。
- `PUT /api/projects/{id}/stages/reorder`：提交未完成阶段的有序 id 列表；已完成阶段位置冻结，请求中含已完成阶段 id 即 409。
- `DELETE /api/projects/{id}/stages/{sid}[?confirm=true]`：D4 协议；删除后重排 position 并记录活动。删除的是主阶段且仍有其他活动阶段时，自动提升 position 最小的活动阶段为主阶段并记录 `primary_changed`（保持 D3 不变式；实现中补充的决策）。
- `POST /api/projects/{id}/stages/{sid}/start`：`{primary: bool}`，仅 planned → active；首个活动阶段强制为 primary。
- `POST /api/projects/{id}/stages/{sid}/primary`：指定某 active 阶段为主阶段。
- `POST /api/projects/{id}/stages/{sid}/complete`：D2。

### D8：前端三页

沿用现有 React + Vite + TS 栈（`frontend/src`）：

- `/projects/new`：模板阶段可增删改排序的创建表单。
- `/projects/:projectId/stages`：阶段列表（名称、顺序、负责人、状态、计划日期、主/并行文字标识，空态与错误态）。
- `/projects/:projectId/stages/:stageId`：工作台占位页（仅展示阶段信息）。

## Risks / Trade-offs

- [部分唯一索引只约束「最多一个主阶段」，不约束「至少一个」] → 应用层在启动/完成/指定主阶段的事务内维护不变式，并用测试覆盖全部迁移路径。
- [完成任务与阶段并存两套推进模型，语义上可能让使用者困惑] → 本变更刻意不打通，PRD-03 统一任务归属时再收敛；在 API 文档与提案中明确并存是过渡态。
- [手动完成端点未来与验收流并存可能产生绕过] → PRD-05 落地时评估保留手动完成还是改为仅验收完成，届时走新 change。
- [活动记录只写不读，字段设计可能不满足 PRD-06] → 保持最简字段，PRD-06 需要扩展时以 ALTER 补丁演进（沿用 init_db 惯例）。

## Migration Plan

无数据迁移。`init_db` 的 `create_all` 自动创建两张新表；现有库与数据完全不动。回滚 = 删除新表与新路由，不影响存量功能。
