import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Archive, BarChart3, Bell, CalendarDays, ChevronDown, GitBranch, LayoutDashboard, MoreHorizontal, Settings2, Users, Zap } from 'lucide-react';
import Board from './components/Board';
import BurnupChart from './components/BurnupChart';
import ScopeTimeline from './components/ScopeTimeline';
import { apiClient } from './api';
import { useSprintWorkspace } from './hooks';
import type { ScopeChange, Sprint, SprintStatus, Task, TaskCreateInput, TaskStatus } from './types';
import './styles.css';
import './backlog.css';

const statusLabel: Record<SprintStatus, string> = { planning: '规划中', active: '进行中', completed: '已完成' };
const demoText: Record<string, string> = {
  'Build the payment flow': '完成支付流程',
  'Payment infrastructure': '支付接口基础设施',
  'WeChat Pay channel': '微信支付渠道接入',
  'Refund status sync': '退款流程与状态同步',
  'Checkout result page': '支付结果页优化',
  'Reconciliation report': '对账报表',
  'Order alerts': '订单异常告警',
  'Conversion funnel': '埋点与转化漏斗',
  'Sprint started': 'Sprint 开始',
  'Added WeChat Pay channel': '新增「微信支付渠道接入」',
  'Removed reconciliation report': '移除「对账报表」',
  'Initial scope': '初始范围',
  'CEO request': '老板要求',
  'Priority lowered': '优先级降低',
};
const zhDemo = (value: string | null | undefined) => (value && demoText[value]) || value || '';

