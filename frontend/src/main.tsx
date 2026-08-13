import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Button as AntButton, ConfigProvider, Drawer as AntDrawer, Dropdown, Empty, Modal as AntModal, Statistic } from 'antd';
import {
  Activity, Archive, ArrowDown, ArrowUp, BarChart3, Bell, CalendarDays, Check, ChevronDown, CircleHelp,
  Flag, GitBranch, LayoutDashboard, ListTodo, LogOut, Milestone, MoreHorizontal, Pencil, Play, Plus, RefreshCw, ArrowRight, Search, Settings2,
  Shield, Trash2, Users, X, Zap,
} from 'lucide-react';
import Board from './components/Board';
import BurnupChart from './components/BurnupChart';
import ScopeTimeline from './components/ScopeTimeline';
import { apiClient, ApiError, getUserId } from './api';
import { useSprintWorkspace } from './hooks';
import type { MyTask, ProjectMember, ScopeChange, Sprint, SprintStatus, Stage, StageBlocker, StageDeletePreview, StageStatus, StageTask, StageTaskPriority, StageTaskStatus, StageTemplateItem, Task, TaskBlocker, TaskCreateInput, TaskDependency, TaskStatus } from './types';
import './styles.css';
import './backlog.css';
import './app-shell.css';
import './stages.css';

const projectId = 1;
const statusLabel: Record<SprintStatus, string> = { planning: '规划中', active: '进行中', completed: '已完成' };
const statusTone: Record<SprintStatus, string> = { planning: 'planning', active: 'active', completed: 'completed' };
const stageStatusLabel: Record<StageStatus, string> = { planned: '未开始', active: '进行中', blocked: '受阻', completed: '已完成' };
const stageStatusTone: Record<StageStatus, string> = { planned: 'planning', active: 'active', blocked: 'blocked', completed: 'completed' };
const taskStatusWeight: Record<TaskStatus, number> = { todo: 0, in_progress: .5, in_review: .8, done: 1 };
const stageTaskStatusLabel: Record<StageTaskStatus, string> = { todo: '未开始', in_progress: '进行中', blocked: '受阻', pending_verification: '待验收', done: '已完成' };
const stageTaskPriorityLabel: Record<StageTaskPriority, string> = { urgent: '紧急', important: '重要', normal: '正常', low: '低' };
const stageTaskTransitions: Record<StageTaskStatus, StageTaskStatus[]> = { todo: ['in_progress'], in_progress: ['done', 'blocked'], blocked: ['pending_verification'], pending_verification: ['done'], done: [] };

type Route = { page: 'overview' | 'sprint' | 'sprints' | 'backlog' | 'reports' | 'members' | 'integrations' | 'settings' | 'stages' | 'stage-workbench' | 'project-new' | 'my-tasks' | 'not-found'; sprintId: number | null; projectId: number; stageId: number | null };
type Notice = { id: string; type: 'scope' | 'start' | 'end'; title: string; detail: string; sprintId: number; changeId?: number; read?: boolean };

function readRoute(): Route {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const sprintId = Number(new URLSearchParams(window.location.search).get('sprint_id')) || null;
  const base = { sprintId, projectId, stageId: null as number | null };
  if (!parts.length) return { page: 'overview', ...base };
  if (parts[0] === 'my-tasks') return { page: 'my-tasks', ...base };
  if (parts[0] !== 'projects') return { page: 'not-found', ...base };
  if (parts[1] === 'new') return { page: 'project-new', ...base };
  const routeProjectId = Number(parts[1]) || projectId;
  if (parts[2] === 'stages') {
    const stageId = Number(parts[3]) || null;
    return { page: stageId ? 'stage-workbench' : 'stages', sprintId, projectId: routeProjectId, stageId };
  }
  if (parts[1] !== String(projectId)) return { page: 'not-found', ...base };
  const section = parts[2];
  if (!section) return { page: 'overview', ...base };
  const map: Record<string, Route['page']> = { sprints: parts[3] ? 'sprint' : 'sprints', backlog: 'backlog', reports: 'reports', members: 'members', integrations: 'integrations', settings: 'settings' };
  return { page: map[section] ?? 'not-found', sprintId: Number(parts[3]) || sprintId, projectId, stageId: null };
}

function navigate(path: string) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }
function sprintPath(id: number) { return `/projects/${projectId}/sprints/${id}`; }
function formatDate(value?: string | null) { return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(`${value.slice(0, 10)}T00:00:00`)) : '-'; }
function formatRange(sprint?: Sprint | null) { return sprint ? `${formatDate(sprint.start_date)} - ${formatDate(sprint.end_date)}` : '暂无日期'; }
function errorText(error: unknown) { return error instanceof ApiError && error.status === 403 ? '你没有访问该项目的权限' : error instanceof Error ? error.message : '请求失败，请稍后重试'; }

function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [project, setProject] = useState<{ id: number; name: string; description: string | null } | null>(null);
  const [members, setMembers] = useState<Array<{ id: string; name: string; email: string; role: string }>>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'notifications' | 'user' | null>(null);
  const [sprintMenu, setSprintMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const currentSprintId = route.sprintId || sprints.find((item) => item.status === 'active')?.id || null;
  const currentSprint = sprints.find((item) => item.id === currentSprintId) || null;
  const isOwner = members.find((member) => member.id === getUserId())?.role === 'owner' || getUserId() === 'demo-user';

  const showToast = (message: string) => { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 2800); };
  const refreshMeta = async () => {
    setLoading(true);
    try {
      const [nextSprints, detail] = await Promise.all([apiClient.listSprints(), apiClient.getProject(projectId)]);
      setForbidden(false);
      setSprints(nextSprints); setProject(detail.project); setMembers(detail.members);
      const recentChanges = (await Promise.all(nextSprints.map((sprint) => apiClient.listScopeChanges(sprint.id).catch(() => [])))).flat().slice(0, 10);
      const nextNotices = nextSprints.reduce<Notice[]>((items, sprint) => { if (sprint.status === 'active') items.push({ id: `start-${sprint.id}`, type: 'start', title: `${sprint.name} 正在进行`, detail: '迭代已开始，继续关注范围变化。', sprintId: sprint.id }); if (sprint.status === 'completed') items.push({ id: `end-${sprint.id}`, type: 'end', title: `${sprint.name} 已结束`, detail: '迭代报告已准备好查看。', sprintId: sprint.id }); return items; }, []);
      recentChanges.forEach((change) => nextNotices.push({ id: `change-${change.id}`, type: 'scope', title: '迭代范围发生变化', detail: change.description, sprintId: change.sprint_id, changeId: change.id }));
      setNotices(nextNotices);
    } catch (error) { setForbidden(error instanceof ApiError && error.status === 403); showToast(errorText(error)); } finally { setLoading(false); }
  };
  useEffect(() => { void refreshMeta(); const onPop = () => { setRoute(readRoute()); setDrawer(null); setSprintMenu(false); }; window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDrawer(null); setSprintMenu(false); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);

  const onSprintSelect = (id: number) => { setSprintMenu(false); navigate(sprintPath(id)); };
  const openWorkspace = () => currentSprintId ? navigate(sprintPath(currentSprintId)) : navigate(`/projects/${projectId}/sprints`);
  const addNotice = (change: ScopeChange, sprintId: number) => setNotices((items) => [{ id: `change-${change.id}`, type: 'scope', title: '迭代范围发生变化', detail: change.description, sprintId, changeId: change.id }, ...items]);

  if (route.page === 'not-found') return <NotFound />;
  if (forbidden) return <PermissionDenied />;
  return <ConfigProvider theme={{ token: { colorPrimary: '#7056df', borderRadius: 7, colorBgLayout: '#f7f8fa', fontFamily: "'DM Sans', sans-serif" } }}><AppShell project={project} route={route} currentSprint={currentSprint} sprints={sprints} sprintMenu={sprintMenu} setSprintMenu={setSprintMenu} onSprintSelect={onSprintSelect} drawer={drawer} setDrawer={setDrawer} notices={notices} setNotices={setNotices} isOwner={isOwner} onWorkspace={openWorkspace}>
    {loading && !project ? <LoadingState /> : <PageContent route={route} currentSprint={currentSprint} currentSprintId={currentSprintId} sprints={sprints} members={members} isOwner={isOwner} project={project} onRefresh={refreshMeta} onToast={showToast} onNotice={addNotice} setSprints={setSprints} setProject={setProject} />}
    {toast && <div className="toast" role="status"><Check size={15} /> {toast}</div>}
  </AppShell></ConfigProvider>;
}

function AppShell(props: { children: React.ReactNode; project: { name: string } | null; route: Route; currentSprint: Sprint | null; sprints: Sprint[]; sprintMenu: boolean; setSprintMenu: (value: boolean) => void; onSprintSelect: (id: number) => void; drawer: 'notifications' | 'user' | null; setDrawer: (value: 'notifications' | 'user' | null) => void; notices: Notice[]; setNotices: React.Dispatch<React.SetStateAction<Notice[]>>; isOwner: boolean; onWorkspace: () => void }) {
  const { route, currentSprint } = props;
  const nav = (page: Route['page'], path: string, label?: string, icon?: React.ReactNode) => <a className={`nav-item ${route.page === page || (page === 'sprint' && route.page === 'sprints') || (page === 'stages' && route.page === 'stage-workbench') ? 'active' : ''}`} href={path}><span className="nav-icon">{icon ?? (page === 'overview' ? <LayoutDashboard size={17} /> : page === 'sprint' || page === 'sprints' ? <Activity size={17} /> : page === 'reports' ? <BarChart3 size={17} /> : page === 'backlog' ? <Archive size={17} /> : page === 'members' ? <Users size={17} /> : page === 'integrations' ? <GitBranch size={17} /> : page === 'stages' ? <Milestone size={17} /> : <Settings2 size={17} />)}</span><span>{label ?? (page === 'backlog' ? 'Backlog' : page === 'sprint' || page === 'sprints' ? '迭代看板' : page === 'stages' ? '阶段' : page === 'overview' ? '总览' : page === 'reports' ? '报告' : page === 'members' ? '成员' : page === 'integrations' ? '集成' : '设置')}</span></a>;
  const unread = props.notices.filter((item) => !item.read).length;
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark"><Zap size={16} fill="currentColor" /></div><span>vibe<span className="brand-accent">pm</span></span></div><div className="workspace-switch"><div className="workspace-icon">V</div><div><b>{props.project?.name || 'Vibe PM'}</b><small>项目工作区</small></div><ChevronDown size={15} /></div><nav>{nav('overview', `/projects/${projectId}`)}{nav('sprint', currentSprint ? sprintPath(currentSprint.id) : `/projects/${projectId}/sprints`)}{nav('reports', `/projects/${projectId}/reports/${currentSprint?.id || ''}`)}{nav('backlog', `/projects/${projectId}/backlog`)}{nav('stages', `/projects/${projectId}/stages`)}{nav('my-tasks', '/my-tasks', '我的任务', <ListTodo size={17} />)}</nav><div className="nav-label">工作区</div><nav>{nav('members', `/projects/${projectId}/members`)}{nav('integrations', `/projects/${projectId}/integrations`)}{nav('project-new', '/projects/new', '新建项目', <Plus size={17} />)}</nav><div className="sidebar-bottom">{nav('settings', `/projects/${projectId}/settings`)}<AntUserMenu isOwner={props.isOwner} /></div></aside><main className="main"><header className="topbar"><div className="breadcrumbs"><a href={`/projects/${projectId}`}>{props.project?.name || 'Vibe PM'}</a><span>/</span><div className="sprint-picker"><button className="breadcrumb-button" onClick={() => props.setSprintMenu(!props.sprintMenu)}>{currentSprint?.name || '选择迭代'} <ChevronDown size={13} /></button>{props.sprintMenu && <SprintMenu sprints={props.sprints} selectedId={currentSprint?.id} onSelect={props.onSprintSelect} />}</div>{currentSprint && <span className={`status-pill ${statusTone[currentSprint.status]}`}><i /> {statusLabel[currentSprint.status]}</span>}</div><div className="top-actions"><button className="icon-btn notification-button" title="通知" onClick={() => props.setDrawer(props.drawer === 'notifications' ? null : 'notifications')}><Bell size={18} />{unread > 0 && <em>{unread}</em>}</button><button className="avatar avatar-blue avatar-button" title="打开用户菜单" onClick={() => props.setDrawer(props.drawer === 'user' ? null : 'user')}>XM</button></div></header><div className="content">{props.children}</div></main>{props.drawer === 'notifications' && <AntNotificationDrawer notices={props.notices} setNotices={props.setNotices} close={() => props.setDrawer(null)} />}{props.drawer === 'user' && <UserMenu isOwner={props.isOwner} close={() => props.setDrawer(null)} />}</div>;
}

