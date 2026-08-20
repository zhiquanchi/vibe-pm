# Tasks: add-project-overview-and-activity

## 1. 后端服务层

- [x] 1.1 实现 `app/services/projects.py`：项目总览聚合（主阶段、并行阶段、任务进度、阻塞、验收）
- [x] 1.2 实现 `app/services/projects.py`：项目风险展示（未解除阻塞、逾期事项）
- [x] 1.3 实现 `app/services/projects.py`：活动记录查询（按阶段、事件类型和操作人筛选）

## 2. 后端路由

- [x] 2.1 新增 `app/routers/projects.py`：`GET /api/projects/{id}/overview`
- [x] 2.2 新增 `app/routers/projects.py`：`GET /api/projects/{id}/risks`
- [x] 2.3 新增 `app/routers/projects.py`：`GET /api/projects/{id}/activities`

## 3. 后端测试

- [x] 3.1 `backend/tests/test_projects.py`：项目总览聚合（spec 场景 1.x）
- [x] 3.2 `backend/tests/test_projects.py`：项目风险展示（spec 场景 2.x）
- [x] 3.3 `backend/tests/test_projects.py`：活动记录查询（spec 场景 3.x）
- [x] 3.4 回归：`uv run pytest` 全部通过

## 4. 前端

- [x] 4.1 `/projects/:projectId` 项目总览页：展示项目基本信息、主阶段、并行阶段、风险、活动记录
- [x] 4.2 `/projects/:projectId/activity` 活动记录页：按时间倒序展示活动记录，支持筛选
- [x] 4.3 前端构建通过（`npm run build`），浏览器手工验证项目总览、风险展示、活动记录

## 5. 收尾

- [x] 5.1 更新 `backend/README.md` 结构说明（新增 projects 路由/服务）
- [x] 5.2 `openspec validate add-project-overview-and-activity` 通过
