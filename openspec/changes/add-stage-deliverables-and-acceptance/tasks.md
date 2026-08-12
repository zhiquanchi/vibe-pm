# Tasks: add-stage-deliverables-and-acceptance

## 1. 数据模型与 Schema

- [ ] 1.1 新增 `stage_deliverables` 表（stage_id FK、name、type、link、file_path、submitted_by FK、submitted_at、is_required）
- [ ] 1.2 新增 `stage_acceptances` 表（stage_id FK、submitted_by FK、submitted_at、handled_by FK、handled_at、status、notes、rejection_reason）
- [ ] 1.3 新增 `backend/app/schemas/stages.py`：StageDeliverableCreate、StageDeliverableUpdate、StageAcceptanceSubmit、StageAcceptanceHandle

## 2. 后端服务层

- [ ] 2.1 实现 `app/services/stages.py`：添加交付物、更新交付物、删除交付物
- [ ] 2.2 实现 `app/services/stages.py`：标记/取消交付物为必需
- [ ] 2.3 实现 `app/services/stages.py`：提交阶段验收（校验条件）
- [ ] 2.4 实现 `app/services/stages.py`：确认或驳回阶段验收
- [ ] 2.5 实现 `app/services/stages.py`：重新打开已完成阶段
- [ ] 2.6 新增活动记录类型：`stage_deliverable_added`、`stage_deliverable_updated`、`stage_deliverable_removed`、`stage_deliverable_required`、`stage_deliverable_optional`、`stage_acceptance_submitted`、`stage_acceptance_approved`、`stage_acceptance_rejected`

## 3. 后端路由

- [ ] 3.1 新增 `app/routers/stages.py`：`GET /api/projects/{id}/stages/{sid}/deliverables`、`POST /api/projects/{id}/stages/{sid}/deliverables`
- [ ] 3.2 新增 `app/routers/stages.py`：`PATCH /api/projects/{id}/stages/{sid}/deliverables/{did}`、`DELETE /api/projects/{id}/stages/{sid}/deliverables/{did}`
- [ ] 3.3 新增 `app/routers/stages.py`：`POST /api/projects/{id}/stages/{sid}/deliverables/{did}/mark-required`、`DELETE /api/projects/{id}/stages/{sid}/deliverables/{did}/mark-required`
- [ ] 3.4 新增 `app/routers/stages.py`：`POST /api/projects/{id}/stages/{sid}/acceptances`
- [ ] 3.5 新增 `app/routers/stages.py`：`PATCH /api/projects/{id}/stages/{sid}/acceptances/{aid}`

## 4. 后端测试

- [ ] 4.1 `backend/tests/test_stages.py`：添加交付物、更新交付物、删除交付物（spec 场景 2.x）
- [ ] 4.2 `backend/tests/test_stages.py`：标记/取消交付物为必需（spec 场景 1.x）
- [ ] 4.3 `backend/tests/test_stages.py`：提交阶段验收（spec 场景 3.x）
- [ ] 4.4 `backend/tests/test_stages.py`：确认或驳回阶段验收（spec 场景 4.x）
- [ ] 4.5 `backend/tests/test_stages.py`：重新打开已完成阶段（spec 场景 5.x）
- [ ] 4.6 回归：`uv run pytest` 全部通过

## 5. 前端

- [ ] 5.1 阶段详情页扩展：展示交付物列表，owner 可添加/更新/删除交付物
- [ ] 5.2 阶段详情页扩展：标记/取消交付物为必需
- [ ] 5.3 阶段详情页扩展：提交阶段验收、确认或驳回验收
- [ ] 5.4 阶段详情页扩展：重新打开已完成阶段
- [ ] 5.5 前端构建通过（`npm run build`），浏览器手工验证添加交付物、提交验收、确认或驳回验收

## 6. 收尾

- [ ] 6.1 更新 `backend/README.md` 结构说明（新增 stages 路由/服务）
- [ ] 6.2 `openspec validate add-stage-deliverables-and-acceptance` 通过