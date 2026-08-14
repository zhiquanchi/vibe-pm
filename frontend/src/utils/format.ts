import type { Sprint, SprintStatus } from '@/types';
import { ApiError } from '@/services/api';

export const statusLabel: Record<SprintStatus, string> = {
  planning: '规划中',
  active: '进行中',
  completed: '已完成',
};

export const statusTone: Record<SprintStatus, string> = {
  planning: 'planning',
  active: 'active',
  completed: 'completed',
};

export function formatDate(value?: string | null): string {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(
        new Date(`${value.slice(0, 10)}T00:00:00`),
      )
    : '-';
}

export function formatRange(sprint?: Sprint | null): string {
  return sprint ? `${formatDate(sprint.start_date)} - ${formatDate(sprint.end_date)}` : '暂无日期';
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return '你没有访问该项目的权限';
  if (error instanceof Error) return error.message;
  return '请求失败，请稍后重试';
}

export function sprintPath(projectId: number, id: number): string {
  return `/projects/${projectId}/sprints/${id}`;
}
