import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, History, ShieldCheck } from 'lucide-react';
import { apiClient } from '../api';
import { useProjectMeta } from '../context';
import { errorText, formatDateTime } from '../lib/format';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/States';
import type { ProjectActivity, Stage } from '../types';

/** 事件类型中文标签（PRD-06 活动流）。未知类型回退显示原始 type。 */
const activityTypeLabel: Record<string, string> = {
  project_created: '创建项目',
  stage_created: '创建阶段',
  stage_renamed: '重命名阶段',
  stage_updated: '更新阶段',
  stage_deleted: '删除阶段',
  stage_started: '启动阶段',
  stage_completed: '完成阶段',
  stage_reopened: '重新打开阶段',
  stage_reordered: '调整阶段顺序',
  stage_owner_changed: '变更阶段负责人',
  stage_blocker_created: '标记阶段阻塞',
  stage_blocker_resolved: '解除阶段阻塞',
  primary_changed: '切换主阶段',
  task_created: '创建任务',
  task_updated: '更新任务',
  task_status_changed: '变更任务状态',
  task_moved: '移动任务',
  task_deleted: '删除任务',
  task_acceptance_required: '设为验收必需',
  task_acceptance_optional: '取消验收必需',
  task_dependency_added: '添加任务依赖',
  task_dependency_removed: '移除任务依赖',
  task_blocker_created: '标记任务阻塞',
  task_blocker_resolved: '解除任务阻塞',
  task_confirmed: '确认任务',
  stage_deliverable_added: '添加交付物',
  stage_deliverable_updated: '更新交付物',
  stage_deliverable_removed: '删除交付物',
  stage_deliverable_required: '交付物设为必需',
  stage_deliverable_optional: '交付物取消必需',
  stage_acceptance_submitted: '提交阶段验收',
  stage_acceptance_approved: '确认阶段验收',
  stage_acceptance_rejected: '驳回阶段验收',
  member_added: '添加成员',
  member_removed: '移除成员',
  member_role_changed: '变更成员角色',
};

/** 事件类型筛选分组：按业务对象聚合，方便按类别过滤。 */
const activityTypeGroups: Array<{ label: string; types: string[] }> = [
  {
    label: '阶段',
    types: [
      'stage_created',
      'stage_renamed',
      'stage_updated',
      'stage_deleted',
      'stage_started',
      'stage_completed',
      'stage_reopened',
      'stage_reordered',
      'stage_owner_changed',
      'primary_changed',
    ],
  },
  {
    label: '任务',
    types: [
      'task_created',
      'task_updated',
      'task_status_changed',
      'task_moved',
      'task_deleted',
      'task_acceptance_required',
      'task_acceptance_optional',
      'task_dependency_added',
      'task_dependency_removed',
      'task_confirmed',
    ],
  },
  {
    label: '阻塞',
    types: ['stage_blocker_created', 'stage_blocker_resolved', 'task_blocker_created', 'task_blocker_resolved'],
  },
  {
    label: '交付物',
    types: [
      'stage_deliverable_added',
      'stage_deliverable_updated',
      'stage_deliverable_removed',
      'stage_deliverable_required',
      'stage_deliverable_optional',
    ],
  },
  {
    label: '验收',
    types: ['stage_acceptance_submitted', 'stage_acceptance_approved', 'stage_acceptance_rejected'],
  },
  {
    label: '成员',
    types: ['member_added', 'member_removed', 'member_role_changed'],
  },
];

function activityTargetPath(projectId: number, item: ProjectActivity): string | null {
  if (item.target_deleted) return null;
  if (item.stage_id != null) return `/projects/${projectId}/stages/${item.stage_id}`;
  if (item.type.startsWith('member_')) return `/projects/${projectId}/members`;
  if (item.type === 'project_created') return `/projects/${projectId}`;
  return `/projects/${projectId}`;
}

/** 项目活动页（PRD-06）：全员只读，时间倒序 + 三类筛选。 */
export function ActivityView() {
  const { projectId, members } = useProjectMeta();
  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [filters, setFilters] = useState<{ stage: string; type: string; operator: string }>({
    stage: '',
    type: '',
    operator: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    const params: { stage_id?: number; type?: string; created_by?: string } = {};
    if (filters.stage) params.stage_id = Number(filters.stage);
    if (filters.type) params.type = filters.type;
    if (filters.operator) params.created_by = filters.operator;
    apiClient
      .listProjectActivities(projectId, params)
      .then(setActivities)
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiClient
      .listStages(projectId)
      .then(setStages)
      .catch(() => setStages([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, projectId]);

  const operatorOptions = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ id: string; name: string }> = [];
    for (const member of members) {
      if (seen.has(member.id)) continue;
      seen.add(member.id);
      result.push({ id: member.id, name: member.name });
    }
    for (const item of activities) {
      if (seen.has(item.created_by)) continue;
      seen.add(item.created_by);
      result.push({ id: item.created_by, name: item.created_by_name || item.created_by });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }, [members, activities]);

  return (
    <>
      <PageHeader
        eyebrow="ACTIVITY"
        title="项目活动"
        copy="项目关键变化的完整时间线，全员只读。"
      />
      <section className="panel stage-workbench">
        <div className="toolbar">
          <select
            value={filters.stage}
            onChange={(event) => setFilters((f) => ({ ...f, stage: event.target.value }))}
          >
            <option value="">全部阶段</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
          <select
            value={filters.type}
            onChange={(event) => setFilters((f) => ({ ...f, type: event.target.value }))}
          >
            <option value="">全部事件类型</option>
            {activityTypeGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.types.map((type) => (
                  <option key={type} value={type}>
                    {activityTypeLabel[type] || type}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            value={filters.operator}
            onChange={(event) => setFilters((f) => ({ ...f, operator: event.target.value }))}
          >
            <option value="">全部操作人</option>
            {operatorOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <p className="permission-note">
          <ShieldCheck size={14} /> 活动记录由系统自动生成，不可修改或删除。
        </p>
        {error ? (
          <ErrorState message={error} retry={load} />
        ) : loading ? (
          <LoadingState />
        ) : !activities.length ? (
          <EmptyState title="暂无活动记录" copy="该筛选条件下没有项目活动。" />
        ) : (
          <div className="activity-feed">
            {activities.map((item) => {
              const path = activityTargetPath(projectId, item);
              const content = (
                <>
                  <span className="activity-marker">
                    <History size={14} />
                  </span>
                  <span className="activity-body">
                    <span className="activity-meta">
                      <b>{item.created_by_name || item.created_by}</b>
                      <time>{formatDateTime(item.created_at)}</time>
                      <em>{activityTypeLabel[item.type] || item.type}</em>
                    </span>
                    <span className="activity-desc">
                      {item.description}
                      {item.stage_name && !item.stage_id && (
                        <small className="activity-stage"> {item.stage_name}</small>
                      )}
                    </span>
                  </span>
                  <span className="activity-action">
                    {item.target_deleted ? (
                      <small className="deleted-tag">对象已删除</small>
                    ) : (
                      <small className="link">
                        详情 <ArrowRight size={12} />
                      </small>
                    )}
                  </span>
                </>
              );
              return path ? (
                <Link className="activity-row" to={path} key={item.id}>
                  {content}
                </Link>
              ) : (
                <div className="activity-row is-deleted" key={item.id}>
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
