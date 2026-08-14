import { useEffect, useState } from 'react';
import type React from 'react';
import { useNavigate, useParams } from '@umijs/max';
import {
  ArrowRightOutlined,
  BranchesOutlined,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  FlagOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { EmptyState, ErrorState, Modal, PageHeader } from '@/components/common';
import { errorText, formatDate } from '@/utils/format';
import { apiClient, getUserId } from '@/services/api';
import { useAppContext } from '@/layouts/MainLayout';
import type {
  ProjectMember,
  Stage,
  StageBlocker,
  StageStatus,
  StageTask,
  StageTaskPriority,
  StageTaskStatus,
  TaskBlocker,
  TaskDependency,
} from '@/types';

const stageStatusLabel: Record<StageStatus, string> = { planned: '未开始', active: '进行中', blocked: '受阻', completed: '已完成' };
const stageStatusTone: Record<StageStatus, string> = { planned: 'planning', active: 'active', blocked: 'blocked', completed: 'completed' };
const stageTaskStatusLabel: Record<StageTaskStatus, string> = { todo: '未开始', in_progress: '进行中', blocked: '受阻', pending_verification: '待验收', done: '已完成' };
const stageTaskPriorityLabel: Record<StageTaskPriority, string> = { urgent: '紧急', important: '重要', normal: '正常', low: '低' };
const stageTaskTransitions: Record<StageTaskStatus, StageTaskStatus[]> = { todo: ['in_progress'], in_progress: ['done', 'blocked'], blocked: ['pending_verification'], pending_verification: ['done'], done: [] };

export default function StageWorkbenchPage() {
  const { projectId: pid, stageId: sid } = useParams();
  const ctx = useAppContext();
  const navigate = useNavigate();
  const projectId = Number(pid) || ctx.projectId;
  const stageId = sid ? Number(sid) : null;
  const onToast = ctx.onToast;
  const members: ProjectMember[] = ctx.members;

  const [stage, setStage] = useState<Stage | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [tasks, setTasks] = useState<StageTask[]>([]);
  const [stageBlockers, setStageBlockers] = useState<StageBlocker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ status: string; priority: string; assignee: string; search: string; sort: string }>({
    status: '',
    priority: '',
    assignee: '',
    search: '',
    sort: 'created_at',
  });
  const [modal, setModal] = useState<null | { kind: 'create' } | { kind: 'edit'; task: StageTask } | { kind: 'status'; task: StageTask } | { kind: 'move'; task: StageTask } | { kind: 'delete'; task: StageTask } | { kind: 'detail'; task: StageTask }>(null);
  const [stageBlockerModal, setStageBlockerModal] = useState<null | { kind: 'create' } | { kind: 'resolve' }>(null);
  const [saving, setSaving] = useState(false);

  const writable = stage?.status !== 'completed';
  const isOwner = ctx.isOwner;
  const loadStage = () =>
    Promise.all([apiClient.listStages(projectId), apiClient.getProject(projectId)]).then(([list]) => {
      setStages(list);
      setStage(list.find((item) => item.id === stageId) || null);
    }).catch((err) => setError(errorText(err)));
  const loadTasks = () => {
    if (stageId == null) return Promise.resolve();
    const query: Record<string, string> = {};
    if (filters.status) query.status = filters.status;
    if (filters.priority) query.priority = filters.priority;
    if (filters.assignee) query.assignee = filters.assignee;
    if (filters.search) query.search = filters.search;
    query.sort = filters.sort;
    return apiClient.listStageTasks(projectId, stageId, query).then(setTasks).catch((err) => setError(errorText(err)));
  };
  useEffect(() => {
    if (stageId == null) return;
    setLoading(true);
    setError(null);
    Promise.all([loadStage(), loadTasks()]).finally(() => setLoading(false));
  }, [projectId, stageId]);
  useEffect(() => {
    if (stageId == null || loading) return;
    setError(null);
    void loadTasks();
  }, [filters, stageId, loading]);
  const loadStageBlockers = () => {
    if (stageId == null) return Promise.resolve();
    return apiClient.listStageBlockers(projectId, stageId).then(setStageBlockers).catch(() => setStageBlockers([]));
  };
  useEffect(() => {
    if (stageId == null || stage?.status !== 'blocked') {
      setStageBlockers([]);
      return;
    }
    void loadStageBlockers();
  }, [stage, stageId]);

  const assignees = [...new Set(tasks.map((task) => task.assignee || '未分配'))];
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stageId == null || !modal || modal.kind === 'delete') return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const reason = String(form.get('reason') || '') || undefined;
    try {
      if (modal.kind === 'create') {
        await apiClient.createStageTask(projectId, stageId, {
          project_id: projectId,
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
        await apiClient.updateStageTask(projectId, modal.task.id, {
          title: String(form.get('title')).trim(),
          description: String(form.get('description') || '') || null,
          priority: String(form.get('priority')) as StageTaskPriority,
          assignee: String(form.get('assignee') || '') || null,
          planned_date: String(form.get('planned_date') || '') || null,
        });
        onToast('任务已更新');
      } else if (modal.kind === 'status') {
        await apiClient.updateStageTask(projectId, modal.task.id, { status: String(form.get('status')) as StageTaskStatus, reason });
        onToast('任务状态已更新');
      } else if (modal.kind === 'move') {
        await apiClient.moveStageTask(projectId, modal.task.id, { target_stage_id: form.get('target_stage_id') ? Number(form.get('target_stage_id')) : null, reason });
        onToast('任务已移动');
      }
      setModal(null);
      await loadTasks();
    } catch (err) {
      onToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };
  const runDelete = async (task: StageTask) => {
    setSaving(true);
    try {
      await apiClient.deleteStageTask(projectId, task.id);
      onToast('任务已删除');
      setModal(null);
      await loadTasks();
    } catch (err) {
      onToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  if (stageId == null)
    return (
      <>
        <PageHeader eyebrow="STAGE" title="阶段工作台" />
        <EmptyState
          title="缺少阶段参数"
          copy="请通过阶段列表进入。"
          action={
            <button className="primary-btn" onClick={() => navigate(`/projects/${projectId}/stages`)}>
              <FlagOutlined style={{ fontSize: 15 }} /> 返回阶段列表
            </button>
          }
        />
      </>
    );
  if (loading)
    return (
      <div className="state-panel">
        <ReloadOutlined className="spin" style={{ fontSize: 20 }} />
        <b>正在加载项目数据…</b>
      </div>
    );
  if (error)
    return (
      <ErrorState
        message={error}
        retry={() => {
          setLoading(true);
          setError(null);
          Promise.all([loadStage(), loadTasks()]).finally(() => setLoading(false));
        }}
      />
    );
  if (!stage)
    return (
      <>
        <PageHeader eyebrow="STAGE" title="阶段工作台" />
        <EmptyState
          title="阶段不存在"
          copy="它可能已被删除，返回阶段列表查看。"
          action={
            <button className="primary-btn" onClick={() => navigate(`/projects/${projectId}/stages`)}>
              <FlagOutlined style={{ fontSize: 15 }} /> 返回阶段列表
            </button>
          }
        />
      </>
    );
  return (
    <>
      <PageHeader
        eyebrow="STAGE WORKBENCH"
        title={stage.name}
        copy={stage.goal || '暂无阶段目标'}
        actions={
          <>
            <span className={`status-pill ${stageStatusTone[stage.status]}`}>
              <i /> {stageStatusLabel[stage.status]}
            </span>
            {stage.status === 'active' && <span className={`role-tag ${stage.is_primary ? 'owner' : ''}`}>{stage.is_primary ? '主阶段' : '并行阶段'}</span>}
            {stage.status !== 'blocked' && (isOwner || stage.owner_id === getUserId()) && (
              <button className="ghost-btn danger" onClick={() => setStageBlockerModal({ kind: 'create' })}>
                <FlagOutlined style={{ fontSize: 15 }} /> 标记阶段阻塞
              </button>
            )}
            {stage.status === 'blocked' && (
              <button className="ghost-btn" onClick={() => setStageBlockerModal({ kind: 'resolve' })}>
                <CheckOutlined style={{ fontSize: 15 }} /> 解除阶段阻塞
              </button>
            )}
            {writable && (
              <button className="primary-btn" onClick={() => setModal({ kind: 'create' })}>
                <PlusOutlined style={{ fontSize: 15 }} /> 新建任务
              </button>
            )}
          </>
        }
      />
      <section className="panel stage-workbench">
        <div className="overview-sprint">
          <div>
            <span>顺序</span>
            <b>第 {stage.position + 1} 阶段</b>
          </div>
          <div>
            <span>负责人</span>
            <b>{stage.owner_id || '未指定'}</b>
          </div>
          <div>
            <span>计划日期</span>
            <b>{stage.planned_start || stage.planned_end ? `${formatDate(stage.planned_start)} - ${formatDate(stage.planned_end)}` : '未排期'}</b>
          </div>
        </div>
        {!writable && (
          <p className="permission-note">
            <FlagOutlined style={{ fontSize: 14 }} /> 该阶段已完成，任务列表为只读状态。
          </p>
        )}
        <div className="toolbar">
          <input
            className="search-input"
            placeholder="搜索任务标题"
            value={filters.search}
            onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))}
          />
          <select value={filters.status} onChange={(event) => setFilters((f) => ({ ...f, status: event.target.value }))}>
            <option value="">全部状态</option>
            {Object.keys(stageTaskStatusLabel).map((key) => (
              <option key={key} value={key}>
                {stageTaskStatusLabel[key as StageTaskStatus]}
              </option>
            ))}
          </select>
          <select value={filters.priority} onChange={(event) => setFilters((f) => ({ ...f, priority: event.target.value }))}>
            <option value="">全部优先级</option>
            {Object.keys(stageTaskPriorityLabel).map((key) => (
              <option key={key} value={key}>
                {stageTaskPriorityLabel[key as StageTaskPriority]}
              </option>
            ))}
          </select>
          <select value={filters.assignee} onChange={(event) => setFilters((f) => ({ ...f, assignee: event.target.value }))}>
            <option value="">全部负责人</option>
            {assignees.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select value={filters.sort} onChange={(event) => setFilters((f) => ({ ...f, sort: event.target.value }))}>
            <option value="created_at">创建时间 ↑</option>
            <option value="-created_at">创建时间 ↓</option>
            <option value="planned_date">计划日期 ↑</option>
            <option value="-planned_date">计划日期 ↓</option>
            <option value="priority">优先级 ↑</option>
            <option value="-priority">优先级 ↓</option>
          </select>
        </div>
        {tasks.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>负责人</th>
                  <th>优先级</th>
                  <th>计划日期</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="task-title">{task.title}</td>
                    <td>{task.assignee || '未分配'}</td>
                    <td>
                      <span className={`role-tag priority-${task.priority}`}>{stageTaskPriorityLabel[task.priority]}</span>
                    </td>
                    <td>{formatDate(task.planned_date)}</td>
                    <td>
                      <span className={`status-pill ${task.status}`}>{stageTaskStatusLabel[task.status]}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button className="icon-btn" title="依赖与阻塞" onClick={() => setModal({ kind: 'detail', task })}>
                          <BranchesOutlined style={{ fontSize: 14 }} />
                        </button>
                        {writable && (
                          <>
                            <button className="icon-btn" title="编辑任务" onClick={() => setModal({ kind: 'edit', task })}>
                              <EditOutlined style={{ fontSize: 14 }} />
                            </button>
                            <button className="icon-btn" title="变更状态" onClick={() => setModal({ kind: 'status', task })}>
                              <ReloadOutlined style={{ fontSize: 14 }} />
                            </button>
                            <button className="icon-btn" title="移动阶段" onClick={() => setModal({ kind: 'move', task })}>
                              <ArrowRightOutlined style={{ fontSize: 14 }} />
                            </button>
                            <button className="icon-btn danger" title="删除任务" onClick={() => setModal({ kind: 'delete', task })}>
                              <DeleteOutlined style={{ fontSize: 14 }} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="暂无任务" copy="该阶段下还没有任务，点击右上角新建任务开始。" />
        )}
        <button className="text-btn" onClick={() => navigate(`/projects/${projectId}/stages`)}>
          返回阶段列表 <span>→</span>
        </button>
      </section>
      {modal && modal.kind === 'detail' && (
        <TaskDetailModal
          task={modal.task}
          projectId={projectId}
          tasks={tasks}
          members={members}
          isOwner={isOwner}
          onClose={() => setModal(null)}
          onToast={onToast}
          onChanged={() => {
            void loadTasks();
          }}
        />
      )}
      {modal && modal.kind !== 'detail' && (
        <StageTaskModal
          kind={modal.kind}
          stage={stage}
          stages={stages}
          task={modal.kind === 'create' ? null : modal.task}
          onClose={() => setModal(null)}
          onSubmit={submit}
          onDelete={runDelete}
          saving={saving}
        />
      )}
      {stageBlockerModal?.kind === 'create' && (
        <StageBlockerModal
          kind="create"
          projectId={projectId}
          stage={stage}
          members={members}
          onClose={() => setStageBlockerModal(null)}
          onSaved={async () => {
            setStageBlockerModal(null);
            await loadStage();
            await loadStageBlockers();
            onToast('已标记阶段阻塞');
          }}
          onToast={onToast}
        />
      )}
      {stageBlockerModal?.kind === 'resolve' && (
        <StageBlockerModal
          kind="resolve"
          projectId={projectId}
          stage={stage}
          members={members}
          activeBlockerId={stageBlockers.find((item) => !item.resolved_at)?.id ?? null}
          onClose={() => setStageBlockerModal(null)}
          onSaved={async () => {
            setStageBlockerModal(null);
            await loadStage();
            await loadStageBlockers();
            onToast('已解除阶段阻塞');
          }}
          onToast={onToast}
        />
      )}
    </>
  );
}

function StageTaskModal({
  kind,
  stage,
  stages,
  task,
  onClose,
  onSubmit,
  onDelete,
  saving,
}: {
  kind: 'create' | 'edit' | 'status' | 'move' | 'delete';
  stage: Stage;
  stages: Stage[];
  task: StageTask | null;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onDelete: (task: StageTask) => void;
  saving: boolean;
}) {
  const title =
    kind === 'create'
      ? '新建任务'
      : kind === 'edit'
        ? `编辑「${task?.title}」`
        : kind === 'status'
          ? `变更状态「${task?.title}」`
          : kind === 'move'
            ? `移动任务「${task?.title}」`
            : `删除「${task?.title}」`;
  if (kind === 'delete')
    return (
      <Modal title={title} close={onClose}>
        <div className="form-stack">
          <p>确定删除该任务吗？此操作不可撤销。</p>
          <div className="form-grid">
            <button className="ghost-btn" onClick={onClose}>
              取消
            </button>
            <button className="primary-btn danger" disabled={saving} onClick={() => task && onDelete(task)}>
              {saving ? '删除中…' : '确认删除'}
            </button>
          </div>
        </div>
      </Modal>
    );
  const statusOptions = task ? [task.status, ...stageTaskTransitions[task.status]] : (Object.keys(stageTaskStatusLabel) as StageTaskStatus[]);
  const moveTargets = stages.filter((item) => item.id !== stage.id && item.status !== 'completed');
  return (
    <Modal title={title} close={onClose}>
      <form className="form-stack" onSubmit={onSubmit}>
        {(kind === 'create' || kind === 'edit') && (
          <>
            <label>
              标题
              <input name="title" defaultValue={task?.title || ''} required placeholder="任务标题" />
            </label>
            <label>
              描述
              <textarea name="description" defaultValue={task?.description || ''} placeholder="补充信息（可选）" />
            </label>
            <label>
              优先级
              <select name="priority" defaultValue={task?.priority || 'normal'}>
                {Object.keys(stageTaskPriorityLabel).map((key) => (
                  <option key={key} value={key}>
                    {stageTaskPriorityLabel[key as StageTaskPriority]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              负责人
              <input name="assignee" defaultValue={task?.assignee || ''} placeholder="负责人（可选）" />
            </label>
            <label>
              计划日期
              <input name="planned_date" type="date" defaultValue={task?.planned_date || ''} />
            </label>
          </>
        )}
        {kind === 'create' && (
          <label>
            初始状态
            <select name="status" defaultValue="todo">
              {statusOptions.map((key) => (
                <option key={key} value={key}>
                  {stageTaskStatusLabel[key]}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'status' && (
          <>
            <label>
              新状态
              <select name="status" defaultValue={statusOptions[statusOptions.length - 1]}>
                {statusOptions.map((key) => (
                  <option key={key} value={key}>
                    {stageTaskStatusLabel[key]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              变更原因
              <textarea name="reason" placeholder="可选，记录状态变更原因" />
            </label>
          </>
        )}
        {kind === 'move' && (
          <>
            <label>
              目标阶段
              <select name="target_stage_id" defaultValue="">
                <option value="">未规划（移出阶段）</option>
                {moveTargets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              移动原因
              <textarea name="reason" placeholder={stage.status === 'active' ? '移出进行中阶段需填写原因' : '可选'} />
            </label>
          </>
        )}
        <div className="form-grid">
          <button type="button" className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-btn" disabled={saving}>
            {saving ? '保存中…' : kind === 'create' ? '创建任务' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TaskDetailModal({
  task,
  projectId,
  tasks,
  members,
  isOwner,
  onClose,
  onToast,
  onChanged,
}: {
  task: StageTask;
  projectId: number;
  tasks: StageTask[];
  members: ProjectMember[];
  isOwner: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
  onChanged: () => void;
}) {
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
    try {
      const [deps, blks] = await Promise.all([apiClient.listTaskDependencies(projectId, task.id), apiClient.listTaskBlockers(projectId, task.id)]);
      setDependencies(deps);
      setBlockers(blks);
    } catch (error) {
      onToast(errorText(error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [task.id]);

  const activeBlocker = blockers.find((item) => !item.resolved_at) || null;
  const isHandler = activeBlocker?.handler_id === currentUserId;
  const isAssignee = task.assignee === currentUserId;
  const addedIds = new Set(dependencies.map((item) => item.dependency_id));
  const candidates = tasks.filter((item) => item.id !== task.id && !addedIds.has(item.id));

  const guard = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      await load();
      onChanged();
      onToast(message);
    } catch (error) {
      onToast(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const removeDependency = (depId: number) => void guard(() => apiClient.removeTaskDependency(projectId, task.id, depId), '已移除依赖');
  const addDependency = () => {
    if (!newDepId) {
      onToast('请选择前置任务');
      return;
    }
    void guard(() => apiClient.addTaskDependency(projectId, task.id, { dependency_id: Number(newDepId), created_by: currentUserId }), '已添加依赖');
    setNewDepId('');
  };
  const resolveBlocker = () => {
    if (!resolution.trim()) {
      onToast('解除阻塞时必须填写解决结果');
      return;
    }
    if (!activeBlocker) return;
    void guard(() => apiClient.resolveTaskBlocker(projectId, task.id, activeBlocker.id, { resolution: resolution.trim() }), '已解除阻塞');
  };
  const markBlock = () => {
    if (!blockReason.trim() || !blockHandler) {
      onToast('标记阻塞时必须填写原因和处理人');
      return;
    }
    void guard(() => apiClient.addTaskBlocker(projectId, task.id, { reason: blockReason.trim(), handler_id: blockHandler, created_by: currentUserId }), '已标记阻塞');
    setBlockReason('');
    setBlockHandler('');
  };
  const confirmContinue = () => void guard(() => apiClient.confirmBlocker(projectId, task.id, { action: 'continue' }), '已确认继续');
  const confirmReblock = () => {
    if (!reblockReason.trim() || !reblockHandler) {
      onToast('标记阻塞时必须填写原因和处理人');
      return;
    }
    void guard(() => apiClient.confirmBlocker(projectId, task.id, { action: 'reblock', reason: reblockReason.trim(), handler_id: reblockHandler }), '已标记新阻塞');
    setReblockReason('');
    setReblockHandler('');
  };

  return (
    <Modal title={`依赖与阻塞 · ${task.title}`} close={onClose}>
      <div className="form-stack task-detail">
        <section className="detail-section">
          <h3>前置依赖</h3>
          {loading ? (
            <p className="permission-note">加载中…</p>
          ) : dependencies.length ? (
            <ul className="detail-list">
              {dependencies.map((dep) => (
                <li key={dep.id}>
                  <div>
                    <b>{dep.dependency.title}</b>
                    <span className={`status-pill ${dep.dependency.status}`}>{stageTaskStatusLabel[dep.dependency.status]}</span>
                  </div>
                  {isOwner && (
                    <button className="icon-btn danger" title="移除依赖" disabled={busy} onClick={() => removeDependency(dep.dependency_id)}>
                      <DeleteOutlined style={{ fontSize: 13 }} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="permission-note">暂无前置依赖</p>
          )}
          {candidates.length > 0 && (
            <div className="add-dep">
              <select value={newDepId} onChange={(event) => setNewDepId(event.target.value)}>
                <option value="">添加前置任务…</option>
                {candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <button className="primary-btn small" disabled={busy || !newDepId} onClick={addDependency}>
                添加
              </button>
            </div>
          )}
        </section>

        <section className="detail-section">
          <h3>历史阻塞记录</h3>
          {loading ? (
            <p className="permission-note">加载中…</p>
          ) : blockers.length ? (
            <ul className="detail-list">
              {blockers.map((blk) => (
                <li key={blk.id} className="blocker-row">
                  <div>
                    <b>{blk.reason}</b>
                    <small>
                      处理人：{memberName(blk.handler_id)} · 创建：{blk.created_at.slice(0, 16).replace('T', ' ')}
                    </small>
                    {blk.resolved_at ? <small className="resolved">已解除（{blk.resolved_at.slice(0, 16).replace('T', ' ')}）：{blk.resolution || '—'}</small> : <small className="unresolved">未解除</small>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="permission-note">暂无阻塞记录</p>
          )}
          {task.status === 'blocked' && isHandler && (
            <div className="detail-form">
              <label>
                解决结果
                <textarea value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="填写解决结果后解除阻塞" />
              </label>
              <button className="primary-btn small" disabled={busy} onClick={resolveBlocker}>
                解除阻塞
              </button>
            </div>
          )}
        </section>

        {task.status === 'pending_verification' && isAssignee && (
          <section className="detail-section">
            <h3>确认阻塞已解除</h3>
            <div className="form-grid">
              <button className="primary-btn small" disabled={busy} onClick={confirmContinue}>
                确认继续
              </button>
              <button className="ghost-btn small" disabled={busy} onClick={() => setReblockHandler(reblockHandler || activeBlocker?.handler_id || '')}>
                标记新阻塞
              </button>
            </div>
            <div className="detail-form">
              <label>
                新阻塞原因
                <textarea value={reblockReason} onChange={(event) => setReblockReason(event.target.value)} placeholder="标记新的阻塞原因" />
              </label>
              <label>
                处理人
                <select value={reblockHandler} onChange={(event) => setReblockHandler(event.target.value)}>
                  <option value="">选择处理人</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-btn small" disabled={busy || !reblockReason.trim() || !reblockHandler} onClick={confirmReblock}>
                提交新阻塞
              </button>
            </div>
          </section>
        )}

        {task.status !== 'done' && task.status !== 'blocked' && (
          <section className="detail-section">
            <h3>标记阻塞</h3>
            <div className="detail-form">
              <label>
                阻塞原因
                <textarea value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder="填写阻塞原因" />
              </label>
              <label>
                处理人
                <select value={blockHandler} onChange={(event) => setBlockHandler(event.target.value)}>
                  <option value="">选择处理人</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-btn small" disabled={busy || !blockReason.trim() || !blockHandler} onClick={markBlock}>
                标记阻塞
              </button>
            </div>
          </section>
        )}

        <div className="form-grid">
          <button type="button" className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </Modal>
  );
}

function StageBlockerModal({
  kind,
  projectId,
  stage,
  members,
  activeBlockerId,
  onClose,
  onSaved,
  onToast,
}: {
  kind: 'create' | 'resolve';
  projectId: number;
  stage: Stage;
  members: ProjectMember[];
  activeBlockerId?: number | null;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [handler, setHandler] = useState('');
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (kind === 'create') {
        if (!reason.trim() || !handler) {
          onToast('标记阻塞时必须填写原因和处理人');
          return;
        }
        await apiClient.addStageBlocker(projectId, stage.id, { reason: reason.trim(), handler_id: handler, created_by: getUserId() });
      } else {
        if (!resolution.trim()) {
          onToast('解除阻塞时必须填写解决结果');
          return;
        }
        if (activeBlockerId == null) {
          onToast('未找到未解除的阶段阻塞记录');
          return;
        }
        await apiClient.resolveStageBlocker(projectId, stage.id, activeBlockerId, { resolution: resolution.trim() });
      }
      onSaved();
    } catch (error) {
      onToast(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={kind === 'create' ? `标记阶段阻塞 · ${stage.name}` : `解除阶段阻塞 · ${stage.name}`} close={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {kind === 'create' ? (
          <>
            <label>
              阻塞原因
              <textarea name="reason" value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="填写阶段阻塞原因" />
            </label>
            <label>
              处理人
              <select name="handler" value={handler} onChange={(event) => setHandler(event.target.value)} required>
                <option value="">选择处理人</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label>
            解决结果
            <textarea name="resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} required placeholder="填写解决结果后解除阶段阻塞" />
          </label>
        )}
        <div className="form-grid">
          <button type="button" className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-btn" disabled={saving}>
            {saving ? '保存中…' : kind === 'create' ? '标记阻塞' : '解除阻塞'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
