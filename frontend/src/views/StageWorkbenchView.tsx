import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  Flag,
  GitBranch,
  Milestone,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import { apiClient, ApiError, getUserId } from '../api';
import { useToast } from '../context';
import { errorText, formatDate, formatDateTime } from '../lib/format';
import {
  stageTaskPriorityLabel,
  stageTaskStatusLabel,
  stageTaskTransitions,
} from '../lib/labels';
import { Modal } from '../components/shared/Modal';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/States';
import { PriorityBadge, StatusBadge } from '../components/shared/StatusBadge';
import type {
  AcceptanceBlockerDetail,
  DeliverableContentKind,
  DeliverableType,
  ProjectMember,
  Stage,
  StageAcceptance,
  StageBlocker,
  StageDeliverable,
  StageTask,
  StageTaskPriority,
  StageTaskStatus,
  TaskBlocker,
  TaskDependency,
} from '../types';
import { deliverableTypeLabel } from '../types';

type TaskModal =
  | null
  | { kind: 'create' }
  | { kind: 'edit'; task: StageTask }
  | { kind: 'status'; task: StageTask }
  | { kind: 'move'; task: StageTask }
  | { kind: 'delete'; task: StageTask }
  | { kind: 'detail'; task: StageTask };

type DeliverableModal =
  | null
  | { kind: 'create' }
  | { kind: 'edit'; item: StageDeliverable }
  | { kind: 'delete'; item: StageDeliverable };

type AcceptanceModal =
  | null
  | { kind: 'submit' }
  | { kind: 'reopen' }
  | { kind: 'review'; item: StageAcceptance };

type WorkbenchTab = 'tasks' | 'deliverables' | 'acceptance';