function App() {
  const [sprintId, setSprintId] = useState(1);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [showSprintForm, setShowSprintForm] = useState(false);
  const [showBacklog, setShowBacklog] = useState(false);
  const [backlog, setBacklog] = useState<Task[]>([]);
  const workspace = useSprintWorkspace(sprintId);
  useEffect(() => { void apiClient.listSprints().then(setSprints); }, []);
  const [selectedChange, setSelectedChange] = useState<ScopeChange | null>(null);
  const sprint = workspace.sprint;
  const tasks = workspace.tasks;
  const total = sprint?.initial_points || tasks.reduce((sum, task) => sum + task.story_points, 0);
  const completed = tasks.reduce((sum, task) => sum + task.story_points * ({ todo: 0, in_progress: .5, in_review: .8, done: 1 } as Record<TaskStatus, number>)[task.status], 0);
  const latestSnapshot = workspace.snapshots[workspace.snapshots.length - 1];
  const currentScope = latestSnapshot?.total_scope ?? tasks.reduce((sum, task) => sum + task.story_points, 0);
  const changeDelta = workspace.scopeChanges.reduce((sum, change) => sum + change.points_delta, 0);
  const capacityWarning = currentScope > total * 1.2 ? `范围已增加 ${(currentScope - total).toFixed(0)} pt，当前容量可能不足` : null;
  const displayTasks = useMemo(() => tasks.map((task) => ({ ...task, title: zhDemo(task.title), assignee: task.assignee || null })), [tasks]);
  const displayChanges = useMemo(() => workspace.scopeChanges.map((change) => ({ ...change, description: zhDemo(change.description), reason: zhDemo(change.reason), created_by: change.created_by === 'demo' ? '演示用户' : change.created_by })), [workspace.scopeChanges]);

  const handleCreateTask = async (input: TaskCreateInput) => {
    await workspace.createScopeChange({ type: 'add_task', title: input.title, description: input.description || `新增「${input.title}」`, story_points: input.story_points, points_delta: input.story_points, reason: input.reason || 'Sprint 执行中新增' });
    await workspace.refresh();
  };
  const handleStatus = async (task: Task, status: TaskStatus) => { await workspace.updateTask(task.id, { status }); await workspace.refresh(); };
  const handleDelete = async (task: Task) => { await workspace.deleteTask(task.id); await workspace.refresh(); };
  const handleScopeAdd = async () => {
    await workspace.createScopeChange({ type: 'add_task', title: '新需求', description: '通过范围变更新增需求', story_points: 3, points_delta: 3, reason: '产品调整' });
    await workspace.refresh();
  };
  const handleRemoveChange = async (change: ScopeChange) => { if (!change.task_id) return; await workspace.createScopeChange({ type: 'remove_task', task_id: change.task_id, description: change.description, points_delta: change.points_delta, reason: '需求移出 Sprint' }); await workspace.refresh(); };
  const handleChangePoints = async (change: ScopeChange) => { if (!change.task_id) return; const next = Number(window.prompt('请输入新的故事点（1/2/3/5/8/13）', '3')); if (![1, 2, 3, 5, 8, 13].includes(next)) return; await workspace.createScopeChange({ type: 'change_points', task_id: change.task_id, description: change.description, story_points: next as 1 | 2 | 3 | 5 | 8 | 13, points_delta: 0, reason: '重新估算故事点' }); await workspace.refresh(); };
  const handleCreateSprint = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const created = await apiClient.createSprint({ name: String(form.get('name')), goal: String(form.get('goal') || ''), start_date: String(form.get('start_date')), end_date: String(form.get('end_date')) }); setSprints((items) => [created, ...items]); setSprintId(created.id); setShowSprintForm(false); };
  const openBacklog = async () => { setShowBacklog(true); setBacklog(await apiClient.listBacklog()); };
  const addBacklogTask = async (task: Task) => { await apiClient.addTaskToSprint(sprintId, task.id, '加入当前 Sprint'); setBacklog((items) => items.filter((item) => item.id !== task.id)); await workspace.refresh(); };
  const handleStatusChange = async () => {
    if (!sprint) return;
    const next: SprintStatus = sprint.status === 'planning' ? 'active' : sprint.status === 'active' ? 'completed' : 'planning';
    await workspace.updateSprint(next); await workspace.refresh();
  };

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Zap size={16} fill="currentColor" /></div><span>vibe<span className="brand-accent">pm</span></span></div>
      <div className="workspace-switch"><div className="workspace-icon">V</div><div><b>Vibe PM</b><small>个人工作区</small></div><ChevronDown size={15} /></div>
      <nav><Nav icon={<LayoutDashboard size={17} />} label="总览" active /><Nav icon={<Activity size={17} />} label="Sprint 看板" /><Nav icon={<BarChart3 size={17} />} label="报告" /><Nav icon={<Archive size={17} />} label="待办列表" onClick={() => void openBacklog()} /></nav>
      <div className="nav-label">工作区</div><nav><Nav icon={<Users size={17} />} label="成员" /><Nav icon={<GitBranch size={17} />} label="集成" /></nav><div className="sidebar-bottom"><Nav icon={<Settings2 size={17} />} label="设置" /><div className="user"><div className="avatar avatar-purple">XM</div><div><b>小明</b><small>技术负责人</small></div><MoreHorizontal size={16} /></div></div>
    </aside>
    <main className="main"><header className="topbar"><div className="breadcrumbs"><span>Vibe PM</span><span>/</span><b>{sprint?.name || 'Sprint'}</b><span className="status-pill active"><i /> {sprint ? statusLabel[sprint.status] : '加载中'}</span></div><div className="top-actions"><button className="icon-btn" title="通知"><Bell size={18} /></button><div className="avatar avatar-blue">XM</div></div></header>
      <div className="content"><div className="page-head"><div><div className="eyebrow">当前迭代 <span>•</span> {sprint ? `${Math.max(0, Math.ceil((new Date(sprint.end_date).getTime() - Date.now()) / 86400000))} 天后结束` : '加载中'}</div><h1>{zhDemo(sprint?.goal) || '聚焦当前 Sprint 目标'}</h1><p>范围变化可追溯，进度状态可解释。</p></div><div className="head-actions"><button className="ghost-btn" onClick={() => setShowSprintForm(true)}><CalendarDays size={16} /> 新建 Sprint</button><button className="ghost-btn"><CalendarDays size={16} /> {sprint ? `${sprint.start_date} – ${sprint.end_date}` : '日期加载中'} <ChevronDown size={14} /></button>{sprint && <button className="primary-btn" onClick={() => void handleStatusChange()} disabled={workspace.mutationLoading}>{sprint.status === 'planning' ? '开始 Sprint' : sprint.status === 'active' ? '结束 Sprint' : '重新规划'}</button>}</div></div>
      {workspace.error && <div className="scope-timeline__warning" role="alert">{workspace.error}</div>}
      <section className="metrics"><Metric label="范围" value={`${currentScope} pt`} note={`初始 ${total} pt`} tone="blue" /><Metric label="已完成" value={`${completed.toFixed(1)} pt`} note={`${currentScope ? Math.round(completed / currentScope * 100) : 0}% 的范围`} tone="green" /><Metric label="剩余" value={`${Math.max(0, currentScope - completed).toFixed(1)} pt`} note="按当前状态计算" tone="orange" /><Metric label="范围变更" value={`${workspace.scopeChanges.length} 次`} note={`${changeDelta >= 0 ? '+' : ''}${changeDelta} pt`} tone="purple" /></section>
      <section className="grid-main"><div className="chart-card panel">{workspace.loading && !workspace.snapshots.length ? <div className="loading-state">正在加载燃起图…</div> : <BurnupChart snapshots={workspace.snapshots} scopeChanges={displayChanges} initialPoints={sprint?.initial_points} />}</div><ScopeTimeline changes={displayChanges} capacityWarning={capacityWarning} onAddTask={() => void handleScopeAdd()} onRemoveTask={(change) => void handleRemoveChange(change)} onChangePoints={(change) => void handleChangePoints(change)} onSelectChange={setSelectedChange} /></section>
      <Board tasks={displayTasks} projectId={1} sprintId={sprintId} onCreateTask={handleCreateTask} onStatusChange={handleStatus} onEditTask={async (task, input) => { await workspace.updateTask(task.id, input); await workspace.refresh(); }} onDeleteTask={handleDelete} />
      {showBacklog && <div className="overlay" onClick={() => setShowBacklog(false)}><div className="modal backlog-modal" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">BACKLOG</span><h2>待办列表</h2></div><button className="icon-btn" onClick={() => setShowBacklog(false)}>×</button></div><div className="backlog-list">{backlog.length === 0 ? <p className="empty-copy">暂无待办任务</p> : backlog.map((task) => <div className="backlog-row" key={task.id}><div><b>{zhDemo(task.title)}</b><small>{task.story_points} pt · {task.priority}</small></div><button className="primary-btn" onClick={() => void addBacklogTask(task)}>加入 Sprint</button></div>)}</div></div></div>}
      {showSprintForm && <div className="overlay" onClick={() => setShowSprintForm(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><span>新建 Sprint</span><button className="icon-btn" onClick={() => setShowSprintForm(false)}>×</button></div><form onSubmit={handleCreateSprint}><label>Sprint 名称<input name="name" required placeholder="Sprint 15" /></label><label>目标<input name="goal" placeholder="本次迭代要达成什么？" /></label><div className="drawer-grid"><label>开始日期<input name="start_date" type="date" required /></label><label>结束日期<input name="end_date" type="date" required /></label></div><button className="primary-btn full" type="submit">创建 Sprint</button></form></div></div>}
      {selectedChange && <div className="overlay" onClick={() => setSelectedChange(null)}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><span>范围变更详情</span><button className="icon-btn" onClick={() => setSelectedChange(null)}>×</button></div><div className="drawer-body"><h2>{selectedChange.description}</h2><p className="drawer-desc">{selectedChange.reason || '未填写原因'}</p><p>点数变化：<b>{selectedChange.points_delta > 0 ? '+' : ''}{selectedChange.points_delta} pt</b></p><p>操作人：{selectedChange.created_by || '未知'}</p></div></div></div>}
      </div>
    </main>
  </div>;
}

function Nav({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{active && <i />}</button>; }
function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) { return <div className="metric"><div className={`metric-icon ${tone}`}><Activity size={16} /></div><div><span>{label}</span><b>{value}</b><small>{note}</small></div></div>; }

createRoot(document.getElementById('root')!).render(<App />);
