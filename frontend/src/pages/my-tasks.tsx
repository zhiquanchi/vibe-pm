import { useEffect, useState } from 'react';
import { useNavigate } from '@umijs/max';
import { ReloadOutlined } from '@ant-design/icons';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { errorText, formatDate } from '@/utils/format';
import { apiClient } from '@/services/api';
import { useAppContext } from '@/layouts/MainLayout';
import type { MyTask, StageTaskPriority, StageTaskStatus } from '@/types';

const stageTaskStatusLabel: Record<StageTaskStatus, string> = { todo: '未开始', in_progress: '进行中', blocked: '受阻', pending_verification: '待验收', done: '已完成' };
const stageTaskPriorityLabel: Record<StageTaskPriority, string> = { urgent: '紧急', important: '重要', normal: '正常', low: '低' };

export default function MyTasksPage() {
  const ctx = useAppContext();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ project: string; stage: string; status: string; priority: string; sort: string }>({
    project: '',
    stage: '',
    status: '',
    priority: '',
    sort: 'planned_date',
  });
  const load = () => {
    setLoading(true);
    setError(null);
    // 路由 /my-tasks 无 projectId，始终以当前项目 ctx.projectId 作为 project_id 查询
    const params: { project_id: number; stage_id?: number; status?: string; priority?: string; sort?: string } = {
      project_id: ctx.projectId,
      sort: filters.sort,
    };
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
  }, [filters, ctx.projectId]);

  const projects = [...new Map(tasks.map((task) => [task.project_id, { id: task.project_id, name: task.project_name }])).values()];
  const stages = [
    ...new Map(
      tasks
        .filter((task) => task.stage_id != null)
        .map((task) => [task.stage_id as number, { id: task.stage_id as number, name: task.stage_name || '未命名' }]),
    ).values(),
  ];
  const visibleTasks = filters.project ? tasks.filter((task) => String(task.project_id) === filters.project) : tasks;
  return (
    <>
      <PageHeader
        eyebrow="MY TASKS"
        title="我的任务"
        copy="跨项目查看指派给你的进行中任务。"
        actions={
          <button className="primary-btn" onClick={() => void load()}>
            <ReloadOutlined style={{ fontSize: 15 }} /> 刷新
          </button>
        }
      />
      <section className="panel stage-workbench">
        <div className="toolbar">
          <select value={filters.project} onChange={(event) => setFilters((f) => ({ ...f, project: event.target.value }))}>
            <option value="">全部项目</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select value={filters.stage} onChange={(event) => setFilters((f) => ({ ...f, stage: event.target.value }))}>
            <option value="">全部阶段</option>
            {stages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
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
          <select value={filters.sort} onChange={(event) => setFilters((f) => ({ ...f, sort: event.target.value }))}>
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
          <div className="state-panel">
            <ReloadOutlined className="spin" style={{ fontSize: 20 }} />
            <b>正在加载项目数据…</b>
          </div>
        ) : !visibleTasks.length ? (
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
                {visibleTasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <a
                        className="link"
                        href={`/projects/${task.project_id}/stages/${task.stage_id ?? ''}`}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(`/projects/${task.project_id}/stages/${task.stage_id ?? ''}`);
                        }}
                      >
                        {task.project_name}
                      </a>
                    </td>
                    <td>
                      {task.stage_id ? (
                        <a
                          className="link"
                          href={`/projects/${task.project_id}/stages/${task.stage_id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            navigate(`/projects/${task.project_id}/stages/${task.stage_id}`);
                          }}
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
                      {task.status === 'pending_verification' && <span className="flag-pending">待确认</span>}
                      {task.blocked && <span className="flag-blocked">受阻</span>}
                    </td>
                    <td>
                      <span className={`role-tag priority-${task.priority}`}>{stageTaskPriorityLabel[task.priority]}</span>
                    </td>
                    <td>{formatDate(task.planned_date)}</td>
                    <td>
                      <span className={`status-pill ${task.status}`}>{stageTaskStatusLabel[task.status]}</span>
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
