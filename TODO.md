# TODO — Vibe PM 编码阶段（OpenSpec 变更实现）

PRD-03「阶段任务管理」已完成并逐任务提交。以下为剩余待实现的 OpenSpec 变更，按依赖顺序推进。
每个变更在 `openspec/changes/<name>/tasks.md` 含细化任务清单；实现时每完成一项任务创建一个 git 提交。
编码工作通过 subagent 完成，主代理负责提交。

## 待办（按顺序）

### 1. PRD-04 `add-task-dependencies-and-blockers` — 任务依赖与阻塞 ✅ 已完成
- [x] 数据模型：`task_dependencies`、`task_blockers`、`stage_blockers` 表
- [x] 服务层：添加/移除前置依赖（循环依赖校验）、标记/解除任务阻塞、标记/解除阶段阻塞、确认阻塞已解除
- [x] 补全 PRD-03 删除任务时预留的「被依赖」拦截接入点（`_guard_delete`）
- [x] 路由：依赖/阻塞的增删查端点
- [x] 后端测试 + 前端扩展（任务详情页依赖/阻塞，阶段详情页阻塞）

### 2. PRD-05 `add-stage-deliverables-and-acceptance` — 阶段交付物与验收
- [ ] 数据模型：`stage_deliverables`、`stage_acceptances` 表
- [ ] 服务层：添加/更新/删除交付物、标记必需、提交/确认/驳回验收、重新打开已完成阶段
- [ ] 补全 PRD-03 删除任务时预留的「验收必需」拦截接入点
- [ ] 路由：交付物与验收端点
- [ ] 后端测试 + 前端扩展（阶段详情页交付物/验收）

### 3. PRD-06 `add-project-overview-and-activity` — 项目总览与活动
- [ ] 服务层：项目总览聚合、风险（未解除阻塞/逾期）、活动记录查询（筛选）
- [ ] 路由：`/overview`、`/risks`、`/activities`
- [ ] 后端测试 + 前端（项目总览页、活动记录页）

### 4. PRD-07 `add-ai-project-copilot` — AI 项目副驾驶
- [ ] 服务层 `app/services/copilot.py`：项目摘要、阶段风险分析、个人行动建议、管理问答、近期变化回顾
- [ ] 路由 `app/routers/copilot.py`：5 个端点
- [ ] 后端测试 + 前端（AI 副驾驶页）

## 备注
- 运行 `openspec validate <change>` 确认变更通过；完成后将对应 `changes/<name>/tasks.md` 勾选并归档。
- 后端回归：`cd backend && uv run pytest`；前端：`cd frontend && npm run build`。