function AntNotificationDrawer({ notices, setNotices, close }: { notices: Notice[]; setNotices: React.Dispatch<React.SetStateAction<Notice[]>>; close: () => void }) { return <AntDrawer title="通知" open onClose={close} placement="right" width={360} destroyOnHidden>{notices.length ? <div className="notice-list">{notices.map((notice) => <button className={`notice-row ${notice.read ? 'read' : ''}`} key={notice.id} onClick={() => { setNotices((items) => items.map((item) => item.id === notice.id ? { ...item, read: true } : item)); navigate(sprintPath(notice.sprintId)); close(); }}><span className={`notice-dot ${notice.type}`} /><span><b>{notice.title}</b><small>{notice.detail}</small></span>{!notice.read && <i />}</button>)}</div> : <Empty description="范围变更和迭代状态更新会显示在这里" />}</AntDrawer>; }
function AntUserMenu({ isOwner }: { isOwner: boolean }) { return <Dropdown trigger={['click']} menu={{ items: [{ key: 'identity', label: <span>开发模式身份：{getUserId()}</span>, disabled: true }, { key: 'role', label: `当前角色：${isOwner ? 'Owner' : 'Member'}`, disabled: true }, { type: 'divider' }, { key: 'settings', label: '账户设置（尚未开放）', disabled: true }, { key: 'logout', label: '退出登录（开发模式不可用）', disabled: true }] }}><button className="user user-trigger"><div className="avatar avatar-purple">XM</div><div><b>小明</b><small>{isOwner ? '项目 Owner' : '项目成员'}</small></div><MoreHorizontal size={16} /></button></Dropdown>; }

function SprintMenu({ sprints, selectedId, onSelect }: { sprints: Sprint[]; selectedId?: number; onSelect: (id: number) => void }) { return <div className="sprint-menu" role="menu">{(['active', 'planning', 'completed'] as SprintStatus[]).map((status) => <div key={status}><span className="menu-group">{statusLabel[status]}</span>{sprints.filter((item) => item.status === status).map((sprint) => <button key={sprint.id} className="sprint-option" onClick={() => onSelect(sprint.id)}><span><b>{sprint.name}</b><small>{formatRange(sprint)}</small></span>{sprint.id === selectedId && <Check size={15} />}</button>)}</div>)}{!sprints.length && <EmptyState title="暂无迭代" copy="请先创建一个迭代" />}</div>; }
function NotificationDrawer({ notices, setNotices, close }: { notices: Notice[]; setNotices: React.Dispatch<React.SetStateAction<Notice[]>>; close: () => void }) { return <div className="drawer-overlay" onClick={close}><aside className="drawer notification-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">ACTIVITY</span><h2>通知</h2></div><button className="icon-btn" title="关闭通知" onClick={close}><X size={18} /></button></div>{notices.length ? <div className="notice-list">{notices.map((notice) => <button className={`notice-row ${notice.read ? 'read' : ''}`} key={notice.id} onClick={() => { setNotices((items) => items.map((item) => item.id === notice.id ? { ...item, read: true } : item)); navigate(sprintPath(notice.sprintId)); close(); }}><span className={`notice-dot ${notice.type}`} /><span><b>{notice.title}</b><small>{notice.detail}</small></span>{!notice.read && <i />}</button>)}</div> : <EmptyState title="暂无通知" copy="范围变更和迭代状态更新会显示在这里" />}</aside></div>; }
function UserMenu({ isOwner, close }: { isOwner: boolean; close: () => void }) { return <div className="popover user-menu"><div className="user-menu-profile"><div className="avatar avatar-purple">XM</div><div><b>小明</b><span>xiaoming@example.com</span></div></div><div className="identity-note"><Shield size={15} /> 开发模式身份：<code>{getUserId()}</code><small>请求通过 X-User-Id 识别用户</small></div><div className="menu-role"><span>当前角色</span><b>{isOwner ? 'Owner' : 'Member'}</b></div><button className="disabled-menu-item" disabled title="账户设置尚未开放"><Settings2 size={15} /> 账户设置 <small>尚未开放</small></button><button className="disabled-menu-item" disabled title="退出登录尚未接入"><LogOut size={15} /> 退出登录 <small>开发模式不可用</small></button><button className="menu-close" onClick={close}>关闭菜单</button></div>; }

function PageContent({ route, currentSprint, currentSprintId, sprints, members, isOwner, project, onRefresh, onToast, onNotice, setSprints, setProject }: { route: Route; currentSprint: Sprint | null; currentSprintId: number | null; sprints: Sprint[]; members: Array<{ id: string; name: string; email: string; role: string }>; isOwner: boolean; project: { id: number; name: string; description: string | null } | null; onRefresh: () => Promise<void>; onToast: (message: string) => void; onNotice: (change: ScopeChange, sprintId: number) => void; setSprints: React.Dispatch<React.SetStateAction<Sprint[]>>; setProject: React.Dispatch<React.SetStateAction<{ id: number; name: string; description: string | null } | null>> }) {
  if (route.page === 'project-new') return <ProjectCreatePage onToast={onToast} />;
  if (route.page === 'stages') return <StageListPage routeProjectId={route.projectId} onToast={onToast} />;
  if (route.page === 'stage-workbench') return <StageWorkbenchPage routeProjectId={route.projectId} stageId={route.stageId} onToast={onToast} />;
  if (route.page === 'my-tasks') return <MyTasksPage />;
  if (route.page === 'overview') return <OverviewPage sprint={currentSprint} sprints={sprints} onRefresh={onRefresh} onToast={onToast} />;
  if (route.page === 'sprints') return <SprintListPage sprints={sprints} onCreate={(sprint) => { setSprints((items) => [sprint, ...items]); navigate(sprintPath(sprint.id)); }} onToast={onToast} />;
  if (route.page === 'backlog') return <BacklogPage currentSprint={currentSprint} sprints={sprints} onRefresh={onRefresh} onToast={onToast} />;
  if (route.page === 'reports') return <ReportPage sprint={currentSprint} sprints={sprints} onSelect={(id) => navigate(`/projects/${projectId}/reports/${id}`)} onToast={onToast} />;
  if (route.page === 'members') return <MembersPage members={members} isOwner={isOwner} onRefresh={onRefresh} onToast={onToast} />;
  if (route.page === 'integrations') return <IntegrationsPage />;
  if (route.page === 'settings') return <SettingsPage project={project} isOwner={isOwner} onSaved={(value) => { setProject(value); onToast('项目设置已保存'); }} onToast={onToast} />;
  return <WorkspacePage sprintId={currentSprintId} sprint={currentSprint} onRefresh={onRefresh} onToast={onToast} onNotice={onNotice} />;
}

function PageHeader({ eyebrow, title, copy, actions }: { eyebrow?: string; title: string; copy?: string; actions?: React.ReactNode }) { return <div className="page-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{copy && <p>{copy}</p>}</div>{actions && <div className="head-actions">{actions}</div>}</div>; }
function LoadingState() { return <div className="state-panel"><RefreshCw className="spin" size={20} /><b>正在加载项目数据…</b></div>; }
function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) { return <div className="empty-state"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><b>{title}</b><p>{copy}</p></>} />{action}</div>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <Alert className="page-alert" type="error" showIcon title={message} action={<AntButton size="small" onClick={retry} icon={<RefreshCw size={14} />}>重试</AntButton>} />; }
function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) { return <div className="metric"><div className={`metric-icon ${tone}`}><Activity size={16} /></div><Statistic title={label} value={value} styles={{ content: { fontSize: 19, fontWeight: 600, color: '#1d2433' } }} suffix={<small>{note}</small>} /></div>; }

function OverviewPage({ sprint, sprints, onRefresh, onToast }: { sprint: Sprint | null; sprints: Sprint[]; onRefresh: () => Promise<void>; onToast: (message: string) => void }) { const resource = useSprintWorkspace(sprint?.id || null); const [backlog, setBacklog] = useState<Task[]>([]); useEffect(() => { void apiClient.listBacklog(projectId).then(setBacklog).catch(() => undefined); }, [sprint?.id]); const recent = resource.scopeChanges.slice(0, 5); return <><PageHeader eyebrow="PROJECT OVERVIEW" title="项目总览" copy="快速了解当前迭代、Backlog 和最近的范围变化。" actions={<button className="primary-btn" onClick={() => navigate(`/projects/${projectId}/sprints`)}><Activity size={15} /> 查看迭代</button>} />{resource.error ? <ErrorState message={resource.error} retry={onRefresh} /> : <><section className="metrics"><Metric label="当前迭代" value={sprint?.name || '未开始'} note={sprint ? `${formatRange(sprint)} · ${statusLabel[sprint.status]}` : '先创建或开始一个迭代'} tone="blue" /><Metric label="迭代范围" value={`${resource.snapshots[resource.snapshots.length - 1]?.total_scope ?? sprint?.initial_points ?? 0} pt`} note={`初始 ${sprint?.initial_points || 0} pt`} tone="green" /><Metric label="Backlog" value={`${backlog.length} 个任务`} note="待规划任务" tone="orange" /><Metric label="范围变更" value={`${recent.length} 条`} note="最近活动" tone="purple" /></section><div className="overview-grid"><section className="panel overview-section"><div className="panel-head"><div><h2>当前迭代</h2><p>目标、范围和执行状态</p></div>{sprint && <span className={`status-pill ${statusTone[sprint.status]}`}>{statusLabel[sprint.status]}</span>}</div>{sprint ? <><div className="overview-sprint"><div><span>目标</span><b>{sprint.goal || '暂无迭代目标'}</b></div><div><span>日期</span><b>{formatRange(sprint)}</b></div><div><span>初始范围</span><b>{sprint.initial_points} pt</b></div></div><button className="text-btn" onClick={() => navigate(sprintPath(sprint.id))}>进入工作台 <span>→</span></button></> : <EmptyState title={sprints.length ? '还没有进行中的迭代' : '还没有迭代'} copy={sprints.length ? '请先开始一个已规划的迭代。' : '新建一个迭代后，项目状态会显示在这里。'} action={<button className="primary-btn" onClick={() => navigate(`/projects/${projectId}/sprints`)}><Plus size={15} /> {sprints.length ? '查看迭代' : '新建迭代'}</button>} />}</section><section className="panel overview-section"><div className="panel-head"><div><h2>最近范围变更</h2><p>点击记录查看所属迭代</p></div><button className="text-btn" onClick={() => navigate(`/projects/${projectId}/reports/${sprint?.id || ''}`)}>查看报告</button></div>{recent.length ? <div className="activity-list">{recent.map((change) => <button key={change.id} className="activity-row" onClick={() => navigate(`${sprintPath(change.sprint_id)}?change_id=${change.id}`)}><span className={`notice-dot ${change.points_delta >= 0 ? 'scope' : 'end'}`} /><span><b>{change.description}</b><small>{formatDate(change.created_at)} · {change.reason || '未填写原因'}</small></span><strong className={change.points_delta >= 0 ? 'positive' : 'negative'}>{change.points_delta > 0 ? '+' : ''}{change.points_delta} pt</strong></button>)}</div> : <EmptyState title="暂无范围变更" copy="迭代中发生的范围调整会记录在这里。" />}</section></div></>}</> }

