## Context

后端为 FastAPI + SQLAlchemy 2.0，现有表：projects、profiles、project_members、stages、tasks、task_dependencies、task_blockers、stage_blockers、scope_changes、sprint_snapshots、project_activities、stage_deliverables、stage_acceptances。验收通过 `stage_acceptances` 表记录。

## Goals / Non-Goals

**Goals:**

- 新增验收条件管理 API：配置必需任务和必需交付物
- 新增交付物提交 API：提交阶段交付物
- 新增阶段验收 API：提交阶段验收、确认或驳回阶段验收
- 已完成阶段保持只读

**Non-Goals:**

- 不实现多级审批、会签或自定义审批流
- 不实现在线文档协同编辑
- 不实现电子签名或合规归档
- 不自动将阶段完成等同于项目完成

## Decisions

### D1：阶段交付物表结构

`stage_deliverables` 表包含 `stage_id` FK → `stages.id`、`name`、`type`（文档/代码/部署产物/其他）、`link`、`file_path`、`submitted_by` FK → `profiles.id`、`submitted_at`、`is_required`。

### D2：阶段验收表结构

`stage_acceptances` 表包含 `stage_id` FK → `stages.id`、`submitted_by` FK → `profiles.id`、`submitted_at`、`handled_by` FK → `profiles.id`、`handled_at`、`status`（pending/approved/rejected）、`notes`、`rejection_reason`。

### D3：验收条件校验

提交阶段验收时校验：
- 全部必需任务已完成
- 全部必需交付物已提交
- 不存在未解除阶段阻塞

### D4：验收职责矩阵

- 阶段负责人（非项目负责人）提交 → 任一项目负责人可处理
- 项目负责人 A 提交 → 其他项目负责人 B/C/... 可处理，A 不能处理自己提交的验收

### D5：API 形态

挂到既有 `/api/projects` 前缀：

- `GET /api/projects/{id}/stages/{sid}/deliverables`：阶段交付物列表
- `POST /api/projects/{id}/stages/{sid}/deliverables`：提交阶段交付物
- `PATCH /api/projects/{id}/stages/{sid}/deliverables/{did}`：更新交付物
- `DELETE /api/projects/{id}/stages/{sid}/deliverables/{did}`：删除交付物
- `POST /api/projects/{id}/stages/{sid}/deliverables/{did}/mark-required`：标记为必需
- `DELETE /api/projects/{id}/stages/{sid}/deliverables/{did}/mark-required`：取消必需标记
- `POST /api/projects/{id}/stages/{sid}/acceptances`：提交阶段验收
- `PATCH /api/projects/{id}/stages/{sid}/acceptances/{aid}`：确认或驳回验收

### D6：活动记录类型扩展

新增活动记录类型：
- `stage_deliverable_added`：添加交付物
- `stage_deliverable_updated`：更新交付物
- `stage_deliverable_removed`：删除交付物
- `stage_deliverable_required`：标记为必需
- `stage_deliverable_optional`：取消必需标记
- `stage_acceptance_submitted`：提交阶段验收
- `stage_acceptance_approved`：确认验收
- `stage_acceptance_rejected`：驳回验收

## Risks / Trade-offs

- [文件型交付物存储策略复杂] → 首版只记录外部存储地址，后续版本可接入文件存储服务
- [验收条件校验可能影响性能] → 使用缓存校验结果

## Migration Plan

无数据迁移。`init_db` 的 `create_all` 自动创建新表；现有库与数据完全不动。回滚 = 删除新路由与服务，不影响存量功能。

## Open Questions

- 本地文件由当前服务保存，还是首版只记录外部存储地址？