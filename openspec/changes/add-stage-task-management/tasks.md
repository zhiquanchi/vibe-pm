# Tasks: add-stage-task-management

## 1. 数据模型与 Schema

- [ ] 1.1 扩展 `tasks` 表新增 `stage_id` FK → `stages.id`
- [ ] 1.2 新增 `backend/app/schemas/task.py`：TaskCreate（包含 stage_id）、TaskUpdate、TaskMoveRequest（target_stage_id）
- [ ] 1.3 新增 `backend/app/schemas/stages.py`：TaskListFilters（status、priority、assignee、search）

## 2. 后端服务层

- [ ] 2.1 实现 `app/services/tasks.py`：创建任务、编辑任务、推进任务状态（状态转换校验）
- [ ] 2.2 实现 `app/services/tasks.py`：移动任务（检查目标阶段未完成；移出已启动阶段需填写原因）
- [ ] 2.3 实现 `app/services/tasks.py`：删除任务（检查未被依赖；检查非验收必需）
- [ ] 2.4 实现 `app/services/tasks.py`：我的任务列表（跨项目的未完成任务）
- [ ] 2.5 新增活动记录类型：`task_created`、`task_updated`、`task_moved`、`task_deleted`、`task_status_changed`

## 3. 后端路由

- [ ] 3.1 新增 `app/routers/tasks.py`：`POST /api/projects/{id}/stages/{sid}/tasks`、`GET /api/projects/{id}/stages/{sid}/tasks`
- [ ] 3.2 新增 `app/routers/tasks.py`：`PATCH /api/projects/{id}/tasks/{tid}`、`PUT /api/projects/{id}/tasks/{tid}/move`、`DELETE /api/projects/{id}/tasks/{tid}`
- [ ] 3.3 新增 `app/routers/tasks.py`：`GET /my-tasks`

## 4. 后端测试

- [ ] 4.1 `backend/tests/test_tasks.py`：创建任务、编辑任务、推进任务状态（spec 场景 1.x、3.x）
- [ ] 4.2 `backend/tests/test_tasks.py`：移动任务、删除任务（spec 场景 4.x）
- [ ] 4.3 `backend/tests/test_tasks.py`：我的任务列表（spec 场景 5.x）
- [ ] 4.4 回归：`uv run pytest` 全部通过

## 5. 前端

- [ ] 5.1 `/projects/:projectId/stages/:stageId` 阶段任务列表页：展示任务标题、负责人、优先级、计划日期、状态，支持筛选和排序
- [ ] 5.2 `/my-tasks` 我的任务页：展示跨项目的未完成任务，支持筛选
- [ ] 5.3 前端构建通过（`npm run build`），浏览器手工验证创建任务、编辑任务、推进任务、移动任务、删除任务、我的任务

## 6. 收尾

- [ ] 6.1 更新 `backend/README.md` 结构说明（新增 tasks 路由/服务）
- [ ] 6.2 `openspec validate add-stage-task-management` 通过