function SprintListPage({ sprints, onCreate, onToast }: { sprints: Sprint[]; onCreate: (sprint: Sprint) => void; onToast: (message: string) => void }) { const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); try { const sprint = await apiClient.createSprint({ project_id: projectId, name: String(form.get('name')), goal: String(form.get('goal') || ''), start_date: String(form.get('start_date')), end_date: String(form.get('end_date')) }); onCreate(sprint); onToast('迭代已创建'); } catch (error) { onToast(errorText(error)); } finally { setSaving(false); } }; return <><PageHeader eyebrow="ITERATIONS" title="迭代" copy="切换历史迭代，或规划下一次交付。" actions={<button className="primary-btn" onClick={() => setOpen(true)}><Plus size={15} /> 新建迭代</button>} /><div className="sprint-list">{(['active', 'planning', 'completed'] as SprintStatus[]).map((status) => <section key={status}><div className="section-label"><span>{statusLabel[status]}</span><em>{sprints.filter((item) => item.status === status).length}</em></div>{sprints.filter((item) => item.status === status).map((sprint) => <button className="sprint-card" key={sprint.id} onClick={() => navigate(sprintPath(sprint.id))}><span className={`status-dot ${statusTone[status]}`} /><span className="sprint-card-main"><b>{sprint.name}</b><small>{formatRange(sprint)} · {sprint.goal || '暂无目标'}</small></span><span className="sprint-card-meta">{sprint.initial_points} pt<ChevronDown size={16} /></span></button>)}</section>)}</div>{open && <Modal title="新建迭代" close={() => setOpen(false)}><form className="form-stack" onSubmit={submit}><label>迭代名称<input name="name" required placeholder="迭代 15" /></label><label>目标<input name="goal" placeholder="本次迭代要达成什么？" /></label><div className="form-grid"><label>开始日期<input name="start_date" type="date" required /></label><label>结束日期<input name="end_date" type="date" required /></label></div><button className="primary-btn full" disabled={saving}>{saving ? '创建中…' : '创建迭代'}</button></form></Modal>}</> }

function WorkspacePage({ sprintId, sprint, onRefresh, onToast, onNotice }: { sprintId: number | null; sprint: Sprint | null; onRefresh: () => Promise<void>; onToast: (message: string) => void; onNotice: (change: ScopeChange, sprintId: number) => void }) { const workspace = useSprintWorkspace(sprintId); const [selectedChange, setSelectedChange] = useState<ScopeChange | null>(null); const [statusModal, setStatusModal] = useState<SprintStatus | null>(null); const [dateModal, setDateModal] = useState(false); const [changeReason, setChangeReason] = useState(''); const total = sprint?.initial_points || workspace.tasks.reduce((sum, task) => sum + task.story_points, 0); const completed = workspace.tasks.reduce((sum, task) => sum + task.story_points * taskStatusWeight[task.status], 0); const currentScope = workspace.snapshots[workspace.snapshots.length - 1]?.total_scope ?? workspace.tasks.reduce((sum, task) => sum + task.story_points, 0); const displayChanges = workspace.scopeChanges; if (!sprint) return <><PageHeader eyebrow="迭代工作台" title="迭代工作台" copy="当前没有可进入的进行中迭代。" /><EmptyState title="请先新建或开始迭代" copy="从迭代列表新建一个规划中的迭代，再开始本次迭代。" action={<button className="primary-btn" onClick={() => navigate(`/projects/${projectId}/sprints`)}><Activity size={15} /> 打开迭代列表</button>} /></>; const runStatus = async () => { if (!statusModal) return; try { await workspace.updateSprint(statusModal); await workspace.refresh(); await onRefresh(); onToast(statusModal === 'active' ? '迭代已开始' : '迭代已结束'); setStatusModal(null); } catch (error) { onToast(errorText(error)); } }; const createTask = async (input: TaskCreateInput) => { try { const task = await workspace.createTask({ ...input, project_id: projectId, sprint_id: sprintId }); if (sprint.status === 'active') { const change = await workspace.createScopeChange({ type: 'add_task', title: input.title, description: `新增「${input.title}」`, story_points: input.story_points, points_delta: input.story_points, reason: input.reason || '迭代执行中新增' }); onNotice(change, sprint.id); } await workspace.refresh(); onToast('任务已创建'); return task; } catch (error) { onToast(errorText(error)); throw error; } }; const removeTask = async (task: Task) => { const reason = window.prompt('请输入移出迭代的原因'); if (!reason?.trim()) return; try { await apiClient.removeTaskFromSprint(sprint.id, task.id); if (sprint.status === 'active') { const change = await workspace.createScopeChange({ type: 'remove_task', task_id: task.id, description: `移出「${task.title}」`, points_delta: -task.story_points, reason }); onNotice(change, sprint.id); } await workspace.refresh(); onToast('任务已移出迭代'); } catch (error) { onToast(errorText(error)); } }; return <><PageHeader eyebrow={`${sprint.name} · ${statusLabel[sprint.status]}`} title={sprint.goal || '聚焦当前迭代目标'} copy="范围变化可追溯，进度状态可解释。" actions={<><button className="ghost-btn" onClick={() => sprint.status === 'planning' ? setDateModal(true) : onToast(`${statusLabel[sprint.status]}迭代日期只读`)}><CalendarDays size={15} /> {formatRange(sprint)} <ChevronDown size={14} /></button>{sprint.status !== 'completed' && <button className="primary-btn" disabled={workspace.mutationLoading} onClick={() => setStatusModal(sprint.status === 'planning' ? 'active' : 'completed')}>{workspace.mutationLoading ? '处理中…' : sprint.status === 'planning' ? '开始迭代' : '结束迭代'}</button>}</>} />{workspace.error && <div className="alert error-state">{workspace.error}<button className="icon-btn" title="重试" onClick={() => void workspace.refresh()}><RefreshCw size={14} /></button></div>}<section className="metrics"><Metric label="范围" value={`${currentScope} pt`} note={`初始 ${total} pt`} tone="blue" /><Metric label="已完成" value={`${completed.toFixed(1)} pt`} note={`${currentScope ? Math.round(completed / currentScope * 100) : 0}% 的范围`} tone="green" /><Metric label="剩余" value={`${Math.max(0, currentScope - completed).toFixed(1)} pt`} note="按当前状态计算" tone="orange" /><Metric label="范围变更" value={`${displayChanges.length} 次`} note={`${displayChanges.reduce((sum, item) => sum + item.points_delta, 0) >= 0 ? '+' : ''}${displayChanges.reduce((sum, item) => sum + item.points_delta, 0)} pt`} tone="purple" /></section><section className="grid-main"><div className="chart-card panel"><BurnupChart snapshots={workspace.snapshots} scopeChanges={displayChanges} initialPoints={sprint.initial_points} onSelectChange={setSelectedChange} /></div><ScopeTimeline changes={displayChanges} capacityWarning={currentScope > total * 1.2 ? `范围已增加 ${(currentScope - total).toFixed(0)} pt，当前容量可能不足` : null} onAddTask={() => onToast('请使用看板中的“新建任务”添加需求')} onSelectChange={setSelectedChange} /></section><Board tasks={workspace.tasks} projectId={projectId} sprintId={sprint.id} disabled={sprint.status === 'completed'} onRemoveTask={removeTask} onCreateTask={createTask} onStatusChange={async (task, status) => { await workspace.updateTask(task.id, { status }); await workspace.refresh(); onToast('任务状态已更新'); }} onEditTask={async (task, input) => { await workspace.updateTask(task.id, input); await workspace.refresh(); onToast('任务已更新'); }} onDeleteTask={async (task) => { if (!window.confirm(`确定删除任务“${task.title}”吗？删除后无法恢复。`)) return; await workspace.deleteTask(task.id, '用户确认删除'); await workspace.refresh(); onToast('任务已删除'); }} />{statusModal && <Modal title={statusModal === 'active' ? '开始迭代' : '结束迭代'} close={() => setStatusModal(null)}><div className="confirm-copy"><b>{statusModal === 'active' ? '确认开始这次迭代？' : '确认结束这次迭代？'}</b><p>{statusModal === 'active' ? `初始范围 ${workspace.tasks.reduce((sum, task) => sum + task.story_points, 0)} pt，共 ${workspace.tasks.length} 个任务。` : `当前完成率 ${currentScope ? Math.round(completed / currentScope * 100) : 0}%，${workspace.tasks.filter((task) => task.status !== 'done').length} 个未完成任务将回到 Backlog。`}</p></div><button className="primary-btn full" onClick={() => void runStatus()} disabled={workspace.mutationLoading}>{workspace.mutationLoading ? '处理中…' : '确认'}</button></Modal>}{dateModal && <Modal title="编辑迭代日期" close={() => setDateModal(false)}><DateEditor sprint={sprint} onClose={() => setDateModal(false)} onToast={onToast} onRefresh={onRefresh} /></Modal>}{selectedChange && <Modal title="范围变更详情" close={() => setSelectedChange(null)}><div className="change-detail"><h2>{selectedChange.description}</h2><p>{selectedChange.reason || '未填写原因'}</p><div><span>点数变化</span><b>{selectedChange.points_delta > 0 ? '+' : ''}{selectedChange.points_delta} pt</b></div><div><span>操作人</span><b>{selectedChange.created_by || '未知'}</b></div>{selectedChange.task_id ? <button className="text-btn" onClick={() => navigate(sprintPath(sprint.id))}>查看任务</button> : <span className="disabled-note">该变更没有关联任务</span>}</div></Modal>}</> }

