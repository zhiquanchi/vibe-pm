import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Milestone, Plus, ShieldAlert } from 'lucide-react';
import { apiClient } from '../api';
import { useProjectMeta } from '../context';
import { errorText } from '../lib/format';
import { assembleOverview, projectPlanRange } from '../lib/overviewFallback';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/States';
import { StatusBadge } from '../components/shared/StatusBadge';
import type { ProjectOverview, ProjectRisk, Stage } from '../types';

const riskKindLabel: Record<ProjectRisk['kind'], string> = {
  stage_blocker: '阶段受阻',
  task_blocker: '任务受阻',
  overdue_stage: '阶段逾期',
  overdue_task: '任务逾期',
};

/** 阶段制项目总览（PRD-06）：主阶段优先 + 指标 + 风险。 */
export function OverviewView() {
  const { projectId } = useProjectMeta();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [risks, setRisks] = useState<ProjectRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewData, riskData] = await Promise.all([
        apiClient.getProjectOverview(projectId),
        apiClient.listProjectRisks(projectId),
      ]);
      setOverview(overviewData);
      setRisks(riskData);
      setStages(await apiClient.listStages(projectId));
    } catch {
      // PRD-06 后端未就绪时降级为客户端拼装
      try {
        const assembled = await assembleOverview(projectId);
        setOverview(assembled.overview);
        setRisks(assembled.risks);
        setStages(await apiClient.listStages(projectId));
      } catch (err) {
        setError(errorText(err));
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} retry={() => void load()} />;
  if (!overview) return <ErrorState message="总览数据不可用" retry={() => void load()} />;

  const { primary_stage: primary, parallel_stages: parallelStages, metrics } = overview;
  const firstActive = primary || parallelStages[0] || null;
  const gotoStageTasks = (stageId: number | null) => {
    if (stageId) navigate(`/projects/${projectId}/stages/${stageId}`);
    else navigate(`/projects/${projectId}/stages`);
  };
  const formatDate = (value: string | null) => (value ? value.slice(0, 10) : '?');

  return (
    <>
      <PageHeader
        eyebrow="PROJECT OVERVIEW"
        title={overview.project.name}
        copy={overview.project.description || '以主阶段为核心的项目健康度总览。'}
        actions={<StatusBadge kind="project" status={overview.overall_status} dot />}
      />
      {stages.length === 0 ? (
        <EmptyState
          title="项目还没有阶段"
          copy="从阶段列表新增第一个阶段，开始搭建开发流程。"
          action={
            <button
              className="primary-btn"
              onClick={() => navigate(`/projects/${projectId}/stages`)}
            >
              <Plus size={15} /> 前往阶段列表
            </button>
          }
        />
      ) : (
        <>
          <section className="overview-hero panel">
            <div>
              <span>计划周期</span>
              <b>{projectPlanRange(stages)}</b>
            </div>
            <div>
              <span>主阶段</span>
              <b>{primary ? primary.name : '未指定'}</b>
            </div>
            <div>
              <span>并行阶段</span>
              <b>{parallelStages.length} 个</b>
            </div>
          </section>
          <section className="metrics">
            <button
              className="metric metric-clickable"
              onClick={() => gotoStageTasks(firstActive?.id ?? null)}
              title="查看未完成任务"
            >
              <div className="metric-icon blue">
                <Milestone size={16} />
              </div>
              <div className="metric-body">
                <span className="metric-label">未完成任务</span>
                <b className="metric-value">{metrics.open_tasks}</b>
                <small>点击进入工作台</small>
              </div>
            </button>
            <button
              className="metric metric-clickable"
              onClick={() => gotoStageTasks(firstActive?.id ?? null)}
              title="查看受阻任务"
            >
              <div className="metric-icon orange">
                <ShieldAlert size={16} />
              </div>
              <div className="metric-body">
                <span className="metric-label">受阻任务</span>
                <b className="metric-value">{metrics.blocked_tasks}</b>
                <small>需要处理人跟进</small>
              </div>
            </button>
            <button
              className="metric metric-clickable"
              onClick={() => navigate(`/projects/${projectId}/stages`)}
              title="查看待验收阶段"
            >
              <div className="metric-icon purple">
                <ArrowRight size={16} />
              </div>
              <div className="metric-body">
                <span className="metric-label">待验收阶段</span>
                <b className="metric-value">{metrics.pending_acceptance_stages}</b>
                <small>进入阶段列表</small>
              </div>
            </button>
          </section>
          <div className="overview-stage-grid">
            <section className="panel primary-stage">
              <div className="panel-head">
                <div>
                  <h2>
                    {primary ? primary.name : '暂无主阶段'}{' '}
                    <span className="role-tag owner">主阶段</span>
                  </h2>
                  <p>{primary?.goal || '未设置阶段目标'}</p>
                </div>
                {primary && <StatusBadge kind="stage" status={primary.status} dot />}
              </div>
              {primary ? (
                <div className="overview-sprint">
                  <div>
                    <span>负责人</span>
                    <b>{primary.owner_id || '未指定'}</b>
                  </div>
                  <div>
                    <span>计划日期</span>
                    <b>
                      {primary.planned_start || primary.planned_end
                        ? `${formatDate(primary.planned_start)} ~ ${formatDate(primary.planned_end)}`
                        : '未排期'}
                    </b>
                  </div>
                  <button
                    className="primary-btn small"
                    onClick={() => navigate(`/projects/${projectId}/stages/${primary.id}`)}
                  >
                    进入工作台 <ArrowRight size={14} />
                  </button>
                </div>
              ) : (
                <p className="permission-note">
                  项目尚无进行中的主阶段，可从阶段列表启动一个阶段作为主阶段。
                </p>
              )}
            </section>
            <section className="panel parallel-stages">
              <div className="panel-head">
                <div>
                  <h2>并行阶段</h2>
                  <p>与主阶段同时推进的其他活动阶段</p>
                </div>
              </div>
              {parallelStages.length ? (
                <div className="parallel-stage-list">
                  {parallelStages.map((stage) => (
                    <button
                      className="parallel-stage-row"
                      key={stage.id}
                      onClick={() => navigate(`/projects/${projectId}/stages/${stage.id}`)}
                    >
                      <span>
                        <b>{stage.name}</b>
                        <small>{stage.owner_id || '未指定负责人'}</small>
                      </span>
                      <StatusBadge kind="stage" status={stage.status} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="permission-note">当前没有并行推进的阶段。</p>
              )}
            </section>
          </div>
          <section className="panel risk-panel">
            <div className="panel-head">
              <div>
                <h2>风险</h2>
                <p>未解除阻塞、高优先级受阻与逾期事项</p>
              </div>
            </div>
            {risks.length ? (
              <div className="risk-list">
                {risks.map((risk, index) => (
                  <button
                    className={`risk-item ${risk.severity}`}
                    key={`${risk.kind}-${risk.stage_id}-${risk.task_id ?? index}`}
                    onClick={() => gotoStageTasks(risk.stage_id)}
                  >
                    <span className={`risk-dot ${risk.severity}`} />
                    <span className="risk-main">
                      <b>
                        [{riskKindLabel[risk.kind]}] {risk.title}
                      </b>
                      <small>
                        {risk.detail ? `${risk.detail} · ` : ''}
                        {risk.owner_name ? `${risk.owner_name} · ` : ''}
                        {risk.kind === 'overdue_stage' || risk.kind === 'overdue_task'
                          ? `逾期 ${risk.overdue_days ?? risk.duration_days} 天`
                          : `持续 ${risk.duration_days} 天`}
                      </small>
                    </span>
                    <span className="risk-action">
                      详情 <ArrowRight size={13} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="permission-note">当前无风险</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
