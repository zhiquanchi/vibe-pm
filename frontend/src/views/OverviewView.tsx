import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Plus } from 'lucide-react';
import { apiClient } from '../api';
import { useProjectMeta } from '../context';
import { useSprintWorkspace } from '../hooks';
import { formatDate, formatRange } from '../lib/format';
import { sprintStatusLabel } from '../lib/labels';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState, ErrorState } from '../components/shared/States';
import { Metric } from '../components/shared/Metric';
import { StatusBadge } from '../components/shared/StatusBadge';
import type { Task } from '../types';

/** 旧版 Sprint 指标总览（Phase 1 将重写为阶段制总览）。 */
export function OverviewView() {
  const { projectId, sprints, refresh } = useProjectMeta();
  const navigate = useNavigate();
  const sprint = sprints.find((item) => item.status === 'active') || null;
  const resource = useSprintWorkspace(sprint?.id || null);
  const [backlog, setBacklog] = useState<Task[]>([]);
  useEffect(() => {
    void apiClient
      .listBacklog(projectId)
      .then(setBacklog)
      .catch(() => undefined);
  }, [projectId, sprint?.id]);
  const recent = resource.scopeChanges.slice(0, 5);
  return (
    <>
      <PageHeader
        eyebrow="PROJECT OVERVIEW"
        title="项目总览"
        copy="快速了解当前迭代、Backlog 和最近的范围变化。"
        actions={
          <button
            className="primary-btn"
            onClick={() => navigate(`/projects/${projectId}/sprints`)}
          >
            <Activity size={15} /> 查看迭代
          </button>
        }
      />
      {resource.error ? (
        <ErrorState message={resource.error} retry={refresh} />
      ) : (
        <>
          <section className="metrics">
            <Metric
              label="当前迭代"
              value={sprint?.name || '未开始'}
              note={
                sprint
                  ? `${formatRange(sprint)} · ${sprintStatusLabel[sprint.status]}`
                  : '先创建或开始一个迭代'
              }
              tone="blue"
            />
            <Metric
              label="迭代范围"
              value={`${resource.snapshots[resource.snapshots.length - 1]?.total_scope ?? sprint?.initial_points ?? 0} pt`}
              note={`初始 ${sprint?.initial_points || 0} pt`}
              tone="green"
            />
            <Metric label="Backlog" value={`${backlog.length} 个任务`} note="待规划任务" tone="orange" />
            <Metric label="范围变更" value={`${recent.length} 条`} note="最近活动" tone="purple" />
          </section>
          <div className="overview-grid">
            <section className="panel overview-section">
              <div className="panel-head">
                <div>
                  <h2>当前迭代</h2>
                  <p>目标、范围和执行状态</p>
                </div>
                {sprint && <StatusBadge kind="sprint" status={sprint.status} />}
              </div>
              {sprint ? (
                <>
                  <div className="overview-sprint">
                    <div>
                      <span>目标</span>
                      <b>{sprint.goal || '暂无迭代目标'}</b>
                    </div>
                    <div>
                      <span>日期</span>
                      <b>{formatRange(sprint)}</b>
                    </div>
                    <div>
                      <span>初始范围</span>
                      <b>{sprint.initial_points} pt</b>
                    </div>
                  </div>
                  <button
                    className="text-btn"
                    onClick={() => navigate(`/projects/${projectId}/sprints/${sprint.id}`)}
                  >
                    进入工作台 <span>→</span>
                  </button>
                </>
              ) : (
                <EmptyState
                  title={sprints.length ? '还没有进行中的迭代' : '还没有迭代'}
                  copy={
                    sprints.length
                      ? '请先开始一个已规划的迭代。'
                      : '新建一个迭代后，项目状态会显示在这里。'
                  }
                  action={
                    <button
                      className="primary-btn"
                      onClick={() => navigate(`/projects/${projectId}/sprints`)}
                    >
                      <Plus size={15} /> {sprints.length ? '查看迭代' : '新建迭代'}
                    </button>
                  }
                />
              )}
            </section>
            <section className="panel overview-section">
              <div className="panel-head">
                <div>
                  <h2>最近范围变更</h2>
                  <p>点击记录查看所属迭代</p>
                </div>
                <button
                  className="text-btn"
                  onClick={() =>
                    navigate(`/projects/${projectId}/reports/${sprint?.id || ''}`)
                  }
                >
                  查看报告
                </button>
              </div>
              {recent.length ? (
                <div className="activity-list">
                  {recent.map((change) => (
                    <button
                      key={change.id}
                      className="activity-row"
                      onClick={() =>
                        navigate(
                          `/projects/${projectId}/sprints/${change.sprint_id}?change_id=${change.id}`,
                        )
                      }
                    >
                      <span
                        className={`notice-dot ${change.points_delta >= 0 ? 'scope' : 'end'}`}
                      />
                      <span>
                        <b>{change.description}</b>
                        <small>
                          {formatDate(change.created_at)} · {change.reason || '未填写原因'}
                        </small>
                      </span>
                      <strong className={change.points_delta >= 0 ? 'positive' : 'negative'}>
                        {change.points_delta > 0 ? '+' : ''}
                        {change.points_delta} pt
                      </strong>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState title="暂无范围变更" copy="迭代中发生的范围调整会记录在这里。" />
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