function DateEditor({ sprint, onClose, onToast, onRefresh }: { sprint: Sprint; onClose: () => void; onToast: (message: string) => void; onRefresh: () => Promise<void> }) { const [saving, setSaving] = useState(false); const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); try { await apiClient.updateSprintDates(sprint.id, String(form.get('start_date')), String(form.get('end_date'))); await onRefresh(); onToast('迭代日期已更新'); onClose(); } catch (error) { onToast(errorText(error)); } finally { setSaving(false); } }; return <form className="form-stack" onSubmit={submit}><div className="form-grid"><label>开始日期<input name="start_date" type="date" defaultValue={sprint.start_date.slice(0, 10)} required /></label><label>结束日期<input name="end_date" type="date" defaultValue={sprint.end_date.slice(0, 10)} required /></label></div><button className="primary-btn full" disabled={saving}>{saving ? '保存中…' : '保存日期'}</button></form>; }

function BacklogPage({ currentSprint, sprints, onRefresh, onToast }: { currentSprint: Sprint | null; sprints: Sprint[]; onRefresh: () => Promise<void>; onToast: (message: string) => void }) { const [tasks, setTasks] = useState<Task[]>([]); const [query, setQuery] = useState(''); const [priority, setPriority] = useState('all'); const [assignee, setAssignee] = useState('all'); const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [selected, setSelected] = useState<number[]>([]); const load = () => apiClient.listBacklog(projectId).then(setTasks).catch((error) => onToast(errorText(error))); useEffect(() => { void load(); }, []); const filtered = tasks.filter((task) => task.title.toLowerCase().includes(query.toLowerCase()) && (priority === 'all' || task.priority === priority) && (assignee === 'all' || (task.assignee || '未分配') === assignee)); const assignees = [...new Set(tasks.map((task) => task.assignee || '未分配'))]; const addSelected = async () => { const target = sprints.find((item) => item.status === 'planning'); if (!target) { onToast('请先新建一个规划中的迭代'); return; } try { for (const id of selected) await apiClient.addTaskToSprint(target.id, id, '从 Backlog 规划加入'); setSelected([]); await load(); await onRefresh(); onToast(`已将 ${selected.length} 个任务加入 ${target.name}`); } catch (error) { onToast(errorText(error)); } }; const create = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); const form = new FormData(event.currentTarget); try { await apiClient.createTask({ project_id: projectId, sprint_id: null, title: String(form.get('title')), story_points: Number(form.get('points')) as 1 | 2 | 3 | 5 | 8 | 13, priority: String(form.get('priority')) as Task['priority'], assignee: String(form.get('assignee') || '') || null }); await load(); setOpen(false); onToast('Backlog 任务已创建'); } catch (error) { onToast(errorText(error)); } finally { setSaving(false); } }; return <><PageHeader eyebrow="PRODUCT BACKLOG" title="Backlog" copy="管理尚未进入迭代的任务，并规划下一次迭代。" actions={<button className="primary-btn" onClick={() => setOpen(true)}><Plus size={15} /> 创建任务</button>} /><section className="panel backlog-page"><div className="filter-bar"><label className="search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按标题搜索" /></label><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">全部优先级</option>{['P0', 'P1', 'P2', 'P3'].map((item) => <option key={item}>{item}</option>)}</select><select value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="all">全部负责人</option>{assignees.map((item) => <option key={item}>{item}</option>)}</select><button className="ghost-btn" disabled={!selected.length} onClick={() => void addSelected()}><Archive size={14} /> 加入规划中的迭代 ({selected.length})</button></div>{filtered.length ? <div className="table-wrap"><table><thead><tr><th></th><th>任务</th><th>故事点</th><th>优先级</th><th>负责人</th><th>创建时间</th></tr></thead><tbody>{filtered.map((task) => <tr key={task.id}><td><input type="checkbox" checked={selected.includes(task.id)} onChange={(event) => setSelected((items) => event.target.checked ? [...items, task.id] : items.filter((id) => id !== task.id))} /></td><td><b>{task.title}</b><small>{task.description || '暂无描述'}</small></td><td>{task.story_points} pt</td><td><span className={`priority p-${task.priority}`}>{task.priority}</span></td><td>{task.assignee || '未分配'}</td><td>{formatDate(task.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState title="Backlog 为空" copy="创建第一个待规划任务，开始组织下一次迭代。" action={<button className="primary-btn" onClick={() => setOpen(true)}><Plus size={15} /> 创建任务</button>} />}</section>{open && <Modal title="创建 Backlog 任务" close={() => setOpen(false)}><form className="form-stack" onSubmit={create}><label>任务标题<input name="title" required /></label><div className="form-grid"><label>故事点<select name="points" defaultValue="3">{[1, 2, 3, 5, 8, 13].map((item) => <option key={item}>{item}</option>)}</select></label><label>优先级<select name="priority" defaultValue="P2">{['P0', 'P1', 'P2', 'P3'].map((item) => <option key={item}>{item}</option>)}</select></label></div><label>负责人<input name="assignee" placeholder="姓名或缩写" /></label><button className="primary-btn full" disabled={saving}>{saving ? '创建中…' : '创建任务'}</button></form></Modal>}</> }

function ReportPage({ sprint, sprints, onSelect, onToast }: { sprint: Sprint | null; sprints: Sprint[]; onSelect: (id: number) => void; onToast: (message: string) => void }) { const workspace = useSprintWorkspace(sprint?.id || null); const initial = sprint?.initial_points || 0; const final = workspace.snapshots[workspace.snapshots.length - 1]?.total_scope ?? workspace.tasks.reduce((sum, task) => sum + task.story_points, 0); const done = workspace.tasks.filter((task) => task.status === 'done').reduce((sum, task) => sum + task.story_points, 0); const copy = sprint ? `${sprint.name} 报告\n时间：${formatRange(sprint)}\n完成点数：${done} pt\n完成率：${final ? Math.round(done / final * 100) : 0}%\n初始范围：${initial} pt\n最终范围：${final} pt\n范围净变化：${final - initial >= 0 ? '+' : ''}${final - initial} pt\n范围变更：${workspace.scopeChanges.length} 次` : ''; const copySummary = async () => { try { await navigator.clipboard.writeText(copy); onToast('迭代摘要已复制'); } catch { onToast('复制失败，请检查浏览器权限'); } }; return <><PageHeader eyebrow="迭代报告" title="迭代报告" copy="用数据复盘结果、范围和未完成工作。" actions={<><select className="sprint-select" value={sprint?.id || ''} onChange={(event) => onSelect(Number(event.target.value))}>{sprints.map((item) => <option key={item.id} value={item.id}>{item.name} · {statusLabel[item.status]}</option>)}</select><button className="ghost-btn" onClick={() => void copySummary()} disabled={!sprint}>复制摘要</button></>} />{workspace.error ? <ErrorState message={workspace.error} retry={workspace.refresh} /> : sprint ? <><section className="metrics"><Metric label="完成点数" value={`${done} pt`} note={`${final ? Math.round(done / final * 100) : 0}% 完成率`} tone="green" /><Metric label="初始范围" value={`${initial} pt`} note="迭代开始时" tone="blue" /><Metric label="最终范围" value={`${final} pt`} note={`${final - initial >= 0 ? '+' : ''}${final - initial} pt 净变化`} tone="orange" /><Metric label="未完成任务" value={`${workspace.tasks.filter((task) => task.status !== 'done').length} 个`} note={sprint.status === 'completed' ? '已回到 Backlog' : '当前剩余工作'} tone="purple" /></section><div className="report-chart panel"><BurnupChart snapshots={workspace.snapshots} scopeChanges={workspace.scopeChanges} initialPoints={sprint.initial_points} /></div><ScopeTimeline changes={workspace.scopeChanges} /></> : <EmptyState title="请选择一个迭代" copy="报告需要绑定具体迭代。" />}</> }

