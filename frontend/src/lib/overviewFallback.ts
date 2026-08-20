import { apiClient } from '../api';
import { overdueDays } from './format';
import type {
  ProjectOverallStatus,
  ProjectOverview,
  ProjectRisk,
  Stage,
  StageTask,
} from '../types';

function daysSince(value: string) {
  return Math.max(1, Math.ceil((Date.now() - new Date(value).getTime()) / 86400000));
}

/** 项目整体状态：由主阶段状态映射（PRD-06 §3）。 */
export function deriveOverallStatus(stages: Stage[]): ProjectOverallStatus {
  if (!stages.length || stages.every((stage) => stage.status === 'planned')) return 'planned';
  if (stages.every((stage) => stage.status === 'completed')) return 'completed';
  const primary = stages.find((stage) => stage.is_primary);
  if (primary && primary.status !== 'planned' && primary.status !== 'completed') return primary.status;
  const active = stages.filter((stage) => stage.status === 'active');
  if (active.some((stage) => stage.status === 'blocked')) return 'blocked';
  return 'active';
}

function stageRange(stages: Stage[]) {
  const dates = stages.flatMap((stage) => [stage.planned_start, stage.planned_end]);
  const valid = dates.filter(Boolean).map((value) => value!.slice(0, 10)).sort();
  return valid.length ? `${valid[0]} ~ ${valid[valid.length - 1]}` : '未排期';
}

/**
 * 后端 /overview 未就绪时的客户端拼装：基于既有 stages/tasks/blockers 端点
 * 组装 PRD-06 总览与风险数据。后端上线后无需改动调用方。
 */
export async function assembleOverview(projectId: number): Promise<{
  overview: ProjectOverview;
  risks: ProjectRisk[];
}> {
  const detail = await apiClient.getProject(projectId);
  const stages = await apiClient.listStages(projectId);
  const nameOf = (id: string | null) =>
    id ? detail.members.find((member) => member.id === id)?.name || id : null;

  const activeStages = stages.filter((stage) => stage.status === 'active');
  const stageTaskLists = await Promise.all(
    activeStages.map(async (stage) => {
      const tasks = await apiClient
        .listStageTasks(projectId, stage.id)
        .catch(() => [] as StageTask[]);
      const blockers = await apiClient
        .listStageBlockers(projectId, stage.id)
        .catch(() => []);
      return { stage, tasks, blockers };
    }),
  );

  const openTasks = stageTaskLists.reduce((sum, item) => sum + item.tasks.filter((task) => task.status !== 'done').length, 0);
  const blockedTasks = stageTaskLists.reduce((sum, item) => sum + item.tasks.filter((task) => task.status === 'blocked').length, 0);
  const pendingAcceptanceStages = stages.filter((stage) => stage.status === 'pending_acceptance').length;

  const risks: ProjectRisk[] = [];
  for (const { stage, tasks, blockers } of stageTaskLists) {
    for (const blocker of blockers) {
      if (!blocker.resolved_at) {
        risks.push({
          kind: 'stage_blocker',
          severity: 'high',
          title: `${stage.name} 受阻`,
          detail: blocker.reason,
          owner_name: nameOf(blocker.handler_id),
          duration_days: daysSince(blocker.created_at),
          overdue_days: null,
          stage_id: stage.id,
          task_id: null,
          blocker_id: blocker.id,
        });
      }
    }
    for (const task of tasks) {
      if (task.status === 'blocked' && (task.priority === 'urgent' || task.priority === 'important')) {
        risks.push({
          kind: 'task_blocker',
          severity: task.priority === 'urgent' ? 'high' : 'medium',
          title: `${task.title} 受阻`,
          detail: '任务处于受阻状态，需处理人跟进解除',
          owner_name: nameOf(task.assignee),
          duration_days: task.planned_date ? daysSince(task.planned_date) : 1,
          overdue_days: null,
          stage_id: stage.id,
          task_id: task.id,
          blocker_id: null,
        });
      }
      if (task.status !== 'done' && task.planned_date && overdueDays(task.planned_date) > 0) {
        risks.push({
          kind: 'overdue_task',
          severity: task.priority === 'urgent' ? 'high' : 'medium',
          title: `${task.title} 逾期`,
          detail: null,
          owner_name: nameOf(task.assignee),
          duration_days: overdueDays(task.planned_date),
          overdue_days: overdueDays(task.planned_date),
          stage_id: stage.id,
          task_id: task.id,
          blocker_id: null,
        });
      }
    }
  }
  for (const stage of stages) {
    if (stage.status !== 'completed' && stage.planned_end && overdueDays(stage.planned_end) > 0) {
      risks.push({
        kind: 'overdue_stage',
        severity: 'medium',
        title: `${stage.name} 逾期`,
        detail: stage.goal,
        owner_name: nameOf(stage.owner_id),
        duration_days: overdueDays(stage.planned_end),
        overdue_days: overdueDays(stage.planned_end),
        stage_id: stage.id,
        task_id: null,
        blocker_id: null,
      });
    }
  }

  const primary = stages.find((stage) => stage.is_primary) || null;
  const parallel = activeStages.filter((stage) => stage.id !== primary?.id);

  return {
    overview: {
      project: detail.project,
      overall_status: deriveOverallStatus(stages),
      primary_stage: primary,
      parallel_stages: parallel,
      metrics: {
        open_tasks: openTasks,
        blocked_tasks: blockedTasks,
        pending_acceptance_stages: pendingAcceptanceStages,
      },
    },
    risks,
  };
}

export function projectPlanRange(stages: Stage[]) {
  return stageRange(stages);
}
