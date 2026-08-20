import { Navigate, createBrowserRouter } from 'react-router-dom';
import { GlobalLayout, ProjectLayout } from './layouts/ProjectLayout';
import { OverviewView } from './views/OverviewView';
import { ActivityView } from './views/ActivityView';
import { StagesView } from './views/StagesView';
import { StageWorkbenchView } from './views/StageWorkbenchView';
import { MembersView } from './views/MembersView';
import { SettingsView } from './views/SettingsView';
import { ProjectCreateView } from './views/ProjectCreateView';
import { MyTasksView } from './views/MyTasksView';
import { CopilotView } from './views/CopilotView';
import { NotFound } from './views/ErrorPages';
import { SprintListView } from './views/legacy/SprintListView';
import { SprintWorkspaceView } from './views/legacy/SprintWorkspaceView';
import { BacklogView } from './views/legacy/BacklogView';
import { ReportsView } from './views/legacy/ReportsView';

export const router = createBrowserRouter([
  {
    element: <GlobalLayout />,
    children: [
      // 保留演示默认落地行为：根路径进入项目 1 总览
      { path: '/', element: <Navigate to="/projects/1" replace /> },
      { path: '/my-tasks', element: <MyTasksView /> },
      { path: '/projects/new', element: <ProjectCreateView /> },
    ],
  },
  {
    path: '/projects/:projectId',
    element: <ProjectLayout />,
    children: [
      { index: true, element: <OverviewView /> },
      { path: 'stages', element: <StagesView /> },
      { path: 'stages/:stageId', element: <StageWorkbenchView /> },
      { path: 'activity', element: <ActivityView /> },
      { path: 'copilot', element: <CopilotView /> },
      { path: 'members', element: <MembersView /> },
      { path: 'settings', element: <SettingsView /> },
      // 兼容视图（Sprint 模型）
      { path: 'sprints', element: <SprintListView /> },
      { path: 'sprints/:sprintId', element: <SprintWorkspaceView /> },
      { path: 'backlog', element: <BacklogView /> },
      { path: 'reports', element: <ReportsView /> },
      { path: 'reports/:sprintId', element: <ReportsView /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