function MembersPage({ members, isOwner, onRefresh, onToast }: { members: Array<{ id: string; name: string; email: string; role: string }>; isOwner: boolean; onRefresh: () => Promise<void>; onToast: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [editMember, setEditMember] = useState<{ id: string; name: string; role: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const roleLabel: Record<string, string> = { owner: '项目负责人', member: '成员', observer: '观察者' };
  const roleColor: Record<string, string> = { owner: 'owner', member: 'member', observer: 'observer' };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiClient.addMember(projectId, {
        user_id: String(form.get('user_id')),
        name: String(form.get('name')),
        email: String(form.get('email')),
        role: String(form.get('role')) as 'owner' | 'member' | 'observer'
      });
      await onRefresh();
      setOpen(false);
      onToast('成员已添加');
    } catch (error) {
      onToast(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const updateRole = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editMember) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiClient.updateMemberRole(projectId, editMember.id, {
        role: String(form.get('role')) as 'owner' | 'member' | 'observer'
      });
      await onRefresh();
      setEditMember(null);
      onToast('成员角色已更新');
    } catch (error) {
      onToast(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (member: { id: string; name: string }) => {
    if (!window.confirm(`确定移除成员"${member.name}"吗？`)) return;
    try {
      await apiClient.removeMember(projectId, member.id);
      await onRefresh();
      onToast('成员已移除');
    } catch (error) {
      onToast(errorText(error));
    }
  };

  return <>
    <PageHeader eyebrow="TEAM" title="成员" copy="管理项目成员与访问角色。项目至少需要 2 名负责人。" actions={<button className="primary-btn" disabled={!isOwner} title={!isOwner ? '只有项目负责人可以添加成员' : undefined} onClick={() => setOpen(true)}><Plus size={15} /> 添加成员</button>} />
    <section className="panel members-page">
      {members.length ? <div className="table-wrap"><table>
        <thead><tr><th>成员</th><th>用户标识</th><th>角色</th><th></th></tr></thead>
        <tbody>{members.map((member) => <tr key={member.id}>
          <td><div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="avatar avatar-blue">{member.name.slice(0, 2)}</div>
            <div><b>{member.name}</b><small>{member.email}</small></div>
          </div></td>
          <td><code>{member.id}</code></td>
          <td><span className={`role-tag ${roleColor[member.role] || 'member'}`}>{roleLabel[member.role] || member.role}</span></td>
          <td><div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            {isOwner && <button className="icon-btn" title="调整角色" onClick={() => setEditMember({ id: member.id, name: member.name, role: member.role })}><Pencil size={14} /></button>}
            {isOwner && <button className="icon-btn danger" title="移除成员" onClick={() => void removeMember(member)}><Trash2 size={14} /></button>}
          </div></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="暂无成员" copy="项目成员信息加载后会显示在这里。" />}
      {!isOwner && <p className="permission-note"><Shield size={14} /> 你是项目成员，只能查看成员列表。</p>}
    </section>
    {open && <Modal title="添加成员" close={() => setOpen(false)}>
      <form className="form-stack" onSubmit={submit}>
        <label>用户标识<input name="user_id" required placeholder="user-123" /></label>
        <label>姓名<input name="name" required placeholder="张三" /></label>
        <label>邮箱<input name="email" type="email" required placeholder="zhangsan@example.com" /></label>
        <label>角色<select name="role" defaultValue="member">
          <option value="owner">项目负责人 (Owner)</option>
          <option value="member">成员 (Member)</option>
          <option value="observer">观察者 (Observer)</option>
        </select></label>
        <button className="primary-btn full" disabled={saving}>{saving ? '添加中…' : '添加成员'}</button>
      </form>
    </Modal>}
    {editMember && <Modal title={`调整"${editMember.name}"的角色`} close={() => setEditMember(null)}>
      <form className="form-stack" onSubmit={updateRole}>
        <label>角色<select name="role" defaultValue={editMember.role}>
          <option value="owner">项目负责人 (Owner)</option>
          <option value="member">成员 (Member)</option>
          <option value="observer">观察者 (Observer)</option>
        </select></label>
        <p className="permission-note"><CircleHelp size={14} /> 项目负责人可以管理成员和修改设置，成员可以管理任务和迭代，观察者只能查看。</p>
        <button className="primary-btn full" disabled={saving}>{saving ? '保存中…' : '保存角色'}</button>
      </form>
    </Modal>}
  </>;
}
function IntegrationsPage() { return <><PageHeader eyebrow="PROJECT CONNECTIONS" title="集成" copy="查看项目可用的自动化连接能力。" /><section className="integration-grid"><div className="panel integration-card"><div className="integration-icon"><GitBranch size={22} /></div><div className="integration-copy"><div><h2>GitHub</h2><span className="status-pill planning">MVP-2</span></div><p>提交、Pull Request 与任务进度自动关联。</p><small>连接能力将在 MVP-2 提供，当前不会伪造 OAuth 或已连接状态。</small></div><button className="ghost-btn" disabled title="GitHub 集成将在 MVP-2 提供">连接 GitHub</button></div><div className="panel manual-card"><Zap size={18} /><div><b>手动更新仍然可用</b><p>你可以继续通过看板、Backlog 和范围时间线管理任务与进度。</p></div></div></section></> }
function SettingsPage({ project, isOwner, onSaved, onToast }: { project: { id: number; name: string; description: string | null } | null; isOwner: boolean; onSaved: (value: { id: number; name: string; description: string | null }) => void; onToast: (message: string) => void }) { const [name, setName] = useState(project?.name || ''); const [description, setDescription] = useState(project?.description || ''); const [cycle, setCycle] = useState('2'); const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false); useEffect(() => { setName(project?.name || ''); setDescription(project?.description || ''); }, [project]); useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]); const save = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { const value = await apiClient.updateProject(projectId, { name, description, default_sprint_weeks: Number(cycle) as 1 | 2 }); onSaved(value); setDirty(false); } catch (error) { onToast(errorText(error)); } finally { setSaving(false); } }; return <><PageHeader eyebrow="PROJECT SETTINGS" title="设置" copy="管理项目基本信息与默认迭代周期。" /><section className="panel settings-page"><form className="settings-form" onSubmit={save}><div className="settings-section"><h2>基本信息</h2><p>这些信息会显示在项目顶栏和工作区选择器中。</p><label>项目名称<input value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} disabled={!isOwner} /></label><label>项目描述<textarea value={description} onChange={(event) => { setDescription(event.target.value); setDirty(true); }} disabled={!isOwner} /></label></div><div className="settings-section"><h2>迭代默认周期</h2><p>新建迭代时使用的默认时间长度。</p><div className="segmented wide"><button type="button" className={cycle === '1' ? 'selected' : ''} onClick={() => { setCycle('1'); setDirty(true); }}>1 周</button><button type="button" className={cycle === '2' ? 'selected' : ''} onClick={() => { setCycle('2'); setDirty(true); }}>2 周</button></div></div>{!isOwner && <div className="permission-note"><Shield size={14} /> 只有项目 Owner 可以修改设置，当前字段为只读。</div>}<div className="settings-actions"><button type="button" className="ghost-btn" onClick={() => { if (dirty && !window.confirm('有未保存的修改，确定取消吗？')) return; setName(project?.name || ''); setDescription(project?.description || ''); setDirty(false); }}>取消</button><button className="primary-btn" disabled={!isOwner || !dirty || saving}>{saving ? '保存中…' : '保存设置'}</button></div></form></section></> }
function validateStages(stages: StageTemplateItem[]): string | null { if (!stages.length) return '项目必须至少保留一个阶段'; const names = stages.map((item) => item.name.trim()); if (names.some((name) => !name)) return '阶段名称不能为空'; if (new Set(names).size !== names.length) return '同一项目内阶段名称不能重复'; return null; }

