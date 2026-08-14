import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Outlet, useLocation, useNavigate } from '@umijs/max';
import { App as AntdApp, ConfigProvider, Drawer, Dropdown, Empty } from 'antd';
import {
  BarChartOutlined,
  BellOutlined,
  BranchesOutlined,
  CheckOutlined,
  CloseOutlined,
  DashboardOutlined,
  DownOutlined,
  EllipsisOutlined,
  FlagOutlined,
  InboxOutlined,
  LogoutOutlined,
  PlusOutlined,
  ProjectOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { ApiError, apiClient, getUserId } from '@/services/api';
import type { Project, ProjectMember, ScopeChange, Sprint, SprintStatus } from '@/types';
import '../styles.css';
import '../backlog.css';
import '../app-shell.css';
import '../stages.css';

const DEFAULT_PROJECT_ID = 1;
const statusLabel: Record<SprintStatus, string> = { planning: '规划中', active: '进行中', completed: '已完成' };
const statusTone: Record<SprintStatus, string> = { planning: 'planning', active: 'active', completed: 'completed' };
const themeToken = { colorPrimary: '#7056df', borderRadius: 7, colorBgLayout: '#f7f8fa', fontFamily: "'DM Sans', sans-serif" };
const navIconStyle: React.CSSProperties = { fontSize: 17 };

export type Notice = { id: string; type: 'scope' | 'start' | 'end'; title: string; detail: string; sprintId: number; changeId?: number; read?: boolean };

/** 原单文件 SPA 的 App() 通过 props 下发的全局状态，改由 Context 提供。 */
export type AppContextValue = {
  projectId: number;
  project: Project | null;
  sprints: Sprint[];
  members: ProjectMember[];
  notices: Notice[];
  currentSprint: Sprint | null;
  currentSprintId: number | null;
  isOwner: boolean;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onToast: (message: string) => void;
  onNotice: (change: ScopeChange, sprintId: number) => void;
  setProject: React.Dispatch<React.SetStateAction<Project | null>>;
  setSprints: React.Dispatch<React.SetStateAction<Sprint[]>>;
  setNotices: React.Dispatch<React.SetStateAction<Notice[]>>;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useAppContext 必须在 MainLayout 内部使用');
  return value;
}

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(`${value.slice(0, 10)}T00:00:00`)) : '-';
}
function formatRange(sprint?: Sprint | null) {
  return sprint ? `${formatDate(sprint.start_date)} - ${formatDate(sprint.end_date)}` : '暂无日期';
}
function errorText(error: unknown) {
  return error instanceof ApiError && error.status === 403 ? '你没有访问该项目的权限' : error instanceof Error ? error.message : '请求失败，请稍后重试';
}

