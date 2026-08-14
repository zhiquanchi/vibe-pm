import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from '@umijs/max';
import { DotChartOutlined, CalendarOutlined, DownOutlined, ReloadOutlined } from '@ant-design/icons';
import { PageHeader, EmptyState, Metric, Modal } from '@/components/common';
import Board from '@/components/Board';
import BurnupChart from '@/components/BurnupChart';
import ScopeTimeline from '@/components/ScopeTimeline';
import { useSprintWorkspace } from '@/hooks';
import { apiClient } from '@/services/api';
import { statusLabel, formatRange, errorText, sprintPath } from '@/utils/format';
import { useAppContext } from '@/layouts/MainLayout';
import type { ScopeChange, Sprint, SprintStatus, Task, TaskCreateInput, TaskStatus } from '@/types';

const taskStatusWeight: Record<TaskStatus, number> = { todo: 0, in_progress: 0.5, in_review: 0.8, done: 1 };

export default function WorkspacePage() {
  const ctx = useAppContext();
  const { projectId: pid, sprintId } = useParams();
  const projectId = Number(pid) || ctx.projectId;
  const navigate = useNavigate();

  const sprint = ctx.sprints.find((s) => s.id === Number(sprintId)) ?? null;
  const onRefresh = ctx.onRefresh;
  const onToast = ctx.onToast;
  const onNotice = ctx.onNotice;

  const workspace = useSprintWorkspace(Number(sprintId));
  const [selectedChange, setSelectedChange] = useState<ScopeChange | null>(null);
  const [statusModal, setStatusModal] = useState<SprintStatus | null>(null);
  const [dateModal, setDateModal] = useState(false);
  const [changeReason, setChangeReason] = useState('');

  const total = sprint?.initial_points || workspace.tasks.reduce((sum, task) => sum + task.story_points, 0);
  const completed = workspace.tasks.reduce((sum, task) => sum + task.story_points * taskStatusWeight[task.status], 0);
  const currentScope =
    workspace.snapshots[workspace.snapshots.length - 1]?.total_scope ??
    workspace.tasks.reduce((sum, task) => sum + task.story_points, 0);
  const displayChanges = workspace.scopeChanges;

  if (!sprint) {
    return (
      <>
        <PageHeader eyebrow="迭代工作台" title="迭代工作台" copy="当前没有可进入的进行中迭代。" />
        <EmptyState
          title="请先新建或开始迭代"
          copy="从迭代列表新建一个规划中的迭代，再开始本次迭代。"
          action={
            <button className="primary-btn" onClick={() => navigate(`/projects/${projectId}/sprints`)}>
              <DotChartOutlined style={{ fontSize: 15 }} /> 打开迭代列表
            </button>
          }
        />
      </>
    );
  }

  const runStatus = async () => {
    if (!statusModal) return;
    try {
      await workspace.updateSprint(statusModal);
      await workspace.refresh();
      await onRefresh();
      onToast(statusModal === 'active' ? '迭代已开始' : '迭代已结束');
      setStatusModal(null);
    } catch (error) {
      onToast(errorText(error));
    }
  };

  const createTask = async (input: TaskCreateInput) => {
    try {
      const task = await workspace.createTask({ ...input, project_id: projectId, sprint_id: Number(sprintId) });
      if (sprint.status === 'active') {
        const change = await workspace.createScopeChange({
          type: 'add_task',
          title: input.title,
          description: `新增「${input.title}」`,
          story_points: input.story_points,
          points_delta: input.story_points,
          reason: input.reason || '迭代执行中新增',
        });
        onNotice(change, sprint.id);
      }
      await workspace.refresh();
      onToast('任务已创建');
      return task;
    } catch (error) {
      onToast(errorText(error));
      throw error;
    }
  };

  const removeTask = async (task: Task) => {
    const reason = window.prompt('请输入移出迭代的原因');
    if (!reason?.trim()) return;
    try {
      await apiClient.removeTaskFromSprint(sprint.id, task.id);
      if (sprint.status === 'active') {
        const change = await workspace.createScopeChange({
          type: 'remove_task',
          task_id: task.id,
          description: `移出「${task.title}」`,
          points_delta: -task.story_points,
          reason,
        });
        onNotice(change, sprint.id);
      }
      await workspace.refresh();
      onToast('任务已移出迭代');
    } catch (error) {
      onToast(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={`${sprint.name} · ${statusLabel[sprint.status]}`}
        title={sprint.goal || '聚焦当前迭代目标'}
        copy="范围变化可追溯，进度状态可解释。"
        actions={
          <>
            <button
              className="ghost-btn"
              onClick={() =>
                sprint.status === 'planning' ? setDateModal(true) : onToast(`${statusLabel[sprint.status]}迭代日期只读`)
              }
            >
              <CalendarOutlined style={{ fontSize: 15 }} /> {formatRange(sprint)} <DownOutlined style={{ fontSize: 14 }} />
            </button>
            {sprint.status !== 'completed' && (
              <button
                className="primary-btn"
                disabled={workspace.mutationLoading}
                onClick={() => setStatusModal(sprint.status === 'planning' ? 'active' : 'completed')}
              >
                {workspace.mutationLoading ? '处理中…' : sprint.status === 'planning' ? '开始迭代' : '结束迭代'}
              </button>
            )}
          </>
        }
      />
      {workspace.error && (
        <div className="alert error-state">
          {workspace.error}
          <button className="icon-btn" title="重试" onClick={() => void workspace.refresh()}>
            <ReloadOutlined style={{ fontSize: 14 }} />
          </button>
        </div>
      )}
      <section className="metrics">
        <Metric label="范围" value={`${currentScope} pt`} note={`初始 ${total} pt`} tone="blue" />
        <Metric
          label="已完成"
          value={`${completed.toFixed(1)} pt`}
          note={`${currentScope ? Math.round((completed / currentScope) * 100) : 0}% 的范围`}
          tone="green"
        />
        <Metric
          label="剩余"
          value={`${Math.max(0, currentScope - completed).toFixed(1)} pt`}
          note="按当前状态计算"
          tone="orange"
        />
        <Metric
          label="范围变更"
          value={`${displayChanges.length} 次`}
          note={`${displayChanges.reduce((sum, item) => sum + item.points_delta, 0) >= 0 ? '+' : ''}${displayChanges.reduce(
            (sum, item) => sum + item.points_delta,
            0,
          )} pt`}
          tone="purple"
        />
      </section>
      <section className="grid-main">
        <div className="chart-card panel">
          <BurnupChart
            snapshots={workspace.snapshots}
            scopeChanges={displayChanges}
            initialPoints={sprint.initial_points}
            onSelectChange={setSelectedChange}
          />
        </div>
        <ScopeTimeline
          changes={displayChanges}
          capacityWarning={
            currentScope > total * 1.2 ? `范围已增加 ${(currentScope - total).toFixed(0)} pt，当前容量可能不足` : null
          }
          onAddTask={() => onToast('请使用看板中的“新建任务”添加需求')}
          onSelectChange={setSelectedChange}
        />
      </section>
      <Board
        tasks={workspace.tasks}
        projectId={projectId}
        sprintId={sprint.id}
        disabled={sprint.status === 'completed'}
        onRemoveTask={removeTask}
        onCreateTask={createTask}
        onStatusChange={async (task, status) => {
          await workspace.updateTask(task.id, { status });
          await workspace.refresh();
          onToast('任务状态已更新');
        }}
        onEditTask={async (task, input) => {
          await workspace.updateTask(task.id, input);
          await workspace.refresh();
          onToast('任务已更新');
        }}
        onDeleteTask={async (task) => {
          if (!window.confirm(`确定删除任务“${task.title}”吗？删除后无法恢复。`)) return;
          await workspace.deleteTask(task.id, '用户确认删除');
          await workspace.refresh();
          onToast('任务已删除');
        }}
      />
      {statusModal && (
        <Modal title={statusModal === 'active' ? '开始迭代' : '结束迭代'} close={() => setStatusModal(null)}>
          <div className="confirm-copy">
            <b>{statusModal === 'active' ? '确认开始这次迭代？' : '确认结束这次迭代？'}</b>
            <p>
              {statusModal === 'active'
                ? `初始范围 ${workspace.tasks.reduce((sum, task) => sum + task.story_points, 0)} pt，共 ${workspace.tasks.length} 个任务。`
                : `当前完成率 ${currentScope ? Math.round((completed / currentScope) * 100) : 0}%，${workspace.tasks.filter(
                    (task) => task.status !== 'done',
                  ).length} 个未完成任务将回到 Backlog。`}
            </p>
          </div>
          <button className="primary-btn full" onClick={() => void runStatus()} disabled={workspace.mutationLoading}>
            {workspace.mutationLoading ? '处理中…' : '确认'}
          </button>
        </Modal>
      )}
      {dateModal && (
        <Modal title="编辑迭代日期" close={() => setDateModal(false)}>
          <DateEditor sprint={sprint} onClose={() => setDateModal(false)} onToast={onToast} onRefresh={onRefresh} />
        </Modal>
      )}
      {selectedChange && (
        <Modal title="范围变更详情" close={() => setSelectedChange(null)}>
          <div className="change-detail">
            <h2>{selectedChange.description}</h2>
            <p>{selectedChange.reason || '未填写原因'}</p>
            <div>
              <span>点数变化</span>
              <b>
                {selectedChange.points_delta > 0 ? '+' : ''}
                {selectedChange.points_delta} pt
              </b>
            </div>
            <div>
              <span>操作人</span>
              <b>{selectedChange.created_by || '未知'}</b>
            </div>
            {selectedChange.task_id ? (
              <button className="text-btn" onClick={() => navigate(sprintPath(projectId, sprint.id))}>
                查看任务
              </button>
            ) : (
              <span className="disabled-note">该变更没有关联任务</span>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function DateEditor({
  sprint,
  onClose,
  onToast,
  onRefresh,
}: {
  sprint: Sprint;
  onClose: () => void;
  onToast: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await apiClient.updateSprintDates(
        sprint.id,
        String(form.get('start_date')),
        String(form.get('end_date')),
      );
      await onRefresh();
      onToast('迭代日期已更新');
      onClose();
    } catch (error) {
      onToast(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="form-stack" onSubmit={submit}>
      <div className="form-grid">
        <label>
          开始日期<input name="start_date" type="date" defaultValue={sprint.start_date.slice(0, 10)} required />
        </label>
        <label>
          结束日期<input name="end_date" type="date" defaultValue={sprint.end_date.slice(0, 10)} required />
        </label>
      </div>
      <button className="primary-btn full" disabled={saving}>
        {saving ? '保存中…' : '保存日期'}
      </button>
    </form>
  );
}