function ProjectCreatePage({ onToast }: { onToast: (message: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState<StageTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = () => { setLoading(true); setError(null); apiClient.getStageTemplate().then((items) => setStages(items.map((item) => ({ name: item.name })))).catch((err) => setError(errorText(err))).finally(() => setLoading(false)); };
  useEffect(load, []);
  const validation = validateStages(stages);
  const update = (index: number, value: string) => setStages((items) => items.map((item, i) => (i === index ? { ...item, name: value } : item)));
  const move = (index: number, delta: number) => setStages((items) => { const target = index + delta; if (target < 0 || target >= items.length) return items; const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (validation) { onToast(validation); return; }
    setSaving(true);
    try { const project = await apiClient.createProject({ name: name.trim(), description: description.trim() || null, stages: stages.map((item) => ({ ...item, name: item.name.trim() })) }); onToast('项目已创建'); navigate(`/projects/${project.id}/stages`); }
    catch (err) { onToast(errorText(err)); } finally { setSaving(false); }
  };
  return <><PageHeader eyebrow="NEW PROJECT" title="新建项目" copy="从默认开发模板创建项目，创建前可调整阶段。" />
    {error ? <ErrorState message={error} retry={load} /> : loading ? <LoadingState /> : <section className="panel stage-create"><form className="form-stack" onSubmit={submit}>
      <label>项目名称<input value={name} onChange={(event) => setName(event.target.value)} required placeholder="例如：支付中台 2.0" /></label>
      <label>项目描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="这个项目要交付什么？" /></label>
      <div className="stage-edit-list"><div className="section-label"><span>项目阶段</span><em>{stages.length}</em></div>
        {stages.map((stage, index) => <div className="stage-edit-row" key={index}><span className="stage-pos">{index + 1}</span><input value={stage.name} onChange={(event) => update(index, event.target.value)} placeholder="阶段名称" /><div className="stage-row-actions"><button type="button" className="icon-btn" title="上移" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-btn" title="下移" disabled={index === stages.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button><button type="button" className="icon-btn danger" title="删除阶段" onClick={() => setStages((items) => items.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div></div>)}
        <button type="button" className="ghost-btn" onClick={() => setStages((items) => [...items, { name: '' }])}><Plus size={14} /> 添加阶段</button></div>
      {validation && <p className="permission-note"><CircleHelp size={14} /> {validation}</p>}
      <button className="primary-btn full" disabled={saving || !!validation}>{saving ? '创建中…' : '创建项目'}</button>
    </form></section>}</>;
}

type StageModal = { kind: 'add' } | { kind: 'edit'; stage: Stage } | { kind: 'delete'; stage: Stage; impact: { tasks: number; deliverables: number } } | { kind: 'start'; stage: Stage } | { kind: 'complete'; stage: Stage };

function StageListPage({ routeProjectId, onToast }: { routeProjectId: number; onToast: (message: string) => void }) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<StageModal | null>(null);
  const isOwner = members.find((member) => member.id === getUserId())?.role === 'owner' || getUserId() === 'demo-user';
  const load = async () => { setLoading(true); setError(null); try { const [stageList, detail] = await Promise.all([apiClient.listStages(routeProjectId), apiClient.getProject(routeProjectId)]); setStages(stageList); setMembers(detail.members); } catch (err) { setError(errorText(err)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [routeProjectId]);
  const run = async (action: () => Promise<unknown>, message: string) => { try { await action(); setModal(null); await load(); onToast(message); } catch (err) { onToast(errorText(err)); } };
  const move = (stage: Stage, delta: number) => {
    const movable = stages.filter((item) => item.status !== 'completed');
    const index = movable.findIndex((item) => item.id === stage.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= movable.length) return;
    const ids = movable.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => apiClient.reorderStages(routeProjectId, ids), '阶段顺序已调整');
  };
  const remove = async (stage: Stage) => {
    try { await apiClient.deleteStage(routeProjectId, stage.id); await load(); onToast('阶段已删除'); }
    catch (err) {
      const detail = err instanceof ApiError ? (err.body as { detail?: unknown } | null)?.detail : null;
      if (err instanceof ApiError && err.status === 409 && detail && typeof detail === 'object' && 'confirm_required' in detail) { const preview = detail as unknown as StageDeletePreview; setModal({ kind: 'delete', stage, impact: preview.impact }); return; }
      onToast(errorText(err));
    }
  };
  const ownerName = (ownerId: string | null) => (ownerId ? members.find((member) => member.id === ownerId)?.name || ownerId : '未指定');
  const activeStages = stages.filter((item) => item.status === 'active');
  return <><PageHeader eyebrow="PROJECT STAGES" title="项目阶段" copy="按开发流程推进阶段，主阶段标识当前主要方向。" actions={<button className="primary-btn" disabled={!isOwner} title={!isOwner ? '只有项目负责人可以修改阶段结构' : undefined} onClick={() => setModal({ kind: 'add' })}><Plus size={15} /> 新增阶段</button>} />
    {error ? <ErrorState message={error} retry={load} /> : loading ? <LoadingState /> : !stages.length ? <EmptyState title="暂无阶段" copy="从新增阶段开始搭建项目开发流程。" action={isOwner ? <button className="primary-btn" onClick={() => setModal({ kind: 'add' })}><Plus size={15} /> 新增阶段</button> : undefined} /> : <div className="stage-list">{stages.map((stage) => <div className={`stage-row ${stage.status}`} key={stage.id}>
      <span className="stage-pos">{stage.position + 1}</span>
      <div className="stage-main"><a className="stage-name" href={`/projects/${routeProjectId}/stages/${stage.id}`}>{stage.name}</a><small>{stage.goal || '暂无阶段目标'}</small></div>
      <div className="stage-meta"><span>{ownerName(stage.owner_id)}</span><small>{stage.planned_start || stage.planned_end ? `${formatDate(stage.planned_start)} - ${formatDate(stage.planned_end)}` : '未排期'}</small></div>
      <span className={`status-pill ${stageStatusTone[stage.status]}`}><i /> {stageStatusLabel[stage.status]}</span>
      {stage.status === 'active' && <span className={`role-tag ${stage.is_primary ? 'owner' : ''}`}>{stage.is_primary ? '主阶段' : '并行阶段'}</span>}
      <div className="stage-row-actions">
        {isOwner && stage.status !== 'completed' && <><button className="icon-btn" title="上移" onClick={() => move(stage, -1)}><ArrowUp size={14} /></button><button className="icon-btn" title="下移" onClick={() => move(stage, 1)}><ArrowDown size={14} /></button></>}
        {isOwner && stage.status === 'planned' && <button className="ghost-btn small" onClick={() => setModal({ kind: 'start', stage })}><Play size={13} /> 启动</button>}
        {isOwner && stage.status === 'active' && !stage.is_primary && <button className="ghost-btn small" onClick={() => void run(() => apiClient.setPrimaryStage(routeProjectId, stage.id), '主阶段已切换')}><Flag size={13} /> 设为主阶段</button>}
        {isOwner && stage.status === 'active' && <button className="ghost-btn small" onClick={() => setModal({ kind: 'complete', stage })}><Check size={13} /> 完成</button>}
        {isOwner && <button className="icon-btn" title="编辑阶段" onClick={() => setModal({ kind: 'edit', stage })}><Pencil size={14} /></button>}
        {isOwner && stage.status !== 'completed' && <button className="icon-btn danger" title="删除阶段" onClick={() => void remove(stage)}><Trash2 size={14} /></button>}
      </div></div>)}</div>}
    {!isOwner && !loading && !error && <p className="permission-note"><Shield size={14} /> 你是项目成员，只能查看阶段列表。</p>}
    {modal && (modal.kind === 'add' || modal.kind === 'edit') && <StageFormModal routeProjectId={routeProjectId} members={members} stage={modal.kind === 'edit' ? modal.stage : null} onClose={() => setModal(null)} onSaved={(message) => void run(async () => undefined, message)} reload={load} onToast={onToast} />}
    {modal?.kind === 'delete' && <Modal title="删除阶段" close={() => setModal(null)}><div className="form-stack"><p>删除「{modal.stage.name}」将同时影响其中 <b>{modal.impact.tasks}</b> 个任务和 <b>{modal.impact.deliverables}</b> 个交付物，确认删除？</p><div className="form-grid"><button className="ghost-btn" onClick={() => setModal(null)}>取消</button><button className="primary-btn danger" onClick={() => void run(() => apiClient.deleteStage(routeProjectId, modal.stage.id, true), '阶段已删除')}>确认删除</button></div></div></Modal>}
    {modal?.kind === 'start' && <Modal title={`启动阶段「${modal.stage.name}」`} close={() => setModal(null)}><div className="form-stack"><p>{activeStages.length ? '选择启动方式：主阶段是当前主要推进方向，并行阶段与主阶段同时推进。' : '这是项目首个启动的阶段，将自动成为主阶段。'}</p><div className="form-grid"><button className="ghost-btn" disabled={!activeStages.length} onClick={() => void run(() => apiClient.startStage(routeProjectId, modal.stage.id, false), '阶段已启动为并行阶段')}>并行启动</button><button className="primary-btn" onClick={() => void run(() => apiClient.startStage(routeProjectId, modal.stage.id, true), '阶段已启动')}>{activeStages.length ? '作为主阶段启动' : '启动（自动成为主阶段）'}</button></div></div></Modal>}
    {modal?.kind === 'complete' && <StageCompleteModal routeProjectId={routeProjectId} stage={modal.stage} activeStages={activeStages} onClose={() => setModal(null)} onDone={(message) => void run(async () => undefined, message)} onToast={onToast} />}
  </>;
}

function StageFormModal({ routeProjectId, members, stage, onClose, onSaved, reload, onToast }: { routeProjectId: number; members: ProjectMember[]; stage: Stage | null; onClose: () => void; onSaved: (message: string) => void; reload: () => Promise<void>; onToast: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const input = { name: String(form.get('name') || '').trim(), goal: String(form.get('goal') || '').trim() || null, owner_id: String(form.get('owner_id') || '') || null, planned_start: String(form.get('planned_start') || '') || null, planned_end: String(form.get('planned_end') || '') || null };
    try { if (stage) await apiClient.updateStage(routeProjectId, stage.id, input); else await apiClient.addStage(routeProjectId, input); await reload(); onClose(); onToast(stage ? '阶段已更新' : '阶段已新增'); }
    catch (err) { onToast(errorText(err)); } finally { setSaving(false); }
  };
  const completed = stage?.status === 'completed';
  return <Modal title={stage ? `编辑阶段「${stage.name}」` : '新增阶段'} close={onClose}><form className="form-stack" onSubmit={submit}>
    <label>阶段名称<input name="name" defaultValue={stage?.name || ''} required disabled={completed} title={completed ? '已完成阶段不能重命名' : undefined} /></label>
    <label>阶段目标<input name="goal" defaultValue={stage?.goal || ''} placeholder="这个阶段要达成什么？" /></label>
    <label>负责人<select name="owner_id" defaultValue={stage?.owner_id || ''}><option value="">未指定</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name} ({member.email})</option>)}</select></label>
    <div className="form-grid"><label>计划开始<input name="planned_start" type="date" defaultValue={stage?.planned_start || ''} /></label><label>计划结束<input name="planned_end" type="date" defaultValue={stage?.planned_end || ''} /></label></div>
    <button className="primary-btn full" disabled={saving}>{saving ? '保存中…' : stage ? '保存修改' : '新增阶段'}</button>
  </form></Modal>;
}

function StageCompleteModal({ routeProjectId, stage, activeStages, onClose, onDone, onToast }: { routeProjectId: number; stage: Stage; activeStages: Stage[]; onClose: () => void; onDone: (message: string) => void; onToast: (message: string) => void }) {
  const others = activeStages.filter((item) => item.id !== stage.id);
  const needsSuccessor = stage.is_primary && others.length > 0;
  const [successor, setSuccessor] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (needsSuccessor && !successor) { onToast('完成主阶段需指定继任主阶段'); return; }
    setSaving(true);
    try { await apiClient.completeStage(routeProjectId, stage.id, successor ? Number(successor) : undefined); onClose(); onDone('阶段已完成'); }
    catch (err) { onToast(errorText(err)); } finally { setSaving(false); }
  };
  return <Modal title={`完成阶段「${stage.name}」`} close={onClose}><div className="form-stack">
    <p>{needsSuccessor ? '该阶段是主阶段，完成后需由其他活动阶段接任主阶段。' : '完成后阶段将转为已完成，不能删除或调整顺序。'}</p>
    {needsSuccessor && <label>继任主阶段<select value={successor} onChange={(event) => setSuccessor(event.target.value)}><option value="">请选择</option>{others.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <div className="form-grid"><button className="ghost-btn" onClick={onClose}>取消</button><button className="primary-btn" disabled={saving} onClick={() => void submit()}>{saving ? '提交中…' : '确认完成'}</button></div>
  </div></Modal>;
}

function StageWorkbenchPage({ routeProjectId, stageId, onToast }: { routeProjectId: number; stageId: number | null; onToast: (message: string) => void }) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [tasks, setTasks] = useState<StageTask[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [stageBlockers, setStageBlockers] = useState<StageBlocker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ status: string; priority: string; assignee: string; search: string; sort: string }>({ status: '', priority: '', assignee: '', search: '', sort: 'created_at' });
  const [modal, setModal] = useState<null | { kind: 'create' } | { kind: 'edit'; task: StageTask } | { kind: 'status'; task: StageTask } | { kind: 'move'; task: StageTask } | { kind: 'delete'; task: StageTask } | { kind: 'detail'; task: StageTask }>(null);
  const [stageBlockerModal, setStageBlockerModal] = useState<null | { kind: 'create' } | { kind: 'resolve' }>(null);
  const [saving, setSaving] = useState(false);

  const writable = stage?.status !== 'completed';
  const isOwner = members.find((member) => member.id === getUserId())?.role === 'owner' || getUserId() === 'demo-user';
  const loadStage = () => Promise.all([apiClient.listStages(routeProjectId), apiClient.getProject(routeProjectId)]).then(([list, detail]) => {
    setStages(list); setStage(list.find((item) => item.id === stageId) || null); setMembers(detail.members);
  }).catch((err) => setError(errorText(err)));
  const loadTasks = () => {
    if (stageId == null) return Promise.resolve();
    const query: Record<string, string> = {};
    if (filters.status) query.status = filters.status;
    if (filters.priority) query.priority = filters.priority;
    if (filters.assignee) query.assignee = filters.assignee;
    if (filters.search) query.search = filters.search;
    query.sort = filters.sort;
    return apiClient.listStageTasks(routeProjectId, stageId, query).then(setTasks).catch((err) => setError(errorText(err)));
  };
  useEffect(() => { if (stageId == null) return; setLoading(true); setError(null); Promise.all([loadStage(), loadTasks()]).finally(() => setLoading(false)); }, [routeProjectId, stageId]);
  useEffect(() => { if (stageId == null || loading) return; setError(null); void loadTasks(); }, [filters, stageId, loading]);
  const loadStageBlockers = () => { if (stageId == null) return Promise.resolve(); return apiClient.listStageBlockers(routeProjectId, stageId).then(setStageBlockers).catch(() => setStageBlockers([])); };
  useEffect(() => { if (stageId == null || stage?.status !== 'blocked') { setStageBlockers([]); return; } void loadStageBlockers(); }, [stage, stageId]);

  const assignees = [...new Set(tasks.map((task) => task.assignee || '未分配'))];
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stageId == null || !modal || modal.kind === 'delete') return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const reason = String(form.get('reason') || '') || undefined;
    try {
      if (modal.kind === 'create') {
        await apiClient.createStageTask(routeProjectId, stageId, {
          project_id: routeProjectId,
          stage_id: stageId,
          title: String(form.get('title')).trim(),
          description: String(form.get('description') || '') || null,
          priority: String(form.get('priority')) as StageTaskPriority,
          assignee: String(form.get('assignee') || '') || null,
          planned_date: String(form.get('planned_date') || '') || null,
          status: String(form.get('status')) as StageTaskStatus,
        });
        onToast('任务已创建');
      } else if (modal.kind === 'edit') {
        await apiClient.updateStageTask(routeProjectId, modal.task.id, {
          title: String(form.get('title')).trim(),
          description: String(form.get('description') || '') || null,
          priority: String(form.get('priority')) as StageTaskPriority,
          assignee: String(form.get('assignee') || '') || null,
          planned_date: String(form.get('planned_date') || '') || null,
        });
        onToast('任务已更新');
      } else if (modal.kind === 'status') {
        await apiClient.updateStageTask(routeProjectId, modal.task.id, { status: String(form.get('status')) as StageTaskStatus, reason });
        onToast('任务状态已更新');
      } else if (modal.kind === 'move') {
        await apiClient.moveStageTask(routeProjectId, modal.task.id, { target_stage_id: form.get('target_stage_id') ? Number(form.get('target_stage_id')) : null, reason });
        onToast('任务已移动');
      }
      setModal(null);
      await loadTasks();
    } catch (err) { onToast(errorText(err)); } finally { setSaving(false); }
  };
  const runDelete = async (task: StageTask) => {
    setSaving(true);
    try { await apiClient.deleteStageTask(routeProjectId, task.id); onToast('任务已删除'); setModal(null); await loadTasks(); }
    catch (err) { onToast(errorText(err)); } finally { setSaving(false); }
  };

  if (stageId == null) return <><PageHeader eyebrow="STAGE" title="阶段工作台" /><EmptyState title="缺少阶段参数" copy="请通过阶段列表进入。" action={<button className="primary-btn" onClick={() => navigate(`/projects/${routeProjectId}/stages`)}><Milestone size={15} /> 返回阶段列表</button>} /></>;
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} retry={() => { setLoading(true); setError(null); Promise.all([loadStage(), loadTasks()]).finally(() => setLoading(false)); }} />;
  if (!stage) return <><PageHeader eyebrow="STAGE" title="阶段工作台" /><EmptyState title="阶段不存在" copy="它可能已被删除，返回阶段列表查看。" action={<button className="primary-btn" onClick={() => navigate(`/projects/${routeProjectId}/stages`)}><Milestone size={15} /> 返回阶段列表</button>} /></>;
  return <><PageHeader eyebrow="STAGE WORKBENCH" title={stage.name} copy={stage.goal || '暂无阶段目标'} actions={<><span className={`status-pill ${stageStatusTone[stage.status]}`}><i /> {stageStatusLabel[stage.status]}</span>{stage.status === 'active' && <span className={`role-tag ${stage.is_primary ? 'owner' : ''}`}>{stage.is_primary ? '主阶段' : '并行阶段'}</span>}{stage.status !== 'blocked' && (isOwner || stage.owner_id === getUserId()) && <button className="ghost-btn danger" onClick={() => setStageBlockerModal({ kind: 'create' })}><Flag size={15} /> 标记阶段阻塞</button>}{stage.status === 'blocked' && <button className="ghost-btn" onClick={() => setStageBlockerModal({ kind: 'resolve' })}><Check size={15} /> 解除阶段阻塞</button>}{writable && <button className="primary-btn" onClick={() => setModal({ kind: 'create' })}><Plus size={15} /> 新建任务</button>}</>} />
    <section className="panel stage-workbench">
      <div className="overview-sprint"><div><span>顺序</span><b>第 {stage.position + 1} 阶段</b></div><div><span>负责人</span><b>{stage.owner_id || '未指定'}</b></div><div><span>计划日期</span><b>{stage.planned_start || stage.planned_end ? `${formatDate(stage.planned_start)} - ${formatDate(stage.planned_end)}` : '未排期'}</b></div></div>
      {!writable && <p className="permission-note"><Milestone size={14} /> 该阶段已完成，任务列表为只读状态。</p>}
      <div className="toolbar">
        <input className="search-input" placeholder="搜索任务标题" value={filters.search} onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))} />
        <select value={filters.status} onChange={(event) => setFilters((f) => ({ ...f, status: event.target.value }))}><option value="">全部状态</option>{Object.keys(stageTaskStatusLabel).map((key) => <option key={key} value={key}>{stageTaskStatusLabel[key as StageTaskStatus]}</option>)}</select>
        <select value={filters.priority} onChange={(event) => setFilters((f) => ({ ...f, priority: event.target.value }))}><option value="">全部优先级</option>{Object.keys(stageTaskPriorityLabel).map((key) => <option key={key} value={key}>{stageTaskPriorityLabel[key as StageTaskPriority]}</option>)}</select>
        <select value={filters.assignee} onChange={(event) => setFilters((f) => ({ ...f, assignee: event.target.value }))}><option value="">全部负责人</option>{assignees.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select value={filters.sort} onChange={(event) => setFilters((f) => ({ ...f, sort: event.target.value }))}>
          <option value="created_at">创建时间 ↑</option><option value="-created_at">创建时间 ↓</option>
          <option value="planned_date">计划日期 ↑</option><option value="-planned_date">计划日期 ↓</option>
          <option value="priority">优先级 ↑</option><option value="-priority">优先级 ↓</option>
        </select>
      </div>
      {tasks.length ? <div className="table-wrap"><table>
        <thead><tr><th>标题</th><th>负责人</th><th>优先级</th><th>计划日期</th><th>状态</th><th></th></tr></thead>
        <tbody>{tasks.map((task) => <tr key={task.id}>
          <td className="task-title">{task.title}</td>
          <td>{task.assignee || '未分配'}</td>
          <td><span className={`role-tag priority-${task.priority}`}>{stageTaskPriorityLabel[task.priority]}</span></td>
          <td>{formatDate(task.planned_date)}</td>
          <td><span className={`status-pill ${task.status}`}>{stageTaskStatusLabel[task.status]}</span></td>
          <td><div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="icon-btn" title="依赖与阻塞" onClick={() => setModal({ kind: 'detail', task })}><GitBranch size={14} /></button>
            {writable && <>
              <button className="icon-btn" title="编辑任务" onClick={() => setModal({ kind: 'edit', task })}><Pencil size={14} /></button>
              <button className="icon-btn" title="变更状态" onClick={() => setModal({ kind: 'status', task })}><RefreshCw size={14} /></button>
              <button className="icon-btn" title="移动阶段" onClick={() => setModal({ kind: 'move', task })}><ArrowRight size={14} /></button>
              <button className="icon-btn danger" title="删除任务" onClick={() => setModal({ kind: 'delete', task })}><Trash2 size={14} /></button>
            </>}
          </div></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="暂无任务" copy="该阶段下还没有任务，点击右上角新建任务开始。" />}
      <button className="text-btn" onClick={() => navigate(`/projects/${routeProjectId}/stages`)}>返回阶段列表 <span>→</span></button>
    </section>
    {modal && modal.kind === 'detail' && <TaskDetailModal task={modal.task} projectId={routeProjectId} tasks={tasks} members={members} isOwner={isOwner} onClose={() => setModal(null)} onToast={onToast} onChanged={() => { void loadTasks(); }} />}
    {modal && modal.kind !== 'detail' && <StageTaskModal kind={modal.kind} stage={stage} stages={stages} task={modal.kind === 'create' ? null : modal.task} onClose={() => setModal(null)} onSubmit={submit} onDelete={runDelete} saving={saving} />}
    {stageBlockerModal?.kind === 'create' && <StageBlockerModal kind="create" projectId={routeProjectId} stage={stage} members={members} onClose={() => setStageBlockerModal(null)} onSaved={async () => { setStageBlockerModal(null); await loadStage(); await loadStageBlockers(); onToast('已标记阶段阻塞'); }} onToast={onToast} />}
    {stageBlockerModal?.kind === 'resolve' && <StageBlockerModal kind="resolve" projectId={routeProjectId} stage={stage} members={members} activeBlockerId={stageBlockers.find((item) => !item.resolved_at)?.id ?? null} onClose={() => setStageBlockerModal(null)} onSaved={async () => { setStageBlockerModal(null); await loadStage(); await loadStageBlockers(); onToast('已解除阶段阻塞'); }} onToast={onToast} />}
  </>;
}

function StageTaskModal({ kind, stage, stages, task, onClose, onSubmit, onDelete, saving }: { kind: 'create' | 'edit' | 'status' | 'move' | 'delete'; stage: Stage; stages: Stage[]; task: StageTask | null; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onDelete: (task: StageTask) => void; saving: boolean }) {
  const title = kind === 'create' ? '新建任务' : kind === 'edit' ? `编辑「${task?.title}」` : kind === 'status' ? `变更状态「${task?.title}」` : kind === 'move' ? `移动任务「${task?.title}」` : `删除「${task?.title}」`;
  if (kind === 'delete') return <Modal title={title} close={onClose}><div className="form-stack"><p>确定删除该任务吗？此操作不可撤销。</p><div className="form-grid"><button className="ghost-btn" onClick={onClose}>取消</button><button className="primary-btn danger" disabled={saving} onClick={() => task && onDelete(task)}>{saving ? '删除中…' : '确认删除'}</button></div></div></Modal>;
  const statusOptions = task ? [task.status, ...stageTaskTransitions[task.status]] : (Object.keys(stageTaskStatusLabel) as StageTaskStatus[]);
  const moveTargets = stages.filter((item) => item.id !== stage.id && item.status !== 'completed');
  return <Modal title={title} close={onClose}>
    <form className="form-stack" onSubmit={onSubmit}>
      {(kind === 'create' || kind === 'edit') && <>
        <label>标题<input name="title" defaultValue={task?.title || ''} required placeholder="任务标题" /></label>
        <label>描述<textarea name="description" defaultValue={task?.description || ''} placeholder="补充信息（可选）" /></label>
        <label>优先级<select name="priority" defaultValue={task?.priority || 'normal'}>{Object.keys(stageTaskPriorityLabel).map((key) => <option key={key} value={key}>{stageTaskPriorityLabel[key as StageTaskPriority]}</option>)}</select></label>
        <label>负责人<input name="assignee" defaultValue={task?.assignee || ''} placeholder="负责人（可选）" /></label>
        <label>计划日期<input name="planned_date" type="date" defaultValue={task?.planned_date || ''} /></label>
      </>}
      {kind === 'create' && <label>初始状态<select name="status" defaultValue="todo">{statusOptions.map((key) => <option key={key} value={key}>{stageTaskStatusLabel[key]}</option>)}</select></label>}
      {kind === 'status' && <>
        <label>新状态<select name="status" defaultValue={statusOptions[statusOptions.length - 1]}>{statusOptions.map((key) => <option key={key} value={key}>{stageTaskStatusLabel[key]}</option>)}</select></label>
        <label>变更原因<textarea name="reason" placeholder="可选，记录状态变更原因" /></label>
      </>}
      {kind === 'move' && <>
        <label>目标阶段<select name="target_stage_id" defaultValue="">
          <option value="">未规划（移出阶段）</option>
          {moveTargets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>移动原因<textarea name="reason" placeholder={stage.status === 'active' ? '移出进行中阶段需填写原因' : '可选'} /></label>
      </>}
      <div className="form-grid">
        <button type="button" className="ghost-btn" onClick={onClose}>取消</button>
        <button type="submit" className="primary-btn" disabled={saving}>{saving ? '保存中…' : kind === 'create' ? '创建任务' : '保存'}</button>
      </div>
    </form>
  </Modal>;
}

function TaskDetailModal({ task, projectId, tasks, members, isOwner, onClose, onToast, onChanged }: { task: StageTask; projectId: number; tasks: StageTask[]; members: ProjectMember[]; isOwner: boolean; onClose: () => void; onToast: (message: string) => void; onChanged: () => void }) {
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [blockers, setBlockers] = useState<TaskBlocker[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newDepId, setNewDepId] = useState('');
  const [resolution, setResolution] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [blockHandler, setBlockHandler] = useState('');
  const [reblockReason, setReblockReason] = useState('');
  const [reblockHandler, setReblockHandler] = useState('');
  const currentUserId = getUserId();
  const memberName = (id: string) => members.find((member) => member.id === id)?.name || id;

  const load = async () => {
    setLoading(true);
    try { const [deps, blks] = await Promise.all([apiClient.listTaskDependencies(projectId, task.id), apiClient.listTaskBlockers(projectId, task.id)]); setDependencies(deps); setBlockers(blks); }
    catch (error) { onToast(errorText(error)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [task.id]);

  const activeBlocker = blockers.find((item) => !item.resolved_at) || null;
  const isHandler = activeBlocker?.handler_id === currentUserId;
  const isAssignee = task.assignee === currentUserId;
  const addedIds = new Set(dependencies.map((item) => item.dependency_id));
  const candidates = tasks.filter((item) => item.id !== task.id && !addedIds.has(item.id));

  const guard = async (action: () => Promise<unknown>, message: string) => { setBusy(true); try { await action(); await load(); onChanged(); onToast(message); } catch (error) { onToast(errorText(error)); } finally { setBusy(false); } };
  const removeDependency = (depId: number) => void guard(() => apiClient.removeTaskDependency(projectId, task.id, depId), '已移除依赖');
  const addDependency = () => { if (!newDepId) { onToast('请选择前置任务'); return; } void guard(() => apiClient.addTaskDependency(projectId, task.id, { dependency_id: Number(newDepId), created_by: currentUserId }), '已添加依赖'); setNewDepId(''); };
  const resolveBlocker = () => { if (!resolution.trim()) { onToast('解除阻塞时必须填写解决结果'); return; } if (!activeBlocker) return; void guard(() => apiClient.resolveTaskBlocker(projectId, task.id, activeBlocker.id, { resolution: resolution.trim() }), '已解除阻塞'); };
  const markBlock = () => { if (!blockReason.trim() || !blockHandler) { onToast('标记阻塞时必须填写原因和处理人'); return; } void guard(() => apiClient.addTaskBlocker(projectId, task.id, { reason: blockReason.trim(), handler_id: blockHandler, created_by: currentUserId }), '已标记阻塞'); setBlockReason(''); setBlockHandler(''); };
  const confirmContinue = () => void guard(() => apiClient.confirmBlocker(projectId, task.id, { action: 'continue' }), '已确认继续');
  const confirmReblock = () => { if (!reblockReason.trim() || !reblockHandler) { onToast('标记阻塞时必须填写原因和处理人'); return; } void guard(() => apiClient.confirmBlocker(projectId, task.id, { action: 'reblock', reason: reblockReason.trim(), handler_id: reblockHandler }), '已标记新阻塞'); setReblockReason(''); setReblockHandler(''); };

  return <Modal title={`依赖与阻塞 · ${task.title}`} close={onClose}><div className="form-stack task-detail">
    <section className="detail-section">
      <h3>前置依赖</h3>
      {loading ? <p className="permission-note">加载中…</p> : dependencies.length ? <ul className="detail-list">{dependencies.map((dep) => <li key={dep.id}><div><b>{dep.dependency.title}</b><span className={`status-pill ${dep.dependency.status}`}>{stageTaskStatusLabel[dep.dependency.status]}</span></div>{isOwner && <button className="icon-btn danger" title="移除依赖" disabled={busy} onClick={() => removeDependency(dep.dependency_id)}><Trash2 size={13} /></button>}</li>)}</ul> : <p className="permission-note">暂无前置依赖</p>}
      {candidates.length > 0 && <div className="add-dep"><select value={newDepId} onChange={(event) => setNewDepId(event.target.value)}><option value="">添加前置任务…</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button className="primary-btn small" disabled={busy || !newDepId} onClick={addDependency}>添加</button></div>}
    </section>

    <section className="detail-section">
      <h3>历史阻塞记录</h3>
      {loading ? <p className="permission-note">加载中…</p> : blockers.length ? <ul className="detail-list">{blockers.map((blk) => <li key={blk.id} className="blocker-row"><div><b>{blk.reason}</b><small>处理人：{memberName(blk.handler_id)} · 创建：{blk.created_at.slice(0, 16).replace('T', ' ')}</small>{blk.resolved_at ? <small className="resolved">已解除（{blk.resolved_at.slice(0, 16).replace('T', ' ')}）：{blk.resolution || '—'}</small> : <small className="unresolved">未解除</small>}</div></li>)}</ul> : <p className="permission-note">暂无阻塞记录</p>}
      {task.status === 'blocked' && isHandler && <div className="detail-form"><label>解决结果<textarea value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="填写解决结果后解除阻塞" /></label><button className="primary-btn small" disabled={busy} onClick={resolveBlocker}>解除阻塞</button></div>}
    </section>

    {task.status === 'pending_verification' && isAssignee && <section className="detail-section">
      <h3>确认阻塞已解除</h3>
      <div className="form-grid"><button className="primary-btn small" disabled={busy} onClick={confirmContinue}>确认继续</button><button className="ghost-btn small" disabled={busy} onClick={() => setReblockHandler(reblockHandler || activeBlocker?.handler_id || '')}>标记新阻塞</button></div>
      <div className="detail-form"><label>新阻塞原因<textarea value={reblockReason} onChange={(event) => setReblockReason(event.target.value)} placeholder="标记新的阻塞原因" /></label><label>处理人<select value={reblockHandler} onChange={(event) => setReblockHandler(event.target.value)}><option value="">选择处理人</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><button className="primary-btn small" disabled={busy || !reblockReason.trim() || !reblockHandler} onClick={confirmReblock}>提交新阻塞</button></div>
    </section>}

    {task.status !== 'done' && task.status !== 'blocked' && <section className="detail-section">
      <h3>标记阻塞</h3>
      <div className="detail-form"><label>阻塞原因<textarea value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder="填写阻塞原因" /></label><label>处理人<select value={blockHandler} onChange={(event) => setBlockHandler(event.target.value)}><option value="">选择处理人</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><button className="primary-btn small" disabled={busy || !blockReason.trim() || !blockHandler} onClick={markBlock}>标记阻塞</button></div>
    </section>}

    <div className="form-grid"><button type="button" className="ghost-btn" onClick={onClose}>关闭</button></div>
  </div></Modal>;
}

function StageBlockerModal({ kind, projectId, stage, members, activeBlockerId, onClose, onSaved, onToast }: { kind: 'create' | 'resolve'; projectId: number; stage: Stage; members: ProjectMember[]; activeBlockerId?: number | null; onClose: () => void; onSaved: () => void; onToast: (message: string) => void }) {
  const [reason, setReason] = useState('');
  const [handler, setHandler] = useState('');
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (kind === 'create') {
        if (!reason.trim() || !handler) { onToast('标记阻塞时必须填写原因和处理人'); return; }
        await apiClient.addStageBlocker(projectId, stage.id, { reason: reason.trim(), handler_id: handler, created_by: getUserId() });
      } else {
        if (!resolution.trim()) { onToast('解除阻塞时必须填写解决结果'); return; }
        if (activeBlockerId == null) { onToast('未找到未解除的阶段阻塞记录'); return; }
        await apiClient.resolveStageBlocker(projectId, stage.id, activeBlockerId, { resolution: resolution.trim() });
      }
      onSaved();
    } catch (error) { onToast(errorText(error)); } finally { setSaving(false); }
  };
  return <Modal title={kind === 'create' ? `标记阶段阻塞 · ${stage.name}` : `解除阶段阻塞 · ${stage.name}`} close={onClose}>
    <form className="form-stack" onSubmit={submit}>
      {kind === 'create' ? <>
        <label>阻塞原因<textarea name="reason" value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="填写阶段阻塞原因" /></label>
        <label>处理人<select name="handler" value={handler} onChange={(event) => setHandler(event.target.value)} required><option value="">选择处理人</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      </> : <label>解决结果<textarea name="resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} required placeholder="填写解决结果后解除阶段阻塞" /></label>}
      <div className="form-grid"><button type="button" className="ghost-btn" onClick={onClose}>取消</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? '保存中…' : kind === 'create' ? '标记阻塞' : '解除阻塞'}</button></div>
    </form>
  </Modal>;
}

function MyTasksPage() {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ project: string; stage: string; status: string; priority: string; sort: string }>({ project: '', stage: '', status: '', priority: '', sort: 'planned_date' });
  const load = () => {
    setLoading(true); setError(null);
    const params: { project_id?: number; stage_id?: number; status?: string; priority?: string; sort?: string } = { sort: filters.sort };
    if (filters.project) params.project_id = Number(filters.project);
    if (filters.stage) params.stage_id = Number(filters.stage);
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    apiClient.listMyTasks(params).then(setTasks).catch((err) => setError(errorText(err))).finally(() => setLoading(false));
  };
  useEffect(() => { void load(); }, [filters]);
  const projects = [...new Map(tasks.map((task) => [task.project_id, { id: task.project_id, name: task.project_name }])).values()];
  const stages = [...new Map(tasks.filter((task) => task.stage_id != null).map((task) => [task.stage_id as number, { id: task.stage_id as number, name: task.stage_name || '未命名' }])).values()];
  return <><PageHeader eyebrow="MY TASKS" title="我的任务" copy="跨项目查看指派给你的进行中任务。" actions={<button className="primary-btn" onClick={() => void load()}><RefreshCw size={15} /> 刷新</button>} />
    <section className="panel stage-workbench">
      <div className="toolbar">
        <select value={filters.project} onChange={(event) => setFilters((f) => ({ ...f, project: event.target.value }))}><option value="">全部项目</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={filters.stage} onChange={(event) => setFilters((f) => ({ ...f, stage: event.target.value }))}><option value="">全部阶段</option>{stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={filters.status} onChange={(event) => setFilters((f) => ({ ...f, status: event.target.value }))}><option value="">全部状态</option>{Object.keys(stageTaskStatusLabel).map((key) => <option key={key} value={key}>{stageTaskStatusLabel[key as StageTaskStatus]}</option>)}</select>
        <select value={filters.priority} onChange={(event) => setFilters((f) => ({ ...f, priority: event.target.value }))}><option value="">全部优先级</option>{Object.keys(stageTaskPriorityLabel).map((key) => <option key={key} value={key}>{stageTaskPriorityLabel[key as StageTaskPriority]}</option>)}</select>
        <select value={filters.sort} onChange={(event) => setFilters((f) => ({ ...f, sort: event.target.value }))}>
          <option value="planned_date">计划日期 ↑</option><option value="-planned_date">计划日期 ↓</option>
          <option value="created_at">创建时间 ↑</option><option value="-created_at">创建时间 ↓</option>
          <option value="priority">优先级 ↑</option><option value="-priority">优先级 ↓</option>
        </select>
      </div>
      {error ? <ErrorState message={error} retry={load} /> : loading ? <LoadingState /> : !tasks.length ? <EmptyState title="暂无任务" copy="没有指派给你的进行中任务。" /> : <div className="table-wrap"><table>
        <thead><tr><th>项目</th><th>阶段</th><th>标题</th><th>优先级</th><th>计划日期</th><th>状态</th></tr></thead>
        <tbody>{tasks.map((task) => <tr key={task.id}>
          <td><a className="link" href={`/projects/${task.project_id}/stages/${task.stage_id ?? ''}`}>{task.project_name}</a></td>
          <td>{task.stage_id ? <a className="link" href={`/projects/${task.project_id}/stages/${task.stage_id}`}>{task.stage_name || '未命名'}</a> : '未规划'}</td>
          <td className="task-title">{task.title}{task.overdue && <span className="flag-overdue">逾期</span>}{task.status === 'pending_verification' && <span className="flag-pending">待确认</span>}{task.blocked && <span className="flag-blocked">受阻</span>}</td>
          <td><span className={`role-tag priority-${task.priority}`}>{stageTaskPriorityLabel[task.priority]}</span></td>
          <td>{formatDate(task.planned_date)}</td>
          <td><span className={`status-pill ${task.status}`}>{stageTaskStatusLabel[task.status]}</span></td>
        </tr>)}</tbody>
      </table></div>}
    </section></>;
}

function Modal({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) { return <AntModal open title={title} footer={null} onCancel={close} destroyOnHidden>{children}</AntModal>; }
function PermissionDenied() { return <div className="not-found"><div className="brand"><div className="brand-mark"><Zap size={16} fill="currentColor" /></div>vibe<span className="brand-accent">pm</span></div><div className="not-found-card"><Shield size={34} color="#7056df" /><h1>无权限访问</h1><p>你不是该项目成员，请联系项目 Owner。</p><button className="primary-btn" onClick={() => navigate('/')}><LayoutDashboard size={15} /> 返回首页</button></div></div>; }
function NotFound() { return <div className="not-found"><div className="brand"><div className="brand-mark"><Zap size={16} fill="currentColor" /></div>vibe<span className="brand-accent">pm</span></div><div className="not-found-card"><b>404</b><h1>页面不存在</h1><p>这个地址没有对应的项目页面。</p><button className="primary-btn" onClick={() => navigate(`/projects/${projectId}`)}><LayoutDashboard size={15} /> 返回总览</button></div></div>; }

createRoot(document.getElementById('root')!).render(<App />);