/** 阶段工作台：/projects/:projectId/stages/:stageId */
export function StageWorkbenchView() {
  const { projectId, stageId: stageParam } = useParams();
  const routeProjectId = Number(projectId);
  const stageId = stageParam ? Number(stageParam) : null;
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [tasks, setTasks] = useState<StageTask[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [stageBlockers, setStageBlockers] = useState<StageBlocker[]>([]);
  const [deliverables, setDeliverables] = useState<StageDeliverable[]>([]);
  const [acceptances, setAcceptances] = useState<StageAcceptance[]>([]);
  const [tab, setTab] = useState<WorkbenchTab>('tasks');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{
    status: string;
    priority: string;
    assignee: string;
    search: string;
    sort: string;
  }>({ status: '', priority: '', assignee: '', search: '', sort: 'created_at' });
  const [modal, setModal] = useState<TaskModal>(null);
  const [stageBlockerModal, setStageBlockerModal] = useState<
    null | { kind: 'create' } | { kind: 'resolve' }
  >(null);
  const [deliverableModal, setDeliverableModal] = useState<DeliverableModal>(null);
  const [acceptanceModal, setAcceptanceModal] = useState<AcceptanceModal>(null);
  const [blockedDetail, setBlockedDetail] = useState<AcceptanceBlockerDetail | null>(null);
  const [saving, setSaving] = useState(false);

  const writable = stage?.status !== 'completed';
  const currentUserId = getUserId();
  const isOwner =
    members.find((member) => member.id === currentUserId)?.role === 'owner' ||
    currentUserId === 'demo-user';
  const memberName = (id: string | null) =>
    id ? members.find((member) => member.id === id)?.name || id : '未指定';
  const loadStage = () =>
    Promise.all([apiClient.listStages(routeProjectId), apiClient.getProject(routeProjectId)])
      .then(([list, detail]) => {
        setStages(list);
        setStage(list.find((item) => item.id === stageId) || null);
        setMembers(detail.members);
      })
      .catch((err) => setError(errorText(err)));
  const loadTasks = () => {
    if (stageId == null) return Promise.resolve();
    const query: Record<string, string> = {};
    if (filters.status) query.status = filters.status;
    if (filters.priority) query.priority = filters.priority;
    if (filters.assignee) query.assignee = filters.assignee;
    if (filters.search) query.search = filters.search;
    query.sort = filters.sort;
    return apiClient
      .listStageTasks(routeProjectId, stageId, query)
      .then(setTasks)
      .catch((err) => setError(errorText(err)));
  };
  useEffect(() => {
    if (stageId == null) return;
    setLoading(true);
    setError(null);
    Promise.all([
      loadStage(),
      loadTasks(),
      loadStageBlockers(),
      loadDeliverables(),
      loadAcceptances(),
    ]).finally(() => setLoading(false));
  }, [routeProjectId, stageId]);
  useEffect(() => {
    if (stageId == null || loading) return;
    setError(null);
    void loadTasks();
  }, [filters, stageId, loading]);
  const loadStageBlockers = () => {
    if (stageId == null) return Promise.resolve();
    return apiClient
      .listStageBlockers(routeProjectId, stageId)
      .then(setStageBlockers)
      .catch(() => setStageBlockers([]));
  };
  const loadDeliverables = () => {
    if (stageId == null) return Promise.resolve();
    return apiClient
      .listStageDeliverables(routeProjectId, stageId)
      .then(setDeliverables)
      .catch(() => setDeliverables([]));
  };
  const loadAcceptances = () => {
    if (stageId == null) return Promise.resolve();
    return apiClient
      .listStageAcceptances(routeProjectId, stageId)
      .then(setAcceptances)
      .catch(() => setAcceptances([]));
  };
  const reloadAll = () =>
    Promise.all([
      loadStage(),
      loadTasks(),
      loadStageBlockers(),
      loadDeliverables(),
      loadAcceptances(),
    ]);

  const requiredTasks = tasks.filter((task) => task.acceptance_required);
  const incompleteRequiredTasks = requiredTasks.filter((task) => task.status !== 'done');
  const requiredDeliverables = deliverables.filter((item) => item.is_required);
  const missingRequiredDeliverables = requiredDeliverables.filter(
    (item) => !item.link && !item.text && !item.file_url,
  );
  const unresolvedBlockers = stageBlockers.filter((item) => !item.resolved_at);
  const pendingAcceptance = acceptances.find((item) => item.status === 'pending') || null;
  const canSubmitAcceptance =
    stage?.status === 'active' && (isOwner || stage.owner_id === currentUserId);
  const canReviewAcceptance = (item: StageAcceptance) =>
    isOwner && item.submitted_by !== currentUserId;

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
        showToast('任务已创建');
      } else if (modal.kind === 'edit') {
        await apiClient.updateStageTask(routeProjectId, modal.task.id, {
          title: String(form.get('title')).trim(),
          description: String(form.get('description') || '') || null,
          priority: String(form.get('priority')) as StageTaskPriority,
          assignee: String(form.get('assignee') || '') || null,
          planned_date: String(form.get('planned_date') || '') || null,
        });
        showToast('任务已更新');
      } else if (modal.kind === 'status') {
        await apiClient.updateStageTask(routeProjectId, modal.task.id, {
          status: String(form.get('status')) as StageTaskStatus,
          reason,
        });
        showToast('任务状态已更新');
      } else if (modal.kind === 'move') {
        await apiClient.moveStageTask(routeProjectId, modal.task.id, {
          target_stage_id: form.get('target_stage_id')
            ? Number(form.get('target_stage_id'))
            : null,
          reason,
        });
        showToast('任务已移动');
      }
      setModal(null);
      await loadTasks();
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };
  const runDelete = async (task: StageTask) => {
    setSaving(true);
    try {
      await apiClient.deleteStageTask(routeProjectId, task.id);
      showToast('任务已删除');
      setModal(null);
      await loadTasks();
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const saveDeliverable = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stageId == null || !deliverableModal || deliverableModal.kind === 'delete') return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const type = String(form.get('type')) as DeliverableType;
    const contentKind = String(form.get('content_kind')) as DeliverableContentKind;
    const text = String(form.get('text') || '') || null;
    const link = String(form.get('link') || '').trim() || null;
    const fileUrl = String(form.get('file_url') || '').trim() || null;
    const fileName = String(form.get('file_name') || '').trim() || null;
    if (link) {
      try {
        const url = new URL(link);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          showToast('外链必须是 http/https 地址');
          setSaving(false);
          return;
        }
      } catch {
        showToast('外链格式不正确，请填写完整的 http/https 地址');
        setSaving(false);
        return;
      }
    }
    const payload = {
      name,
      type,
      content_kind: contentKind,
      text: contentKind === 'text' ? text : null,
      link: contentKind === 'link' ? link : null,
      file_url: contentKind === 'file' ? fileUrl : null,
      file_name: contentKind === 'file' ? fileName : null,
    };
    try {
      if (deliverableModal.kind === 'create') {
        await apiClient.createStageDeliverable(routeProjectId, stageId, payload);
        showToast('交付物已提交');
      } else {
        await apiClient.updateStageDeliverable(
          routeProjectId,
          stageId,
          deliverableModal.item.id,
          payload,
        );
        showToast('交付物已更新');
      }
      setDeliverableModal(null);
      await loadDeliverables();
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteDeliverable = async (item: StageDeliverable) => {
    if (stageId == null) return;
    setSaving(true);
    try {
      await apiClient.deleteStageDeliverable(routeProjectId, stageId, item.id);
      showToast('交付物已删除');
      setDeliverableModal(null);
      await loadDeliverables();
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleDeliverableRequired = async (item: StageDeliverable) => {
    if (stageId == null) return;
    setSaving(true);
    try {
      if (item.is_required) {
        await apiClient.unmarkDeliverableRequired(routeProjectId, stageId, item.id);
        showToast('已取消验收必需');
      } else {
        await apiClient.markDeliverableRequired(routeProjectId, stageId, item.id);
        showToast('已设为验收必需');
      }
      await loadDeliverables();
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleTaskRequired = async (task: StageTask) => {
    if (stageId == null) return;
    setSaving(true);
    try {
      await apiClient.updateStageTask(routeProjectId, task.id, {
        acceptance_required: !task.acceptance_required,
      });
      showToast(task.acceptance_required ? '已取消验收必需' : '已设为验收必需');
      await loadTasks();
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const submitAcceptance = async (note?: string) => {
    if (stageId == null) return;
    setSaving(true);
    setBlockedDetail(null);
    try {
      await apiClient.submitStageAcceptance(routeProjectId, stageId, note || null);
      showToast('已提交验收，等待项目负责人确认');
      setAcceptanceModal(null);
      await reloadAll();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { detail?: unknown } | null) : null;
      const detail = body?.detail;
      if (
        detail &&
        typeof detail === 'object' &&
        !Array.isArray(detail) &&
        'incomplete_required_tasks' in detail
      ) {
        setBlockedDetail(detail as AcceptanceBlockerDetail);
      } else {
        showToast(errorText(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const reviewAcceptance = async (
    item: StageAcceptance,
    action: 'approve' | 'reject',
    note?: string,
    rejectionReason?: string,
  ) => {
    if (stageId == null) return;
    setSaving(true);
    try {
      await apiClient.reviewStageAcceptance(routeProjectId, stageId, item.id, {
        action,
        note: note || null,
        rejection_reason: action === 'reject' ? rejectionReason : null,
      });
      showToast(action === 'approve' ? '已确认验收，阶段已完成' : '已驳回验收，阶段回到进行中');
      setAcceptanceModal(null);
      await reloadAll();
    } catch (err) {
      showToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const reopenStage = async (reason: string) => {
    if (stageId == null) return;
    setSaving(true);
    try {
      await apiClient.reopenStage(routeProjectId, stageId, reason);
      showToast('阶段已重新打开');
      setAcceptanceModal(null);
      await reloadAll();
    } catch (err) {
      showToast(errorText(err));
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
            <button
              className="primary-btn"
              onClick={() => navigate(`/projects/${routeProjectId}/stages`)}
            >
              <Milestone size={15} /> 返回阶段列表
            </button>
          }
        />
      </>
    );
  if (loading) return <LoadingState />;
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
            <button
              className="primary-btn"
              onClick={() => navigate(`/projects/${routeProjectId}/stages`)}
            >
              <Milestone size={15} /> 返回阶段列表
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
            <StatusBadge kind="stage" status={stage.status} dot />
            {stage.status === 'active' && (
              <span className={`role-tag ${stage.is_primary ? 'owner' : ''}`}>
                {stage.is_primary ? '主阶段' : '并行阶段'}
              </span>
            )}
            {stage.status !== 'blocked' &&
              (isOwner || stage.owner_id === getUserId()) && (
                <button
                  className="ghost-btn danger"
                  onClick={() => setStageBlockerModal({ kind: 'create' })}
                >
                  <Flag size={15} /> 标记阶段阻塞
                </button>
              )}
            {stage.status === 'blocked' && (
              <button
                className="ghost-btn"
                onClick={() => setStageBlockerModal({ kind: 'resolve' })}
              >
                <Check size={15} /> 解除阶段阻塞
              </button>
            )}
            {writable && (
              <button className="primary-btn" onClick={() => setModal({ kind: 'create' })}>
                <Plus size={15} /> 新建任务
              </button>
            )}
          </>
        }
      />
      <div className="workbench-tabs" role="tablist">
        <button
          className={tab === 'tasks' ? 'active' : ''}
          onClick={() => setTab('tasks')}
        >
          任务列表
        </button>
        <button
          className={tab === 'deliverables' ? 'active' : ''}
          onClick={() => setTab('deliverables')}
        >
          交付物
        </button>
        <button
          className={tab === 'acceptance' ? 'active' : ''}
          onClick={() => setTab('acceptance')}
        >
          验收
        </button>
      </div>
      {tab === 'tasks' && (
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
            <b>
              {stage.planned_start || stage.planned_end
                ? `${formatDate(stage.planned_start)} - ${formatDate(stage.planned_end)}`
                : '未排期'}
            </b>
          </div>
        </div>
        {!writable && (
          <p className="permission-note">
            <Milestone size={14} /> 该阶段已完成，任务列表为只读状态。
          </p>
        )}
        <div className="toolbar">
          <input
            className="search-input"
            placeholder="搜索任务标题"
            value={filters.search}
            onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))}
          />
          <select
            value={filters.status}
            onChange={(event) => setFilters((f) => ({ ...f, status: event.target.value }))}
          >
            <option value="">全部状态</option>
            {Object.keys(stageTaskStatusLabel).map((key) => (
              <option key={key} value={key}>
                {stageTaskStatusLabel[key as StageTaskStatus]}
              </option>
            ))}
          </select>
          <select
            value={filters.priority}
            onChange={(event) => setFilters((f) => ({ ...f, priority: event.target.value }))}
          >
            <option value="">全部优先级</option>
            {Object.keys(stageTaskPriorityLabel).map((key) => (
              <option key={key} value={key}>
                {stageTaskPriorityLabel[key as StageTaskPriority]}
              </option>
            ))}
          </select>
          <select
            value={filters.assignee}
            onChange={(event) => setFilters((f) => ({ ...f, assignee: event.target.value }))}
          >
            <option value="">全部负责人</option>
            {assignees.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={filters.sort}
            onChange={(event) => setFilters((f) => ({ ...f, sort: event.target.value }))}
          >
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
                  <th>验收必需</th>
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
                      <PriorityBadge priority={task.priority} />
                    </td>
                    <td>{formatDate(task.planned_date)}</td>
                    <td>
                      {isOwner && writable ? (
                        <button
                          className={`required-toggle ${task.acceptance_required ? 'on' : ''}`}
                          title={
                            task.acceptance_required
                              ? '取消该任务的验收必需标记'
                              : '设为阶段验收必需任务'
                          }
                          onClick={() => void toggleTaskRequired(task)}
                        >
                          <Star size={13} fill={task.acceptance_required ? 'currentColor' : 'none'} />
                          {task.acceptance_required ? '必需' : '可选'}
                        </button>
                      ) : (
                        <span className={task.acceptance_required ? 'required-tag' : 'optional-tag'}>
                          {task.acceptance_required ? '必需' : '可选'}
                        </span>
                      )}
                    </td>
                    <td>
                      <StatusBadge kind="task" status={task.status} />
                    </td>
                    <td>
                      <div
                        style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}
                      >
                        <button
                          className="icon-btn"
                          title="依赖与阻塞"
                          onClick={() => setModal({ kind: 'detail', task })}
                        >
                          <GitBranch size={14} />
                        </button>
                        {writable && (
                          <>
                            <button
                              className="icon-btn"
                              title="编辑任务"
                              onClick={() => setModal({ kind: 'edit', task })}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="icon-btn"
                              title="变更状态"
                              onClick={() => setModal({ kind: 'status', task })}
                            >
                              <RefreshCw size={14} />
                            </button>
                            <button
                              className="icon-btn"
                              title="移动阶段"
                              onClick={() => setModal({ kind: 'move', task })}
                            >
                              <ArrowRight size={14} />
                            </button>
                            <button
                              className="icon-btn danger"
                              title="删除任务"
                              onClick={() => setModal({ kind: 'delete', task })}
                            >
                              <Trash2 size={14} />
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
          <EmptyState
            title="暂无任务"
            copy="该阶段下还没有任务，点击右上角新建任务开始。"
          />
        )}
        <button
          className="text-btn"
          onClick={() => navigate(`/projects/${routeProjectId}/stages`)}
        >
          返回阶段列表 <span>→</span>
        </button>
      </section>
      )}
      {tab === 'deliverables' && (
        <DeliverablesPanel
          stage={stage}
          deliverables={deliverables}
          memberName={memberName}
          isOwner={isOwner}
          saving={saving}
          onOpenCreate={() => setDeliverableModal({ kind: 'create' })}
          onOpenEdit={(item) => setDeliverableModal({ kind: 'edit', item })}
          onOpenDelete={(item) => setDeliverableModal({ kind: 'delete', item })}
          onToggleRequired={(item) => void toggleDeliverableRequired(item)}
        />
      )}
      {tab === 'acceptance' && (
        <AcceptancePanel
          stage={stage}
          tasks={tasks}
          deliverables={deliverables}
          acceptances={acceptances}
          blockers={unresolvedBlockers}
          memberName={memberName}
          isOwner={isOwner}
          currentUserId={currentUserId}
          canSubmit={canSubmitAcceptance}
          onSubmit={() => {
            setBlockedDetail(null);
            setAcceptanceModal({ kind: 'submit' });
          }}
          onReview={(item) => setAcceptanceModal({ kind: 'review', item })}
          onReopen={() => setAcceptanceModal({ kind: 'reopen' })}
        />
      )}
      {modal && modal.kind === 'detail' && (
        <TaskDetailModal
          task={modal.task}
          projectId={routeProjectId}
          tasks={tasks}
          members={members}
          isOwner={isOwner}
          onClose={() => setModal(null)}
          onToast={showToast}
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
          projectId={routeProjectId}
          stage={stage}
          members={members}
          onClose={() => setStageBlockerModal(null)}
          onSaved={async () => {
            setStageBlockerModal(null);
            await loadStage();
            await loadStageBlockers();
            showToast('已标记阶段阻塞');
          }}
          onToast={showToast}
        />
      )}
      {stageBlockerModal?.kind === 'resolve' && (
        <StageBlockerModal
          kind="resolve"
          projectId={routeProjectId}
          stage={stage}
          members={members}
          activeBlockerId={
            stageBlockers.find((item) => !item.resolved_at)?.id ?? null
          }
          onClose={() => setStageBlockerModal(null)}
          onSaved={async () => {
            setStageBlockerModal(null);
            await loadStage();
            await loadStageBlockers();
            showToast('已解除阶段阻塞');
          }}
          onToast={showToast}
        />
      )}
      {deliverableModal?.kind === 'delete' && (
        <DeliverableModal
          kind="delete"
          item={deliverableModal.item}
          saving={saving}
          onClose={() => setDeliverableModal(null)}
          onDelete={deleteDeliverable}
        />
      )}
      {deliverableModal && deliverableModal.kind !== 'delete' && (
        <DeliverableModal
          kind={deliverableModal.kind}
          item={deliverableModal.kind === 'create' ? null : deliverableModal.item}
          saving={saving}
          onClose={() => setDeliverableModal(null)}
          onFormSubmit={saveDeliverable}
        />
      )}
      {acceptanceModal?.kind === 'submit' && (
        <AcceptanceSubmitModal
          blockedDetail={blockedDetail}
          saving={saving}
          onClose={() => {
            setAcceptanceModal(null);
            setBlockedDetail(null);
          }}
          onSubmit={submitAcceptance}
        />
      )}
      {acceptanceModal?.kind === 'review' && (
        <AcceptanceReviewModal
          item={acceptanceModal.item}
          saving={saving}
          onClose={() => setAcceptanceModal(null)}
          onSubmit={reviewAcceptance}
        />
      )}
      {acceptanceModal?.kind === 'reopen' && (
        <ReopenStageModal
          saving={saving}
          onClose={() => setAcceptanceModal(null)}
          onSubmit={reopenStage}
        />
      )}
    </>
  );
}

export function StageTaskModal({
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
          {task?.acceptance_required ? (
            <p className="delete-guard-note">
              该任务是阶段验收必需项，请先在任务列表中取消「必需」标记后再删除。
            </p>
          ) : (
            <p>确定删除该任务吗？此操作不可撤销。</p>
          )}
          <div className="form-grid">
            <button className="ghost-btn" onClick={onClose}>
              取消
            </button>
            <button
              className="primary-btn danger"
              disabled={saving || Boolean(task?.acceptance_required)}
              onClick={() => task && onDelete(task)}
            >
              {saving ? '删除中…' : '确认删除'}
            </button>
          </div>
        </div>
      </Modal>
    );
  const statusOptions = task
    ? [task.status, ...stageTaskTransitions[task.status]]
    : (Object.keys(stageTaskStatusLabel) as StageTaskStatus[]);
  const moveTargets = stages.filter(
    (item) => item.id !== stage.id && item.status !== 'completed',
  );
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
              <textarea
                name="description"
                defaultValue={task?.description || ''}
                placeholder="补充信息（可选）"
              />
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
              <textarea
                name="reason"
                placeholder={stage.status === 'active' ? '移出进行中阶段需填写原因' : '可选'}
              />
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

export function TaskDetailModal({
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
  const memberName = (id: string) =>
    members.find((member) => member.id === id)?.name || id;

  const load = async () => {
    setLoading(true);
    try {
      const [deps, blks] = await Promise.all([
        apiClient.listTaskDependencies(projectId, task.id),
        apiClient.listTaskBlockers(projectId, task.id),
      ]);
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
  const candidates = tasks.filter(
    (item) => item.id !== task.id && !addedIds.has(item.id),
  );

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
  const removeDependency = (depId: number) =>
    void guard(
      () => apiClient.removeTaskDependency(projectId, task.id, depId),
      '已移除依赖',
    );
  const addDependency = () => {
    if (!newDepId) {
      onToast('请选择前置任务');
      return;
    }
    void guard(
      () =>
        apiClient.addTaskDependency(projectId, task.id, {
          dependency_id: Number(newDepId),
          created_by: currentUserId,
        }),
      '已添加依赖',
    );
    setNewDepId('');
  };
  const resolveBlocker = () => {
    if (!resolution.trim()) {
      onToast('解除阻塞时必须填写解决结果');
      return;
    }
    if (!activeBlocker) return;
    void guard(
      () =>
        apiClient.resolveTaskBlocker(projectId, task.id, activeBlocker.id, {
          resolution: resolution.trim(),
        }),
      '已解除阻塞',
    );
  };
  const markBlock = () => {
    if (!blockReason.trim() || !blockHandler) {
      onToast('标记阻塞时必须填写原因和处理人');
      return;
    }
    void guard(
      () =>
        apiClient.addTaskBlocker(projectId, task.id, {
          reason: blockReason.trim(),
          handler_id: blockHandler,
          created_by: currentUserId,
        }),
      '已标记阻塞',
    );
    setBlockReason('');
    setBlockHandler('');
  };
  const confirmContinue = () =>
    void guard(
      () => apiClient.confirmBlocker(projectId, task.id, { action: 'continue' }),
      '已确认继续',
    );
  const confirmReblock = () => {
    if (!reblockReason.trim() || !reblockHandler) {
      onToast('标记阻塞时必须填写原因和处理人');
      return;
    }
    void guard(
      () =>
        apiClient.confirmBlocker(projectId, task.id, {
          action: 'reblock',
          reason: reblockReason.trim(),
          handler_id: reblockHandler,
        }),
      '已标记新阻塞',
    );
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
                    <StatusBadge kind="task" status={dep.dependency.status} />
                  </div>
                  {isOwner && (
                    <button
                      className="icon-btn danger"
                      title="移除依赖"
                      disabled={busy}
                      onClick={() => removeDependency(dep.dependency_id)}
                    >
                      <Trash2 size={13} />
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
              <button
                className="primary-btn small"
                disabled={busy || !newDepId}
                onClick={addDependency}
              >
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
                      处理人：{memberName(blk.handler_id)} · 创建：
                      {blk.created_at.slice(0, 16).replace('T', ' ')}
                    </small>
                    {blk.resolved_at ? (
                      <small className="resolved">
                        已解除（{blk.resolved_at.slice(0, 16).replace('T', ' ')}）：
                        {blk.resolution || '—'}
                      </small>
                    ) : (
                      <small className="unresolved">未解除</small>
                    )}
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
                <textarea
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                  placeholder="填写解决结果后解除阻塞"
                />
              </label>
              <button
                className="primary-btn small"
                disabled={busy}
                onClick={resolveBlocker}
              >
                解除阻塞
              </button>
            </div>
          )}
        </section>

        {task.status === 'pending_verification' && isAssignee && (
          <section className="detail-section">
            <h3>确认阻塞已解除</h3>
            <div className="form-grid">
              <button
                className="primary-btn small"
                disabled={busy}
                onClick={confirmContinue}
              >
                确认继续
              </button>
              <button
                className="ghost-btn small"
                disabled={busy}
                onClick={() =>
                  setReblockHandler(reblockHandler || activeBlocker?.handler_id || '')
                }
              >
                标记新阻塞
              </button>
            </div>
            <div className="detail-form">
              <label>
                新阻塞原因
                <textarea
                  value={reblockReason}
                  onChange={(event) => setReblockReason(event.target.value)}
                  placeholder="标记新的阻塞原因"
                />
              </label>
              <label>
                处理人
                <select
                  value={reblockHandler}
                  onChange={(event) => setReblockHandler(event.target.value)}
                >
                  <option value="">选择处理人</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-btn small"
                disabled={busy || !reblockReason.trim() || !reblockHandler}
                onClick={confirmReblock}
              >
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
                <textarea
                  value={blockReason}
                  onChange={(event) => setBlockReason(event.target.value)}
                  placeholder="填写阻塞原因"
                />
              </label>
              <label>
                处理人
                <select
                  value={blockHandler}
                  onChange={(event) => setBlockHandler(event.target.value)}
                >
                  <option value="">选择处理人</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-btn small"
                disabled={busy || !blockReason.trim() || !blockHandler}
                onClick={markBlock}
              >
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

export function StageBlockerModal({
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
        await apiClient.addStageBlocker(projectId, stage.id, {
          reason: reason.trim(),
          handler_id: handler,
          created_by: getUserId(),
        });
      } else {
        if (!resolution.trim()) {
          onToast('解除阻塞时必须填写解决结果');
          return;
        }
        if (activeBlockerId == null) {
          onToast('未找到未解除的阶段阻塞记录');
          return;
        }
        await apiClient.resolveStageBlocker(projectId, stage.id, activeBlockerId, {
          resolution: resolution.trim(),
        });
      }
      onSaved();
    } catch (error) {
      onToast(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={
        kind === 'create'
          ? `标记阶段阻塞 · ${stage.name}`
          : `解除阶段阻塞 · ${stage.name}`
      }
      close={onClose}
    >
      <form className="form-stack" onSubmit={submit}>
        {kind === 'create' ? (
          <>
            <label>
              阻塞原因
              <textarea
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                placeholder="填写阶段阻塞原因"
              />
            </label>
            <label>
              处理人
              <select
                name="handler"
                value={handler}
                onChange={(event) => setHandler(event.target.value)}
                required
              >
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
            <textarea
              name="resolution"
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              required
              placeholder="填写解决结果后解除阶段阻塞"
            />
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

/** 交付物 Tab：列表 + 必需标记（owner 可配置，待验收后锁定）。 */
function DeliverablesPanel({
  stage,
  deliverables,
  memberName,
  isOwner,
  saving,
  onOpenCreate,
  onOpenEdit,
  onOpenDelete,
  onToggleRequired,
}: {
  stage: Stage;
  deliverables: StageDeliverable[];
  memberName: (id: string | null) => string;
  isOwner: boolean;
  saving: boolean;
  onOpenCreate: () => void;
  onOpenEdit: (item: StageDeliverable) => void;
  onOpenDelete: (item: StageDeliverable) => void;
  onToggleRequired: (item: StageDeliverable) => void;
}) {
  const writable = stage.status !== 'completed';
  return (
    <section className="panel stage-workbench">
      <div className="panel-head">
        <div>
          <h2>阶段交付物</h2>
          <p>成员可提交交付物；项目负责人可标记验收必需项。</p>
        </div>
        {writable ? (
          <button className="primary-btn" onClick={onOpenCreate}>
            <Plus size={15} /> 提交交付物
          </button>
        ) : (
          <button className="primary-btn" disabled title="已完成阶段不可提交交付物">
            <Plus size={15} /> 提交交付物
          </button>
        )}
      </div>
      {!writable && (
        <p className="permission-note">
          <Milestone size={14} /> 该阶段已完成，交付物列表为只读状态。
        </p>
      )}
      {deliverables.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>内容</th>
                <th>提交人</th>
                <th>提交时间</th>
                <th>必需</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deliverables.map((item) => (
                <tr key={item.id}>
                  <td className="task-title">{item.name}</td>
                  <td>{deliverableTypeLabel[item.type]}</td>
                  <td className="deliverable-content">
                    {item.link ? (
                      <a className="link" href={item.link} target="_blank" rel="noreferrer">
                        <LinkIcon /> 外部链接
                      </a>
                    ) : item.text ? (
                      <span title={item.text}>{item.text.slice(0, 32)}{item.text.length > 32 ? '…' : ''}</span>
                    ) : item.file_url ? (
                      <a className="link" href={item.file_url} target="_blank" rel="noreferrer">
                        <FileText size={13} /> {item.file_name || '文件记录'}
                      </a>
                    ) : (
                      <span className="optional-tag">未填写内容</span>
                    )}
                  </td>
                  <td>{memberName(item.submitted_by)}</td>
                  <td>{formatDateTime(item.submitted_at)}</td>
                  <td>
                    {isOwner && writable ? (
                      <button
                        className={`required-toggle ${item.is_required ? 'on' : ''}`}
                        title={item.is_required ? '取消验收必需' : '设为验收必需'}
                        disabled={saving}
                        onClick={() => onToggleRequired(item)}
                      >
                        <Star size={13} fill={item.is_required ? 'currentColor' : 'none'} />
                        {item.is_required ? '必需' : '可选'}
                      </button>
                    ) : (
                      <span className={item.is_required ? 'required-tag' : 'optional-tag'}>
                        {item.is_required ? '必需' : '可选'}
                      </span>
                    )}
                  </td>
                  <td>
                    {writable && (
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          className="icon-btn"
                          title="编辑交付物"
                          onClick={() => onOpenEdit(item)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title="删除交付物"
                          onClick={() => onOpenDelete(item)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="暂无交付物" copy="点击「提交交付物」记录文本说明、外部链接或文件记录。" />
      )}
    </section>
  );
}

function LinkIcon() {
  return <span style={{ display: 'inline-flex' }}>↗</span>;
}

/** 验收 Tab：条件汇总 + 提交/确认/驳回/重新打开 + 验收记录时间线。 */
function AcceptancePanel({
  stage,
  tasks,
  deliverables,
  acceptances,
  blockers,
  memberName,
  isOwner,
  currentUserId,
  canSubmit,
  onSubmit,
  onReview,
  onReopen,
}: {
  stage: Stage;
  tasks: StageTask[];
  deliverables: StageDeliverable[];
  acceptances: StageAcceptance[];
  blockers: StageBlocker[];
  memberName: (id: string | null) => string;
  isOwner: boolean;
  currentUserId: string;
  canSubmit: boolean;
  onSubmit: () => void;
  onReview: (item: StageAcceptance) => void;
  onReopen: () => void;
}) {
  const requiredTasks = tasks.filter((task) => task.acceptance_required);
  const incompleteRequiredTasks = requiredTasks.filter((task) => task.status !== 'done');
  const requiredDeliverables = deliverables.filter((item) => item.is_required);
  const missingRequiredDeliverables = requiredDeliverables.filter(
    (item) => !item.link && !item.text && !item.file_url,
  );
  const pendingAcceptance = acceptances.find((item) => item.status === 'pending') || null;
  const selfSubmitted = pendingAcceptance ? pendingAcceptance.submitted_by === currentUserId : false;
  const reviewerAvailable = isOwner && pendingAcceptance && !selfSubmitted;

  return (
    <section className="panel stage-workbench">
      <div className="acceptance-conditions">
        <div className="condition-card">
          <b>{requiredTasks.length}</b>
          <span>必需任务</span>
          {incompleteRequiredTasks.length > 0 && (
            <small className="condition-warn">未完成 {incompleteRequiredTasks.length} 个</small>
          )}
        </div>
        <div className="condition-card">
          <b>{requiredDeliverables.length}</b>
          <span>必需交付物</span>
          {missingRequiredDeliverables.length > 0 && (
            <small className="condition-warn">未提交 {missingRequiredDeliverables.length} 个</small>
          )}
        </div>
        <div className="condition-card">
          <b>{blockers.length}</b>
          <span>未解除阶段阻塞</span>
          {blockers.length > 0 && <small className="condition-warn">需先解除</small>}
        </div>
      </div>

      {stage.status === 'pending_acceptance' && pendingAcceptance ? (
        <div className="acceptance-review-card">
          <div className="panel-head">
            <div>
              <h2>待处理验收</h2>
              <p>
                {memberName(pendingAcceptance.submitted_by)} 于{' '}
                {formatDateTime(pendingAcceptance.submitted_at)} 提交
                {pendingAcceptance.note ? `：${pendingAcceptance.note}` : ''}
              </p>
            </div>
            <StatusBadge kind="stage" status="pending_acceptance" />
          </div>
          {reviewerAvailable ? (
            <div className="form-grid review-actions">
              <button
                className="primary-btn"
                onClick={() => onReview(pendingAcceptance)}
              >
                <CheckCircle2 size={15} /> 确认验收
              </button>
              <button
                className="ghost-btn danger"
                onClick={() => onReview(pendingAcceptance)}
              >
                <XCircle size={15} /> 驳回验收
              </button>
            </div>
          ) : (
            <p className="permission-note">
              {selfSubmitted
                ? '不能验收自己提交的阶段，请等待其他项目负责人处理。'
                : '等待项目负责人确认或驳回。'}
            </p>
          )}
        </div>
      ) : stage.status === 'active' ? (
        <div className="acceptance-action-row">
          <div>
            <b>提交阶段验收</b>
            <p>满足全部验收条件后进入「待验收」，由项目负责人确认或驳回。</p>
          </div>
          {canSubmit ? (
            <button className="primary-btn" onClick={onSubmit}>
              <Check size={15} /> 提交验收
            </button>
          ) : (
            <button className="primary-btn" disabled title="仅阶段负责人或项目负责人可提交验收">
              <Check size={15} /> 提交验收
            </button>
          )}
        </div>
      ) : stage.status === 'blocked' ? (
        <div className="acceptance-action-row">
          <div>
            <b>阶段处于受阻状态</b>
            <p>请先解除全部阶段阻塞后再提交验收。</p>
          </div>
          <button className="primary-btn" disabled title="存在未解除的阶段阻塞">
            <Check size={15} /> 提交验收
          </button>
        </div>
      ) : stage.status === 'planned' ? (
        <div className="acceptance-action-row">
          <div>
            <b>阶段尚未开始</b>
            <p>启动阶段并完成任务后再提交验收。</p>
          </div>
          <button className="primary-btn" disabled title="阶段未开始">
            <Check size={15} /> 提交验收
          </button>
        </div>
      ) : (
        <div className="acceptance-action-row">
          <div>
            <b>阶段已完成（只读）</b>
            <p>验收记录保留完整；如需继续推进，项目负责人可重新打开阶段。</p>
          </div>
          {isOwner ? (
            <button className="ghost-btn" onClick={onReopen}>
              <RotateCcw size={15} /> 重新打开
            </button>
          ) : (
            <button className="ghost-btn" disabled title="仅项目负责人可重新打开阶段">
              <RotateCcw size={15} /> 重新打开
            </button>
          )}
        </div>
      )}

      {blockers.length > 0 && (
        <div className="acceptance-blockers">
          <h3>未解除的阶段阻塞</h3>
          {blockers.map((blocker) => (
            <p key={blocker.id} className="permission-note">
              <Flag size={14} /> {blocker.reason}（处理人：{memberName(blocker.handler_id)}）
            </p>
          ))}
        </div>
      )}

      <div className="acceptance-history">
        <h3>验收记录</h3>
        {acceptances.length ? (
          <div className="acceptance-timeline">
            {acceptances.map((item) => (
              <div className="acceptance-record" key={item.id}>
                <span
                  className={`acceptance-status ${
                    item.status === 'approved'
                      ? 'ok'
                      : item.status === 'rejected'
                        ? 'bad'
                        : 'pending'
                  }`}
                >
                  {item.status === 'approved'
                    ? '已确认'
                    : item.status === 'rejected'
                      ? '已驳回'
                      : '待处理'}
                </span>
                <div className="acceptance-record-body">
                  <p>
                    提交人：<b>{memberName(item.submitted_by)}</b>（
                    {formatDateTime(item.submitted_at)}）
                  </p>
                  {item.reviewed_by ? (
                    <p>
                      验收人：<b>{memberName(item.reviewed_by)}</b>（
                      {formatDateTime(item.reviewed_at)}）
                    </p>
                  ) : null}
                  {item.status === 'approved' && item.note ? (
                    <p className="acceptance-note">备注：{item.note}</p>
                  ) : null}
                  {item.status === 'rejected' && item.rejection_reason ? (
                    <p className="acceptance-note">驳回原因：{item.rejection_reason}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="permission-note">该阶段还没有验收记录。</p>
        )}
      </div>
    </section>
  );
}

/** 交付物提交/编辑/删除弹窗。 */
function DeliverableModal({
  kind,
  item,
  saving,
  onClose,
  onFormSubmit,
  onDelete,
}: {
  kind: 'create' | 'edit' | 'delete';
  item: StageDeliverable | null;
  saving: boolean;
  onClose: () => void;
  onFormSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  onDelete?: (item: StageDeliverable) => void;
}) {
  const [contentKind, setContentKind] = useState<DeliverableContentKind>(
    item?.content_kind || 'link',
  );
  if (kind === 'delete' && item && onDelete)
    return (
      <Modal title={`删除「${item.name}」`} close={onClose}>
        <div className="form-stack">
          <p>
            确定删除该交付物吗？
            {item.is_required && ' 它是验收必需项，删除后不再计入验收条件。'}
          </p>
          <div className="form-grid">
            <button className="ghost-btn" onClick={onClose}>
              取消
            </button>
            <button className="primary-btn danger" disabled={saving} onClick={() => onDelete(item)}>
              {saving ? '删除中…' : '确认删除'}
            </button>
          </div>
        </div>
      </Modal>
    );
  return (
    <Modal title={kind === 'create' ? '提交交付物' : `编辑「${item?.name}」`} close={onClose}>
      <form className="form-stack" onSubmit={onFormSubmit}>
        <label>
          名称
          <input name="name" defaultValue={item?.name || ''} required placeholder="如：架构设计文档" />
        </label>
        <label>
          类型
          <select name="type" defaultValue={item?.type || 'document'}>
            {Object.entries(deliverableTypeLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          内容形式
          <select
            name="content_kind"
            value={contentKind}
            onChange={(event) => setContentKind(event.target.value as DeliverableContentKind)}
          >
            <option value="link">外部链接</option>
            <option value="text">文本说明</option>
            <option value="file">文件记录（外链）</option>
          </select>
        </label>
        {contentKind === 'text' && (
          <label>
            文本说明
            <textarea
              name="text"
              defaultValue={item?.text || ''}
              placeholder="简要描述交付内容"
            />
          </label>
        )}
        {contentKind === 'link' && (
          <label>
            外部链接
            <input
              name="link"
              type="url"
              defaultValue={item?.link || ''}
              placeholder="https://…（仅 http/https）"
            />
          </label>
        )}
        {contentKind === 'file' && (
          <>
            <label>
              文件外链
              <input
                name="file_url"
                type="url"
                defaultValue={item?.file_url || ''}
                placeholder="https://…（首版只记录外链）"
              />
            </label>
            <label>
              文件名
              <input name="file_name" defaultValue={item?.file_name || ''} placeholder="可选" />
            </label>
          </>
        )}
        <div className="form-grid">
          <button type="button" className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-btn" disabled={saving}>
            {saving ? '保存中…' : kind === 'create' ? '提交交付物' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 提交阶段验收弹窗：被阻止时展示三类明细。 */
function AcceptanceSubmitModal({
  blockedDetail,
  saving,
  onClose,
  onSubmit,
}: {
  blockedDetail: AcceptanceBlockerDetail | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (note?: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Modal title="提交阶段验收" close={onClose}>
      <div className="form-stack">
        {blockedDetail ? (
          <div className="acceptance-blocked">
            <p className="delete-guard-note">验收条件未满足，无法提交：</p>
            {blockedDetail.incomplete_required_tasks.length > 0 && (
              <div>
                <b>未完成必需任务</b>
                <ul>
                  {blockedDetail.incomplete_required_tasks.map((task) => (
                    <li key={task.id}>✗ {task.title}</li>
                  ))}
                </ul>
              </div>
            )}
            {blockedDetail.missing_required_deliverables.length > 0 && (
              <div>
                <b>未提交必需交付物</b>
                <ul>
                  {blockedDetail.missing_required_deliverables.map((item) => (
                    <li key={item.id}>✗ {item.name}</li>
                  ))}
                </ul>
              </div>
            )}
            {blockedDetail.unresolved_stage_blockers.length > 0 && (
              <div>
                <b>未解除阶段阻塞</b>
                <ul>
                  {blockedDetail.unresolved_stage_blockers.map((item) => (
                    <li key={item.id}>✗ {item.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <label>
            备注（可选）
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充说明" />
          </label>
        )}
        <div className="form-grid">
          <button className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-btn"
            disabled={saving || Boolean(blockedDetail)}
            onClick={() => onSubmit(note)}
          >
            {saving ? '提交中…' : '提交验收'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 确认/驳回验收弹窗：驳回必须填写原因。 */
function AcceptanceReviewModal({
  item,
  saving,
  onClose,
  onSubmit,
}: {
  item: StageAcceptance;
  saving: boolean;
  onClose: () => void;
  onSubmit: (item: StageAcceptance, action: 'approve' | 'reject', note?: string, reason?: string) => void;
}) {
  const [action, setAction] = useState<'approve' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Modal title="处理阶段验收" close={onClose}>
      <div className="form-stack">
        <label>
          处理结果
          <select
            value={action}
            onChange={(event) => setAction(event.target.value as 'approve' | 'reject')}
          >
            <option value="approve">确认验收（阶段完成）</option>
            <option value="reject">驳回验收（阶段回到进行中）</option>
          </select>
        </label>
        <label>
          备注（可选）
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充说明" />
        </label>
        {action === 'reject' && (
          <label>
            驳回原因（必填）
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="说明驳回原因"
            />
          </label>
        )}
        <div className="form-grid">
          <button className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button
            className={`primary-btn ${action === 'reject' ? 'danger' : ''}`}
            disabled={saving || (action === 'reject' && !reason.trim())}
            onClick={() => onSubmit(item, action, note, reason)}
          >
            {saving ? '处理中…' : action === 'approve' ? '确认验收' : '驳回验收'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 重新打开已完成阶段：原因必填。 */
function ReopenStageModal({
  saving,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="重新打开阶段" close={onClose}>
      <div className="form-stack">
        <p>重新打开后阶段回到「进行中」，原验收记录将保留。</p>
        <label>
          重新打开原因（必填）
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="说明重新打开的原因"
          />
        </label>
        <div className="form-grid">
          <button className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-btn danger"
            disabled={saving || !reason.trim()}
            onClick={() => onSubmit(reason)}
          >
            {saving ? '处理中…' : '确认重新打开'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
