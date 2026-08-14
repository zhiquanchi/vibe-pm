import { defineConfig } from '@umijs/max';

export default defineConfig({
  npmClient: 'npm',
  // 开发态把 /api 代理到真实后端，浏览器同源、绕开 CORS 与 X-User-Id 预检
  proxy: {
    '/api': {
      target: 'http://127.0.0.1:8000',
      changeOrigin: true,
    },
  },
  // 启用 antd（主题 token 在 src/layouts/MainLayout.tsx 的 ConfigProvider 注入）
  antd: {},
  // 别名 @/* -> src/* 由 Umi Max 默认提供，无需显式配置
  // 端口通过运行时 PORT=5173 注入（避开后端常驻 8000），不在此写死
  //
  // 显式路由表：约定式路由在本环境下会把动态段生成为 [projectId]，而 React Router v6
  // 只识别 :projectId，导致 /projects/:projectId 等全部落到 404 兜底。这里改用显式配置、
  // 用 RRv6 的 :param 语法，绕过该生成问题。src/layouts/index.tsx 全局布局始终自动生效。
  routes: [
    { path: '/', component: '@/pages/index' },
    { path: '/projects/new', component: '@/pages/projects/new' },
    { path: '/projects/:projectId', component: '@/pages/projects/[projectId]' },
    { path: '/projects/:projectId/sprints', component: '@/pages/projects/[projectId]/sprints/index' },
    { path: '/projects/:projectId/sprints/:sprintId', component: '@/pages/projects/[projectId]/sprints/[sprintId]' },
    { path: '/projects/:projectId/backlog', component: '@/pages/projects/[projectId]/backlog' },
    { path: '/projects/:projectId/reports', component: '@/pages/projects/[projectId]/reports' },
    { path: '/projects/:projectId/reports/:sprintId', component: '@/pages/projects/[projectId]/reports/[sprintId]' },
    { path: '/projects/:projectId/stages', component: '@/pages/projects/[projectId]/stages/index' },
    { path: '/projects/:projectId/stages/:stageId', component: '@/pages/projects/[projectId]/stages/[stageId]' },
    { path: '/projects/:projectId/members', component: '@/pages/projects/[projectId]/members' },
    { path: '/projects/:projectId/settings', component: '@/pages/projects/[projectId]/settings' },
    { path: '/projects/:projectId/integrations', component: '@/pages/projects/[projectId]/integrations' },
    { path: '/my-tasks', component: '@/pages/my-tasks' },
    { path: '*', component: '@/pages/404' },
  ],
});
