# 前端迁移至 Umi Max — 交接文档

- **Tag**: `frontend-umi-max`
- **分支**: `refactor/frontend-umi-max`
- **日期**: 2026-08-14
- **范围**: `frontend/` 由 Vite + React 19 迁移到 Umi Max 4.7.5（antd v5 栈）

## 1. 背景与目标

将原 Vite 单文件 SPA（所有页面逻辑集中在 `src/main.tsx` 的 `App()` 里、通过 props 层层下发状态）
重构为 Umi Max 约定式/显式路由的多页应用，拆分出独立的页面、布局、服务层与组件，
并保持与既有真实后端（FastAPI，端口 8000）对接不变。

## 2. 技术栈变更

| 项 | 迁移前 | 迁移后 |
|---|---|---|
| 构建/路由 | Vite + React Router（手写） | `@umijs/max` 4.7.5（内置 RRv6） |
| UI | antd v5 + lucide-react | antd v5 + `@ant-design/icons` v4 |
| 图表 | recharts | `echarts-for-react` + echarts 6 |
| 环境变量 | `import.meta.env.VITE_*` | `process.env.UMI_APP_*` |
| 动态路由段 | — | 显式 `routes`（`:param`） |

主要依赖：`@umijs/max`、`antd@^5.25`、`@ant-design/icons@^4.8.3`、`echarts@^6.1`、`echarts-for-react@^3`、`antd-style`、`react@^18.3`。

## 3. 架构要点

- **全局布局 / 全局状态**：`src/layouts/index.tsx`（Umi 约定全局布局入口，默认生效）再导出
  `src/layouts/MainLayout.tsx`。`MainLayout` 通过 React Context（`AppContext` + `useAppContext`）
  提供原 `App()` 经 props 下发的全局状态（projectId / sprints / members / notices / 当前迭代 /
  刷新 / toast 等）。所有页面用 `useAppContext()` 取状态，不再 props 透传。
- **路由**：`config/config.ts` 中**显式 `routes` 配置**（见第 4 节为何不用约定式）。全局布局始终自动包裹全部路由。
- **服务层**：`src/services/api/client.ts` 的 `ApiClient` 保留完整接口；`getApiBaseUrl()` /
  `getUserId()` 改读 `process.env.UMI_APP_API_BASE_URL` / `UMI_APP_USER_ID`。
- **类型**：`src/types/index.ts`、`src/types/api.ts` 未改动，全量保留。
- **Hooks**：`src/hooks/*`（6 个）仅改 `@/` 别名导入。
- **通用组件**：抽取 `src/components/common.tsx`（`PageHeader` / `Modal` / `Metric` / `EmptyState` /
  `ErrorState`）与 `src/utils/format.ts`（`statusLabel` / `statusTone` / `formatDate` / `sprintPath` 等）。
- **页面**（15 个）：总览、迭代列表/工作区、阶段列表/工作台、Backlog、报告、任务、成员、设置、
  集成、新建项目、404 兜底；统一经 `useAppContext` 取状态。

## 4. 关键问题修复：动态路由全部 404

**现象**：访问 `/projects/1` 等真实地址也落到 404 兜底页（用户反馈“都是404”）。

**根因**：本环境下 Umi 生成的路由表（`src/.umi/core/route.tsx`）把动态段写成
`"path": "projects/[projectId]"`（方括号），而 React Router v6 **只识别 `:projectId`**，
不识别 `[projectId]`；renderer（`@umijs/renderer-react`）在把路由交给 RRv6 时也不做转换。
结果 `/projects/1` 匹配不到具体路由，全部落入 `*` 兜底。

**修复**：`config/config.ts` 改用**显式 `routes` 配置**并统一用 RRv6 的 `:param` 语法
（如 `/projects/:projectId`、`/projects/:projectId/sprints/:sprintId`），绕过约定式生成。
重新生成后 `route.tsx` 路径变为 `:projectId`，客户端路由恢复正常；仅真正不存在的地址（如
`/nonexistent`）才进 404。

**验证**：`matchRoutes` 复测全部路由匹配正确；`max build` 生产构建通过（所有页面 chunk 完整编译，无 error）。

> 注意：若未来切回“约定式路由”（`src/pages` 下 `[param]` 文件夹），需先确认本环境
> `@umijs/renderer-react` 是否正确转换 `[param]`→`:param`，否则会再次出现动态路由 404。

## 5. 运行方式

```bash
cd frontend
npm install
PORT=5173 npm run dev      # 开发，代理 /api -> http://127.0.0.1:8000
PORT=5173 npm run build    # 生产构建到 dist/
PORT=5173 npm run preview  # 预览生产构建
```

- 端口经 `PORT` 环境变量注入（避开常驻后端 8000）；`config/config.ts` 不再写死 `port`。
- 环境变量样例见 `frontend/.env.example`（`UMI_APP_API_BASE_URL`、`UMI_APP_USER_ID`）。
- 后端需在线：`/api/health` 返回 `{"status":"ok"}` 方可正常拉取数据。

## 6. 版本控制注意

- `src/.umi/`、`src/.umi-production/`、`dist/`、`.env*` 已加入 `.gitignore`（生成产物/密钥不入库）。
- `.codebuddy/skills/demo-page-builder` 是指向外部仓库（`/root/prd-demo-react`）的**绝对路径 symlink**，
  已在根 `.gitignore` 忽略，克隆后不会生效，需在本机重新建立。
- 提交按单元拆分：脚手架/配置 → 服务层/Hooks → 布局/组件 → 页面，便于 review。

## 7. 待办 / 后续

- 浏览器端全链路回归（各页面交互、通知抽屉、迭代工作区编辑等）。
- 确认 `@umijs/renderer-react` 转换行为（见第 4 节）后再评估是否可恢复约定式路由。
- 视需要补充单测。
