import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Drawer as AntDrawer, Dropdown, Empty } from 'antd';
import {
  Activity,
  Archive,
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Milestone,
  MoreHorizontal,
  Plus,
  Settings2,
  Shield,
  Users,
  Zap,
} from 'lucide-react';
import { getUserId } from '../api';
import type { Project } from '../types';

type Notice = {
  id: string;
  type: 'scope' | 'start' | 'end';
  title: string;
  detail: string;
  sprintId: number;
  changeId?: number;
  read?: boolean;
};

function pageTitleFromPath(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  // /projects/:id/...
  if (parts[0] === 'projects') {
    if (parts[1] === 'new') return '新建项目';
    const section = parts[2] || '';
    switch (section) {
      case 'stages':
        return parts[3] ? '阶段工作台' : '阶段';
      case 'activity':
        return '项目活动';
      case 'members':
        return '成员';
      case 'settings':
        return '设置';
      case 'copilot':
        return 'AI 副驾驶';
      case 'sprints':
        return '迭代看板';
      case 'backlog':
        return 'Backlog';
      case 'reports':
        return '迭代报告';
      default:
        return '项目总览';
    }
  }
  if (parts[0] === 'my-tasks') return '我的任务';
  return '';
}

/**
 * 全局应用壳：侧栏导航 + 顶栏 + 内容区。
 * 项目路由与全局路由共用；project 为空时仅显示全局导航。
 */
