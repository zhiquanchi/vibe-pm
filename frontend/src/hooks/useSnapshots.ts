import { apiClient } from '@/services/api';
import type { SprintSnapshot } from '@/types';
import { useAsyncResource } from './useAsyncResource';

export function useSnapshots(sprintId: number | null) {
  return useAsyncResource<SprintSnapshot[]>(
    (signal) => sprintId == null ? Promise.resolve([]) : apiClient.listSnapshots(sprintId, signal),
    [sprintId],
  );
}
