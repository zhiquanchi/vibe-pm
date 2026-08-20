import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { apiClient } from '../api';
import { errorText, formatDate } from '../lib/format';
import { stageTaskPriorityLabel, stageTaskStatusLabel } from '../lib/labels';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/States';
import { PriorityBadge, StatusBadge } from '../components/shared/StatusBadge';
import type { CopilotTaskAdvice, MyTask, StageTaskPriority, StageTaskStatus } from '../types';

/** 我的任务页（全局，跨项目）：/my-tasks */
export function MyTasksView() {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [advice, setAdvice] = useState<CopilotTaskAdvice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{
    project: string;
    stage: string;
    status: string;
    priority: string;
    sort: string;
  }>({ project: '', stage: '', status: '', priority: '', sort: 'planned_date' });
  const load = () => {
    setLoading(true);
    setError(null);
    const params: {
      project_id?: number;
      stage_id?: number;
      status?: string;
      priority?: string;
      sort?: string;
    } = { sort: filters.sort };
    if (filters.project) params.project_id = Number(filters.project);
    if (filters.stage) params.stage_id = Number(filters.stage);
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    apiClient
      .listMyTasks(params)
      .then(setTasks)
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    void load();
  }, [filters]);
  useEffect(() => {
    apiClient
      .myTaskAdvice()
      .then(setAdvice)
      .catch(() => setAdvice([]));
  }, []);
  const projects = [
    ...new Map(
      tasks.map((task) => [
        task.project_id,
        { id: task.project_id, name: task.project_name },
      ]),
    ).values(),
  ];
  const stages = [
    ...new Map(
      tasks
        .filter((task) => task.stage_id != null)
        .map((task) => [
          task.stage_id as number,
          { id: task.stage_id as number, name: task.stage_name || '未命名' },
        ]),
    ).values(),
  ];
  return (
    <>
      <PageHeader
        eyebrow="MY TASKS"
        title="我的任务"
        copy="跨项目查看指派给你的进行中任务。"
        actions={
          <button className="primary-btn" onClick={() => void load()}>
            <RefreshCw size={15} /> 刷新
          </button>
        }
      />
      {advice && advice.length > 0 && (
        <section className="panel advice-card">
          <div className="panel-head">
            <div>
              <h2>
                <Sparkles size={15} /> 个人行动建议
              </h2>
              <p>{'按 受阻 > 逾期 > 主阶段 > 依赖 > 临近验收 排序。'}</p>
            </div>
          </div>
          <ol className="advice-list">
            {advice.map((item) => (
              <li key={`${item.project_id}-${item.task_id}`}>
                <div>
                  <b>{item.task_title}</b>
                  <small>
                    {item.project_name}
                    {item.stage_name ? ` · ${item.stage_name}` : ''}
                  </small>
                  <p>{item.reason}</p>
                </div>
                <a className="link" href={item.link_path}>
                  查看 →
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="panel stage-workbench">
        <div className="toolbar">
          <select
            value={filters.project}
            onChange={(event) => setFilters((f) => ({ ...f, project: event.target.value }))}
          >
            <option value="">全部项目</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            value={filters.stage}
            onChange={(event) => setFilters((f) => ({ ...f, stage: event.target.value }))}
          >
            <option value="">全部阶段</option>
            {stages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
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
            value={filters.sort}
            onChange={(event) => setFilters((f) => ({ ...f, sort: event.target.value }))}
          >
            <option value="planned_date">计划日期 ↑</option>
            <option value="-planned_date">计划日期 ↓</option>
            <option value="created_at">创建时间 ↑</option>
            <option value="-created_at">创建时间 ↓</option>
            <option value="priority">优先级 ↑</option>
            <option value="-priority">优先级 ↓</option>
          </select>
        </div>
        {error ? (
          <ErrorState message={error} retry={load} />
        ) : loading ? (
          <LoadingState />
        ) : !tasks.length ? (
          <EmptyState title="暂无任务" copy="没有指派给你的进行中任务。" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>阶段</th>
                  <th>标题</th>
                  <th>优先级</th>
                  <th>计划日期</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <a
                        className="link"
                        href={`/projects/${task.project_id}/stages/${task.stage_id ?? ''}`}
                      >
                        {task.project_name}
                      </a>
                    </td>
                    <td>
                      {task.stage_id ? (
                        <a
                          className="link"
                          href={`/projects/${task.project_id}/stages/${task.stage_id}`}
                        >
                          {task.stage_name || '未命名'}
                        </a>
                      ) : (
                        '未规划'
                      )}
                    </td>
                    <td className="task-title">
                      {task.title}
                      {task.overdue && <span className="flag-overdue">逾期</span>}
                      {task.status === 'pending_verification' && (
                        <span className="flag-pending">待确认</span>
                      )}
                      {task.blocked && <span className="flag-blocked">受阻</span>}
                    </td>
                    <td>
                      <PriorityBadge priority={task.priority} />
                    </td>
                    <td>{formatDate(task.planned_date)}</td>
                    <td>
                      <StatusBadge kind="task" status={task.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