type NavKey = 'overview' | 'sprints' | 'reports' | 'backlog' | 'stages' | 'my-tasks' | 'members' | 'integrations' | 'project-new' | 'settings';

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const projectId = Number(location.pathname.match(/\/projects\/(\d+)/)?.[1]) || DEFAULT_PROJECT_ID;

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'notifications' | 'user' | null>(null);
  const [sprintMenu, setSprintMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const pathSprintId = Number(location.pathname.match(/\/(?:sprints|reports)\/(\d+)/)?.[1]) || null;
  const querySprintId = Number(new URLSearchParams(location.search).get('sprint_id')) || null;
  const currentSprintId = pathSprintId || querySprintId || sprints.find((item) => item.status === 'active')?.id || null;
  const currentSprint = sprints.find((item) => item.id === currentSprintId) || null;
  const isOwner = members.find((member) => member.id === getUserId())?.role === 'owner' || getUserId() === 'demo-user';
  const unread = notices.filter((item) => !item.read).length;
  const sprintPath = (id: number) => `/projects/${projectId}/sprints/${id}`;

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const refreshMeta = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSprints, detail] = await Promise.all([apiClient.listSprints(), apiClient.getProject(projectId)]);
      setForbidden(false);
      setSprints(nextSprints);
      setProject(detail.project);
      setMembers(detail.members);
      const recentChanges = (await Promise.all(nextSprints.map((sprint) => apiClient.listScopeChanges(sprint.id).catch(() => [] as ScopeChange[])))).flat().slice(0, 10);
      const nextNotices = nextSprints.reduce<Notice[]>((items, sprint) => {
        if (sprint.status === 'active') items.push({ id: `start-${sprint.id}`, type: 'start', title: `${sprint.name} 正在进行`, detail: '迭代已开始，继续关注范围变化。', sprintId: sprint.id });
        if (sprint.status === 'completed') items.push({ id: `end-${sprint.id}`, type: 'end', title: `${sprint.name} 已结束`, detail: '迭代报告已准备好查看。', sprintId: sprint.id });
        return items;
      }, []);
      recentChanges.forEach((change) => nextNotices.push({ id: `change-${change.id}`, type: 'scope', title: '迭代范围发生变化', detail: change.description, sprintId: change.sprint_id, changeId: change.id }));
      setNotices(nextNotices);
    } catch (error) {
      setForbidden(error instanceof ApiError && error.status === 403);
      showToast(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [projectId, showToast]);

  const addNotice = useCallback((change: ScopeChange, sprintId: number) => {
    setNotices((items) => [{ id: `change-${change.id}`, type: 'scope', title: '迭代范围发生变化', detail: change.description, sprintId, changeId: change.id }, ...items]);
  }, []);

  useEffect(() => { void refreshMeta(); }, [refreshMeta]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  // 原实现在 popstate 里关闭浮层，路由切换后同样收起抽屉与迭代菜单
  useEffect(() => { setDrawer(null); setSprintMenu(false); }, [location.pathname, location.search]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDrawer(null); setSprintMenu(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const contextValue = useMemo<AppContextValue>(() => ({
    projectId,
    project,
    sprints,
    members,
    notices,
    currentSprint,
    currentSprintId,
    isOwner,
    loading,
    onRefresh: refreshMeta,
    onToast: showToast,
    onNotice: addNotice,
    setProject,
    setSprints,
    setNotices,
  }), [projectId, project, sprints, members, notices, currentSprint, currentSprintId, isOwner, loading, refreshMeta, showToast, addNotice]);

  const isActive = (key: NavKey) => {
    const path = location.pathname;
    switch (key) {
      case 'overview': return path === '/' || path === `/projects/${projectId}` || path === `/projects/${projectId}/`;
      case 'sprints': return /\/sprints(\/|$)/.test(path);
      case 'reports': return /\/reports(\/|$)/.test(path);
      case 'backlog': return /\/backlog(\/|$)/.test(path);
      case 'stages': return /\/stages(\/|$)/.test(path);
      case 'my-tasks': return path.startsWith('/my-tasks');
      case 'members': return /\/members(\/|$)/.test(path);
      case 'integrations': return /\/integrations(\/|$)/.test(path);
      case 'settings': return /\/settings(\/|$)/.test(path);
      case 'project-new': return path === '/projects/new';
      default: return false;
    }
  };

  const go = (path: string) => (event: React.MouseEvent) => { event.preventDefault(); navigate(path); };
  const navItem = (key: NavKey, label: string, icon: React.ReactNode, path: string) => (
    <a key={key} className={`nav-item ${isActive(key) ? 'active' : ''}`} href={path} onClick={go(path)}>
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
    </a>
  );

  if (forbidden) {
    return <ConfigProvider theme={{ token: themeToken }}><AntdApp><PermissionDenied onHome={() => navigate('/')} /></AntdApp></ConfigProvider>;
  }

  return (
    <ConfigProvider theme={{ token: themeToken }}>
      <AntdApp>
        <AppContext.Provider value={contextValue}>
          <div className="app-shell">
            <aside className="sidebar">
              <div className="brand">
                <div className="brand-mark"><ThunderboltOutlined style={{ fontSize: 16 }} /></div>
                <span>vibe<span className="brand-accent">pm</span></span>
              </div>
              <div className="workspace-switch">
                <div className="workspace-icon">V</div>
                <div><b>{project?.name || 'Vibe PM'}</b><small>项目工作区</small></div>
                <DownOutlined style={{ fontSize: 13 }} />
              </div>
              <nav>
                {navItem('overview', '总览', <DashboardOutlined style={navIconStyle} />, `/projects/${projectId}`)}
                {navItem('sprints', '迭代看板', <ProjectOutlined style={navIconStyle} />, currentSprint ? sprintPath(currentSprint.id) : `/projects/${projectId}/sprints`)}
                {navItem('reports', '报告', <BarChartOutlined style={navIconStyle} />, `/projects/${projectId}/reports`)}
                {navItem('backlog', 'Backlog', <InboxOutlined style={navIconStyle} />, `/projects/${projectId}/backlog`)}
                {navItem('stages', '阶段', <FlagOutlined style={navIconStyle} />, `/projects/${projectId}/stages`)}
                {navItem('my-tasks', '我的任务', <UnorderedListOutlined style={navIconStyle} />, '/my-tasks')}
              </nav>
              <div className="nav-label">工作区</div>
              <nav>
                {navItem('members', '成员', <TeamOutlined style={navIconStyle} />, `/projects/${projectId}/members`)}
                {navItem('integrations', '集成', <BranchesOutlined style={navIconStyle} />, `/projects/${projectId}/integrations`)}
                {navItem('project-new', '新建项目', <PlusOutlined style={navIconStyle} />, '/projects/new')}
              </nav>
              <div className="sidebar-bottom">
                {navItem('settings', '设置', <SettingOutlined style={navIconStyle} />, `/projects/${projectId}/settings`)}
                <UserDropdown isOwner={isOwner} />
              </div>
            </aside>
            <main className="main">
              <header className="topbar">
                <div className="breadcrumbs">
                  <a href={`/projects/${projectId}`} onClick={go(`/projects/${projectId}`)}>{project?.name || 'Vibe PM'}</a>
                  <span>/</span>
                  <div className="sprint-picker">
                    <button className="breadcrumb-button" onClick={() => setSprintMenu(!sprintMenu)}>
                      {currentSprint?.name || '选择迭代'} <DownOutlined style={{ fontSize: 11 }} />
                    </button>
                    {sprintMenu && (
                      <SprintMenu
                        sprints={sprints}
                        selectedId={currentSprint?.id}
                        onSelect={(id) => { setSprintMenu(false); navigate(sprintPath(id)); }}
                      />
                    )}
                  </div>
                  {currentSprint && <span className={`status-pill ${statusTone[currentSprint.status]}`}><i /> {statusLabel[currentSprint.status]}</span>}
                </div>
                <div className="top-actions">
                  <button className="icon-btn notification-button" title="通知" onClick={() => setDrawer(drawer === 'notifications' ? null : 'notifications')}>
                    <BellOutlined style={{ fontSize: 18 }} />
                    {unread > 0 && <em>{unread}</em>}
                  </button>
                  <button className="avatar avatar-blue avatar-button" title="打开用户菜单" onClick={() => setDrawer(drawer === 'user' ? null : 'user')}>XM</button>
                </div>
              </header>
              <div className="content">{loading && !project ? <LoadingState /> : <Outlet />}</div>
            </main>
            <NotificationDrawer
              open={drawer === 'notifications'}
              notices={notices}
              setNotices={setNotices}
              close={() => setDrawer(null)}
              onOpenSprint={(sprintId) => navigate(sprintPath(sprintId))}
            />
            {drawer === 'user' && <UserMenu isOwner={isOwner} close={() => setDrawer(null)} />}
          </div>
          {toast && <div className="toast" role="status"><CheckOutlined /> {toast}</div>}
        </AppContext.Provider>
      </AntdApp>
    </ConfigProvider>
  );
}

function LoadingState() {
  return <div className="state-panel"><ReloadOutlined className="spin" style={{ fontSize: 20 }} /><b>正在加载项目数据…</b></div>;
}

function SprintMenu({ sprints, selectedId, onSelect }: { sprints: Sprint[]; selectedId?: number; onSelect: (id: number) => void }) {
  return (
    <div className="sprint-menu" role="menu">
      {(['active', 'planning', 'completed'] as SprintStatus[]).map((status) => (
        <div key={status}>
          <span className="menu-group">{statusLabel[status]}</span>
          {sprints.filter((item) => item.status === status).map((sprint) => (
            <button key={sprint.id} className="sprint-option" onClick={() => onSelect(sprint.id)}>
              <span><b>{sprint.name}</b><small>{formatRange(sprint)}</small></span>
              {sprint.id === selectedId && <CheckOutlined style={{ fontSize: 13 }} />}
            </button>
          ))}
        </div>
      ))}
      {!sprints.length && (
        <div className="empty-state">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><b>暂无迭代</b><p>请先创建一个迭代</p></>} />
        </div>
      )}
    </div>
  );
}

function NotificationDrawer({ open, notices, setNotices, close, onOpenSprint }: {
  open: boolean;
  notices: Notice[];
  setNotices: React.Dispatch<React.SetStateAction<Notice[]>>;
  close: () => void;
  onOpenSprint: (sprintId: number) => void;
}) {
  return (
    <Drawer title="通知" open={open} onClose={close} placement="right" width={360} destroyOnClose>
      {notices.length ? (
        <div className="notice-list">
          {notices.map((notice) => (
            <button
              className={`notice-row ${notice.read ? 'read' : ''}`}
              key={notice.id}
              onClick={() => {
                setNotices((items) => items.map((item) => (item.id === notice.id ? { ...item, read: true } : item)));
                onOpenSprint(notice.sprintId);
                close();
              }}
            >
              <span className={`notice-dot ${notice.type}`} />
              <span><b>{notice.title}</b><small>{notice.detail}</small></span>
              {!notice.read && <i />}
            </button>
          ))}
        </div>
      ) : (
        <Empty description="范围变更和迭代状态更新会显示在这里" />
      )}
    </Drawer>
  );
}

function UserDropdown({ isOwner }: { isOwner: boolean }) {
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          { key: 'identity', label: <span>开发模式身份：{getUserId()}</span>, disabled: true },
          { key: 'role', label: `当前角色：${isOwner ? 'Owner' : 'Member'}`, disabled: true },
          { type: 'divider' },
          { key: 'settings', label: '账户设置（尚未开放）', disabled: true },
          { key: 'logout', label: '退出登录（开发模式不可用）', disabled: true },
        ],
      }}
    >
      <button className="user user-trigger">
        <div className="avatar avatar-purple">XM</div>
        <div><b>小明</b><small>{isOwner ? '项目 Owner' : '项目成员'}</small></div>
        <EllipsisOutlined style={{ fontSize: 16 }} />
      </button>
    </Dropdown>
  );
}

