import { apiClient } from '@/services/api';
import type { SprintDetail } from '@/types';
import { useAsyncResource } from './useAsyncResource';

export function useSprintDetail(sprintId: number | null) {
  const resource = useAsyncResource<SprintDetail | null>(
    (signal) => sprintId == null ? Promise.resolve(null) : apiClient.getSprintDetail(sprintId, signal),
    [sprintId],
  );
  return { ...resource, sprint: resource.data?.sprint ?? null, tasks: resource.data?.tasks ?? [] };
}
