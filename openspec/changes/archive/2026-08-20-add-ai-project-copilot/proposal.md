# Proposal: add-ai-project-copilot

## Why

当前系统缺少 AI 项目管理副驾驶能力：用户无法生成项目状态摘要、分析阶段推进风险、获得个人行动建议、进行项目管理问答、回顾项目近期变化。需要为项目提供 AI 项目管理副驾驶，帮助用户快速理解项目现状、发现值得关注的风险，并获得可执行的下一步行动建议。

## What Changes

- 新增 AI 项目摘要 API：生成项目状态摘要
- 新增 AI 阶段风险分析 API：分析阶段推进风险
- 新增 AI 个人行动建议 API：根据用户任务生成个人行动建议
- 新增 AI 项目管理问答 API：自然语言询问项目问题
- 新增 AI 项目近期变化回顾 API：总结指定时间范围内的项目变化

## Capabilities

### New Capabilities
- `ai-copilot`: AI 项目摘要、阶段风险分析、个人行动建议、项目管理问答、近期变化回顾

### Modified Capabilities
（无——现有 `ai-copilot` spec 已存在，本变更实现其需求）

## Impact

- **后端**：新增 AI 项目摘要、阶段风险分析、个人行动建议、项目管理问答、近期变化回顾 API
- **API**：新增 `/api/projects/{id}/copilot/summary` 端点；新增 `/api/projects/{id}/stages/{sid}/copilot/analysis` 端点；新增 `/api/my-tasks/copilot/advice` 端点；新增 `/api/projects/{id}/copilot/chat` 端点；新增 `/api/projects/{id}/copilot/changes` 端点
- **前端**：新增 AI 副驾驶 UI
- **依赖**：需要接入 AI 模型 API（如豆包）