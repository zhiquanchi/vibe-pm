# Proposal: add-stage-deliverables-and-acceptance

## Why

当前系统缺少阶段交付物和验收管理能力：用户无法配置阶段验收条件、提交阶段交付物、提交阶段验收、确认或驳回阶段验收。需要为阶段提供交付物管理和验收闭环。

## What Changes

- 新增阶段交付物实体（`stage_deliverables` 表）
- 新增阶段验收记录实体（`stage_acceptances` 表）
- 新增验收条件管理 API：配置必需任务和必需交付物
- 新增交付物提交 API：提交阶段交付物
- 新增阶段验收 API：提交阶段验收、确认或驳回阶段验收
- 已完成阶段保持只读

## Capabilities

### New Capabilities
- `deliverables-acceptance`: 阶段交付物管理（配置验收条件、提交交付物）、阶段验收流程（提交验收、确认或驳回）

### Modified Capabilities
（无——现有 `deliverables-acceptance` spec 已存在，本变更实现其需求）

## Impact

- **后端**：新增 `stage_deliverables`、`stage_acceptances` 表；新增验收条件管理、交付物提交、阶段验收 API
- **API**：新增 `/api/projects/{id}/stages/{sid}/deliverables` 系列端点；新增 `/api/projects/{id}/stages/{sid}/acceptances` 系列端点
- **前端**：新增阶段验收条件配置 UI、交付物提交 UI、阶段验收 UI
- **依赖**：无新增第三方依赖