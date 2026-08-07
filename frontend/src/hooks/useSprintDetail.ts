import { apiClient } from '../api';
import type { SprintDetail } from '../types';
import { useAsyncResource } from './useAsyncResource';

export function useSprintDetail(sprintId: number | null) {
  const resource = useAsyncResource<SprintDetail>(
    (signal) => sprintId == null ? Promise.reject(new Error('缺少 Sprint ID')) : apiClient.getSprintDetail(sprintId, signal),
    [sprintId],
  );
  return { ...resource, sprint: resource.data?.sprint ?? null, tasks: resource.data?.tasks ?? [] };
}
