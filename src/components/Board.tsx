import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { MoreHorizontal, Plus, Search, X, Zap } from 'lucide-react';
import type { StoryPoints, Task, TaskCreateInput, TaskStatus, TaskUpdateInput } from '../types';

const STATUSES: Array<{ value: TaskStatus; label: string }> = [
  { value: 'todo', label: '待办' },
  { value: 'in_progress', label: '进行中' },
  { value: 'in_review', label: '待审核' },
  { value: 'done', label: '已完成' },
];

export interface BoardProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  onCreateTask?: (input: TaskCreateInput) => Promise<unknown> | unknown;
  onEditTask?: (task: Task, input: TaskUpdateInput) => Promise<unknown> | unknown;
  onDeleteTask?: (task: Task) => Promise<unknown> | unknown;
  /** 用于拖拽状态更新，未提供时仍会更新组件内的临时状态。 */
  onStatusChange?: (task: Task, status: TaskStatus) => Promise<unknown> | unknown;
  projectId?: number;
  sprintId?: number | null;
  disabled?: boolean;
}

type Draft = { title: string; story_points: StoryPoints; priority: Task['priority']; reason: string };

const initialDraft: Draft = { title: '', story_points: 3, priority: 'P2', reason: '' };

export function Board({
  tasks: inputTasks,
  onTaskClick,
  onCreateTask,
  onEditTask,
  onDeleteTask,
  onStatusChange,
  projectId,
  sprintId,
  disabled = false,
}: BoardProps) {
  const [localTasks, setLocalTasks] = useState<Task[]>(inputTasks);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Task | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => setLocalTasks(inputTasks), [inputTasks]);

  // Keep the board controlled by the parent while retaining optimistic drag state.
  const tasks = useMemo(() => {
    const localById = new Map(localTasks.map((task) => [task.id, task]));
    return inputTasks.map((task) => localById.get(task.id) ?? task);
  }, [inputTasks, localTasks]);

  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tasks;
    return tasks.filter((task) => `${task.title} ${task.description ?? ''}`.toLowerCase().includes(normalized));
  }, [query, tasks]);

  const moveTask = async (task: Task, status: TaskStatus) => {
    if (disabled || task.status === status) return;
    const previous = tasks;
    const next = previous.map((item) => item.id === task.id ? { ...item, status } : item);
    setLocalTasks(next);
    try {
      await onStatusChange?.(task, status);
      if (onStatusChange === undefined) await onEditTask?.(task, { status });
    } catch {
      setLocalTasks(previous);
    }
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.title.trim() || !onCreateTask) return;
    setSaving(true);
    try {
      await onCreateTask({
        project_id: projectId,
        sprint_id: sprintId,
        title: draft.title.trim(),
        story_points: draft.story_points,
        priority: draft.priority,
        reason: draft.reason.trim() || null,
      });
      setDraft(initialDraft);
      setShowCreate(false);
    } finally {
      setSaving(false);
    }
  };

  const saveSelected = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !onEditTask) return;
    const form = new FormData(event.currentTarget);
    const status = form.get('status') as TaskStatus;
    const storyPoints = Number(form.get('story_points')) as StoryPoints;
    setSaving(true);
    try {
      await onEditTask(selected, { status, story_points: storyPoints });
      setSelected(null);
    } finally {
      setSaving(false);
    }
  };

  const removeSelected = async () => {
    if (!selected || !onDeleteTask) return;
    setSaving(true);
    try {
      await onDeleteTask(selected);
      setSelected(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="board panel" aria-label="Sprint 看板">
      <div className="panel-head board-head">
        <div><h2>Sprint 看板</h2><p>拖动任务卡片更新状态。</p></div>
        <div className="board-tools">
          <label className="search" aria-label="搜索任务">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务…" />
          </label>
          <button className="primary-btn" type="button" onClick={() => setShowCreate(true)} disabled={disabled || !onCreateTask}>
            <Plus size={15} /> 新建任务
          </button>
        </div>
      </div>
      <div className="columns">
        {STATUSES.map((column) => {
          const columnTasks = filteredTasks.filter((task) => task.status === column.value);
          return (
            <div className="column" key={column.value}>
              <div className="column-head"><div><b>{column.label}</b><span>{columnTasks.length}</span></div><button className="icon-btn" type="button" title="新建任务" onClick={() => setShowCreate(true)}><Plus size={16} /></button></div>
              <div className="task-list" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const id = Number(event.dataTransfer.getData('task-id')); const task = tasks.find((item) => item.id === id); if (task) void moveTask(task, column.value); }}>
                {columnTasks.map((task) => <TaskCard key={task.id} task={task} disabled={disabled} onClick={() => { onTaskClick?.(task); setSelected(task); }} onDragStart={(event) => event.dataTransfer.setData('task-id', String(task.id))} />)}
              </div>
            </div>
          );
        })}
      </div>

      {selected && onEditTask && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <form className="drawer" onSubmit={saveSelected} onClick={(event) => event.stopPropagation()}>
            <div className="drawer-head"><span>任务详情</span><button className="icon-btn" type="button" title="关闭" onClick={() => setSelected(null)}><X size={18} /></button></div>
            <div className="drawer-body"><div className="task-title-row"><span className={`priority p-${selected.priority}`}>{selected.priority}</span><h2>{selected.title}</h2></div>
              <div className="drawer-grid"><label>状态<select name="status" defaultValue={selected.status}>{STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label><label>故事点<select name="story_points" defaultValue={selected.story_points}>{[1, 2, 3, 5, 8, 13].map((points) => <option key={points} value={points}>{points}</option>)}</select></label></div>
              <button className="primary-btn full" type="submit" disabled={saving}>{saving ? '保存中…' : '保存修改'}</button>
              {onDeleteTask && <button className="ghost-btn full" type="button" onClick={() => void removeSelected()} disabled={saving}>删除任务</button>}
            </div>
          </form>
        </div>
      )}

      {showCreate && onCreateTask && <div className="overlay" onClick={() => setShowCreate(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><span>新建任务</span><button className="icon-btn" type="button" title="关闭" onClick={() => setShowCreate(false)}><X size={18} /></button></div><form onSubmit={submitCreate}><label>任务标题<input autoFocus required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="需要完成什么？" /></label><div className="drawer-grid"><label>故事点<select value={draft.story_points} onChange={(event) => setDraft({ ...draft, story_points: Number(event.target.value) as StoryPoints })}>{[1, 2, 3, 5, 8, 13].map((points) => <option key={points} value={points}>{points}</option>)}</select></label><label>优先级<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Task['priority'] })}>{['P0', 'P1', 'P2', 'P3'].map((priority) => <option key={priority}>{priority}</option>)}</select></label></div><label>变更原因（选填）<textarea value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label><button className="primary-btn full" type="submit" disabled={saving}>{saving ? '创建中…' : '创建任务'}</button></form></div></div>}
    </section>
  );
}

function TaskCard({ task, disabled, onClick, onDragStart }: { task: Task; disabled: boolean; onClick: () => void; onDragStart: (event: DragEvent<HTMLDivElement>) => void }) {
  return <div className="task-card" draggable={!disabled} onDragStart={onDragStart} onClick={onClick} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onClick(); }}><div className="task-top"><span className={`priority p-${task.priority}`}>{task.priority}</span><MoreHorizontal size={15} aria-hidden="true" /></div><h3>{task.title}</h3><div className="task-bottom"><span className="points"><Zap size={12} />{task.story_points}</span><span className="tag">{task.assignee ?? '未分配'}</span></div></div>;
}

export default Board;
