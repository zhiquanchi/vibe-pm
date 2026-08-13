# Tasks: add-task-dependencies-and-blockers

## 1. 数据模型与 Schema

- [x] 1.1 新增 `task_dependencies` 表（task_id FK、dependency_id FK、created_at）
- [x] 1.2 新增 `task_blockers` 表（task_id FK、reason、handler_id FK、created_by、created_at、resolved_at、resolution）
- [x] 1.3 新增 `stage_blockers` 表（stage_id FK、reason、handler_id FK、created_by、created_at、resolved_at、resolution）
- [x] 1.4 新增 `backend/app/schemas/tasks.py`：TaskDependencyCreate、TaskBlockerCreate、TaskBlockerResolve、StageBlockerCreate、StageBlockerResolve

## 2. 后端服务层

- [x] 2.1 实现 `app/services/tasks.py`：添加前置依赖（循环依赖校验）
- [x] 2.2 实现 `app/services/tasks.py`：移除前置依赖
- [x] 2.3 实现 `app/services/tasks.py`：标记任务阻塞
- [x] 2.4 实现 `app/services/tasks.py`：解除任务阻塞
- [x] 2.5 实现 `app/services/tasks.py`：标记阶段阻塞
- [x] 2.6 实现 `app/services/tasks.py`：解除阶段阻塞
- [x] 2.7 实现 `app/services/tasks.py`：确认阻塞已解除
- [x] 2.8 新增活动记录类型：`task_dependency_added`、`task_dependency_removed`、`task_blocker_created`、`task_blocker_resolved`、`stage_blocker_created`、`stage_blocker_resolved`

## 3. 后端路由

- [x] 3.1 新增 `app/routers/tasks.py`：`POST /api/projects/{id}/tasks/{tid}/dependencies`、`GET /api/projects/{id}/tasks/{tid}/dependencies`、`DELETE /api/projects/{id}/tasks/{tid}/dependencies/{dep_id}`
- [x] 3.2 新增 `app/routers/tasks.py`：`POST /api/projects/{id}/tasks/{tid}/blockers`、`PATCH /api/projects/{id}/tasks/{tid}/blockers/{bid}`、`GET /api/projects/{id}/tasks/{tid}/blockers`
- [x] 3.3 新增 `app/routers/tasks.py`：`POST /api/projects/{id}/stages/{sid}/blockers`、`PATCH /api/projects/{id}/stages/{sid}/blockers/{bid}`、`GET /api/projects/{id}/stages/{sid}/blockers`
- [x] 3.4 新增 `app/routers/tasks.py`：`POST /api/projects/{id}/tasks/{tid}/confirm-blocker`

## 4. 后端测试

- [x] 4.1 `backend/tests/test_tasks.py`：添加前置依赖、循环依赖校验（spec 场景 1.x）
- [x] 4.2 `backend/tests/test_tasks.py`：标记任务阻塞、解除任务阻塞（spec 场景 3.x）
- [x] 4.3 `backend/tests/test_tasks.py`：标记阶段阻塞、解除阶段阻塞（spec 场景 4.x）
- [x] 4.4 `backend/tests/test_tasks.py`：确认阻塞已解除（spec 场景 5.x）
- [x] 4.5 回归：`uv run pytest` 全部通过

## 5. 前端

- [x] 5.1 任务详情页扩展：展示前置依赖、历史阻塞记录，owner 可添加/移除依赖
- [x] 5.2 任务详情页扩展：标记/解除任务阻塞、确认阻塞已解除
- [x] 5.3 阶段详情页扩展：标记/解除阶段阻塞
- [x] 5.4 前端构建通过（`npm run build`），浏览器手工验证添加依赖、循环依赖校验、标记阻塞、解除阻塞、确认阻塞

## 6. 收尾

- [x] 6.1 更新 `backend/README.md` 结构说明（新增 tasks 路由/服务）
- [x] 6.2 `openspec validate add-task-dependencies-and-blockers` 通过