function UserMenu({ isOwner, close }: { isOwner: boolean; close: () => void }) {
  return (
    <div className="popover user-menu">
      <div className="user-menu-profile">
        <div className="avatar avatar-purple">XM</div>
        <div><b>小明</b><span>xiaoming@example.com</span></div>
      </div>
      <div className="identity-note">
        <SafetyCertificateOutlined style={{ fontSize: 15 }} /> 开发模式身份：<code>{getUserId()}</code>
        <small>请求通过 X-User-Id 识别用户</small>
      </div>
      <div className="menu-role"><span>当前角色</span><b>{isOwner ? 'Owner' : 'Member'}</b></div>
      <button className="disabled-menu-item" disabled title="账户设置尚未开放"><SettingOutlined style={{ fontSize: 15 }} /> 账户设置 <small>尚未开放</small></button>
      <button className="disabled-menu-item" disabled title="退出登录尚未接入"><LogoutOutlined style={{ fontSize: 15 }} /> 退出登录 <small>开发模式不可用</small></button>
      <button className="menu-close" onClick={close}>关闭菜单 <CloseOutlined style={{ fontSize: 12 }} /></button>
    </div>
  );
}

function PermissionDenied({ onHome }: { onHome: () => void }) {
  return (
    <div className="not-found">
      <div className="brand">
        <div className="brand-mark"><ThunderboltOutlined style={{ fontSize: 16 }} /></div>
        vibe<span className="brand-accent">pm</span>
      </div>
      <div className="not-found-card">
        <SafetyCertificateOutlined style={{ fontSize: 34, color: '#7056df' }} />
        <h1>无权限访问</h1>
        <p>你不是该项目成员，请联系项目 Owner。</p>
        <button className="primary-btn" onClick={onHome}><DashboardOutlined style={{ fontSize: 15 }} /> 返回首页</button>
      </div>
    </div>
  );
}