export function AppShell({
  project,
  notices,
  isOwner,
  onNoticeRead,
  children,
}: {
  project: Project | null;
  notices: Notice[];
  isOwner: boolean;
  onNoticeRead?: (id: string) => void;
  children?: ReactNode;
}) {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState<'notifications' | 'user' | null>(null);
  const [compatOpen, setCompatOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const base = projectId ? `/projects/${projectId}` : '';
  const nav = (path: string, label: string, icon: ReactNode, end = false) => (
    <NavLink
      to={path}
      end={end}
      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
    >
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
  const unread = notices.filter((item) => !item.read).length;
  const compatActive = ['sprints', 'backlog', 'reports'].some((section) =>
    location.pathname.startsWith(`${base}/${section}`),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Zap size={16} fill="currentColor" />
          </div>
          <span>
            vibe<span className="brand-accent">pm</span>
          </span>
        </div>
        <div className="workspace-switch">
          <div className="workspace-icon">V</div>
          <div>
            <b>{project?.name || 'Vibe PM'}</b>
            <small>{project ? '项目工作区' : '全局工作区'}</small>
          </div>
          <ChevronDown size={15} />
        </div>
        {project && base ? (
          <nav>
            {nav(base, '总览', <LayoutDashboard size={17} />, true)}
            {nav(`${base}/stages`, '阶段', <Milestone size={17} />)}
            {nav(`${base}/members`, '成员', <Users size={17} />)}
            {nav(`${base}/settings`, '设置', <Settings2 size={17} />)}
          </nav>
        ) : null}
        <div className="nav-label">全局</div>
        <nav>
          {nav('/my-tasks', '我的任务', <ListTodo size={17} />)}
          {nav('/projects/new', '新建项目', <Plus size={17} />)}
        </nav>
        {project && base ? (
          <button
            className={`nav-group-label ${compatOpen ? 'expanded' : ''}`}
            onClick={() => setCompatOpen((value) => !value)}
          >
            <ChevronRight size={13} /> 兼容视图
            {compatActive ? <em style={{ fontSize: 10 }}>•</em> : null}
          </button>
        ) : null}
        {project && base && compatOpen ? (
          <div className="nav-group-items">
            {nav(`${base}/sprints`, '迭代看板', <Activity size={16} />)}
            {nav(`${base}/backlog`, 'Backlog', <Archive size={16} />)}
            {nav(`${base}/reports`, '报告', <BarChart3 size={16} />)}
          </div>
        ) : null}
        <div className="sidebar-bottom">
          <AntUserMenu isOwner={isOwner} />
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <a href={base || '/my-tasks'}>{project?.name || 'Vibe PM'}</a>
            <span>/</span>
            <b>{pageTitleFromPath(location.pathname)}</b>
          </div>
          <div className="top-actions">
            <button
              className="icon-btn notification-button"
              title="通知"
              onClick={() => setDrawer(drawer === 'notifications' ? null : 'notifications')}
            >
              <Bell size={18} />
              {unread > 0 && <em>{unread}</em>}
            </button>
            <button
              className="avatar avatar-blue avatar-button"
              title="打开用户菜单"
              onClick={() => setDrawer(drawer === 'user' ? null : 'user')}
            >
              XM
            </button>
          </div>
        </header>
        <div className="content">{children ?? <Outlet />}</div>
      </main>
      {drawer === 'notifications' && (
        <NotificationDrawer
          notices={notices}
          projectId={Number(projectId)}
          onRead={(id) => onNoticeRead?.(id)}
          close={() => setDrawer(null)}
        />
      )}
      {drawer === 'user' && <UserMenu isOwner={isOwner} close={() => setDrawer(null)} />}
    </div>
  );
}

function NotificationDrawer({
  notices,
  projectId,
  onRead,
  close,
}: {
  notices: Notice[];
  projectId: number;
  onRead: (id: string) => void;
  close: () => void;
}) {
  const navigate = useNavigate();
  return (
    <AntDrawer title="通知" open onClose={close} placement="right" width={360} destroyOnHidden>
      {notices.length ? (
        <div className="notice-list">
          {notices.map((notice) => (
            <button
              className={`notice-row ${notice.read ? 'read' : ''}`}
              key={notice.id}
              onClick={() => {
                onRead(notice.id);
                navigate(`/projects/${projectId}/sprints/${notice.sprintId}`);
                close();
              }}
            >
              <span className={`notice-dot ${notice.type}`} />
              <span>
                <b>{notice.title}</b>
                <small>{notice.detail}</small>
              </span>
              {!notice.read && <i />}
            </button>
          ))}
        </div>
      ) : (
        <Empty description="范围变更和迭代状态更新会显示在这里" />
      )}
    </AntDrawer>
  );
}

function AntUserMenu({ isOwner }: { isOwner: boolean }) {
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          {
            key: 'identity',
            label: <span>开发模式身份：{getUserId()}</span>,
            disabled: true,
          },
          {
            key: 'role',
            label: `当前角色：${isOwner ? 'Owner' : 'Member'}`,
            disabled: true,
          },
          { type: 'divider' },
          { key: 'settings', label: '账户设置（尚未开放）', disabled: true },
          { key: 'logout', label: '退出登录（开发模式不可用）', disabled: true },
        ],
      }}
    >
      <button className="user user-trigger">
        <div className="avatar avatar-purple">XM</div>
        <div>
          <b>小明</b>
          <small>{isOwner ? '项目 Owner' : '项目成员'}</small>
        </div>
        <MoreHorizontal size={16} />
      </button>
    </Dropdown>
  );
}

function UserMenu({ isOwner, close }: { isOwner: boolean; close: () => void }) {
  return (
    <div className="popover user-menu">
      <div className="user-menu-profile">
        <div className="avatar avatar-purple">XM</div>
        <div>
          <b>小明</b>
          <span>xiaoming@example.com</span>
        </div>
      </div>
      <div className="identity-note">
        <Shield size={15} /> 开发模式身份：<code>{getUserId()}</code>
        <small>请求通过 X-User-Id 识别用户</small>
      </div>
      <div className="menu-role">
        <span>当前角色</span>
        <b>{isOwner ? 'Owner' : 'Member'}</b>
      </div>
      <button className="disabled-menu-item" disabled title="账户设置尚未开放">
        <Settings2 size={15} /> 账户设置 <small>尚未开放</small>
      </button>
      <button className="disabled-menu-item" disabled title="退出登录尚未接入">
        <LogOut size={15} /> 退出登录 <small>开发模式不可用</small>
      </button>
      <button className="menu-close" onClick={close}>
        关闭菜单
      </button>
    </div>
  );
}
