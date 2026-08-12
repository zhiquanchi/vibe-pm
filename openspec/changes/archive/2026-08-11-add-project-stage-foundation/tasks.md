# Tasks: add-project-stage-foundation

## 1. 数据模型与 Schema

- [x] 1.1 在 `backend/app/db/models.py` 新增 `Stage` 模型（id、project_id FK、name、goal、position、owner_id FK→profiles、planned_start、planned_end、status、is_primary、created_at）与部分唯一索引 `Index("uq_stages_primary", project_id, unique=True, sqlite_where=is_primary == true())`
- [x] 1.2 新增 `ProjectActivity` 模型（id、project_id FK、type、description、created_by、created_at）及 `(project_id, created_at)` 索引
- [x] 1.3 新增 `backend/app/schemas/stages.py`：StageCreate、StageUpdate、StageStartRequest（primary: bool）、ReorderRequest（有序 id 列表）、ProjectCreate 扩展可选 stages 数组（名称非空、项目内去重、至少一个阶段的校验）
- [x] 1.4 新增 `DEFAULT_STAGE_TEMPLATE` 常量（需求分析/技术设计/开发/测试/发布），放 `app/services/stages.py`

## 2. 后端服务层

- [x] 2.1 实现 `app/services/stages.py`：项目创建时批量插入阶段（缺省用模板）并写 `project_created` 活动
- [x] 2.2 实现阶段新增/重命名/资料更新（owner 限定；已完成阶段锁定名称与顺序）与 `stage_created/stage_renamed` 活动记录
- [x] 2.3 实现 reorder：仅未完成阶段可排序，请求含已完成阶段 id 返回 409，记录 `stage_reordered` 活动
- [x] 2.4 实现两段式删除：无 confirm 返回 409+影响计数，`confirm=true` 执行删除并重排 position，已完成阶段一律 409，记录 `stage_deleted` 活动
- [x] 2.5 实现 start：planned→active，首个活动阶段强制 primary，事务内完成新旧主阶段翻转，记录 `stage_started/primary_changed` 活动
- [x] 2.6 实现指定主阶段（仅 active 阶段）与手动完成（active→completed；完成主阶段且仍有其他活动阶段时要求同请求指定继任主阶段，否则 409）

## 3. 后端路由

- [x] 3.1 新增 `app/routers/stages.py`：`GET /api/stage-template`、`GET/POST /api/projects/{id}/stages`、`PATCH/DELETE /api/projects/{id}/stages/{sid}`、`PUT /api/projects/{id}/stages/reorder`、`POST .../start`、`POST .../primary`、`POST .../complete`，复用 `require_project_member` 与 get_db
- [x] 3.2 扩展 `app/routers/projects.py` 的 create_project 支持可选 stages 参数（向后兼容）
- [x] 3.3 在 `app/main.py` 注册 stages 路由

## 4. 后端测试

- [x] 4.1 `backend/tests/test_stages.py`：模板创建/自定义创建/空名/重名/空列表校验（对应 spec 场景 1.x）
- [x] 4.2 结构管理测试：新增、重命名、reorder、删除二次确认、已完成锁定、非 owner 403、活动记录生成（spec 2.x）
- [x] 4.3 启动与主阶段测试：首个自动主阶段、并行启动、切换主阶段、唯一主阶段不变式、完成主阶段需指定继任（spec 3.x）
- [x] 4.4 列表接口测试：字段齐全、按 position 排序、is_primary 标识（spec 4.x）
- [x] 4.5 回归：`uv run pytest` 全部通过（含既有 13 个测试）

## 5. 前端

- [x] 5.1 `/projects/new` 创建页：从 `GET /api/stage-template` 加载默认阶段，支持增删改排序与校验提示
- [x] 5.2 `/projects/:projectId/stages` 阶段列表页：展示名称/顺序/负责人/状态/计划日期，主/并行文字标识，空态与加载失败反馈
- [x] 5.3 `/projects/:projectId/stages/:stageId` 工作台占位页
- [x] 5.4 前端构建通过（`npm run build`），浏览器手工验证默认创建、自定义创建、首次启动、并行启动、主阶段切换

## 6. 收尾

- [x] 6.1 更新 `backend/README.md` 结构说明（新增 stages 路由/服务）
- [x] 6.2 `openspec validate add-project-stage-foundation` 通过
