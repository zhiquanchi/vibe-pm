# Tasks: add-ai-project-copilot

## 1. 后端服务层

- [x] 1.1 实现 `app/services/copilot.py`：AI 项目摘要（实时读取项目数据）
- [x] 1.2 实现 `app/services/copilot.py`：AI 阶段风险分析（实时读取阶段数据）
- [x] 1.3 实现 `app/services/copilot.py`：AI 个人行动建议（实时读取用户任务）
- [x] 1.4 实现 `app/services/copilot.py`：AI 项目管理问答（实时读取项目数据）
- [x] 1.5 实现 `app/services/copilot.py`：AI 项目近期变化回顾（实时读取项目数据）

## 2. 后端路由

- [x] 2.1 新增 `app/routers/copilot.py`：`POST /api/projects/{id}/copilot/summary`
- [x] 2.2 新增 `app/routers/copilot.py`：`POST /api/projects/{id}/stages/{sid}/copilot/analysis`
- [x] 2.3 新增 `app/routers/copilot.py`：`GET /my-tasks/copilot/advice`
- [x] 2.4 新增 `app/routers/copilot.py`：`POST /api/projects/{id}/copilot/chat`
- [x] 2.5 新增 `app/routers/copilot.py`：`GET /api/projects/{id}/copilot/changes`

## 3. 后端测试

- [x] 3.1 `backend/tests/test_copilot.py`：AI 项目摘要（spec 场景 1.x）
- [x] 3.2 `backend/tests/test_copilot.py`：AI 阶段风险分析（spec 场景 2.x）
- [x] 3.3 `backend/tests/test_copilot.py`：AI 个人行动建议（spec 场景 3.x）
- [x] 3.4 `backend/tests/test_copilot.py`：AI 项目管理问答（spec 场景 4.x）
- [x] 3.5 `backend/tests/test_copilot.py`：AI 项目近期变化回顾（spec 场景 5.x）
- [x] 3.6 `backend/tests/test_copilot.py`：权限与决策责任（spec 场景 6.x）
- [x] 3.7 回归：`uv run pytest` 全部通过

## 4. 前端

- [ ] 4.1 `/projects/:projectId/copilot` AI 副驾驶页：项目摘要、阶段风险分析、个人行动建议、项目管理问答、近期变化回顾
- [ ] 4.2 前端构建通过（`npm run build`），浏览器手工验证 AI 副驾驶功能

## 5. 收尾

- [x] 5.1 更新 `backend/README.md` 结构说明（新增 copilot 路由/服务）
- [x] 5.2 `openspec validate add-ai-project-copilot` 通过
