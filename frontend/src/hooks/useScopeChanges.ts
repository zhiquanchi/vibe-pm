import { useCallback, useState } from 'react';
import { apiClient } from '../api';
import type { ScopeChange, ScopeChangeCreateInput } from '../types';
import { apiErrorMessage, useAsyncResource } from './useAsyncResource';

export function useScopeChanges(sprintId: number | null) {
  const resource = useAsyncResource<ScopeChange[]>(
    (signal) => sprintId == null ? Promise.resolve([]) : apiClient.listScopeChanges(sprintId, signal),
    [sprintId],
  );
  const [mutation, setMutation] = useState({ loading: false, error: null as string | null });
  const createScopeChange = useCallback(async (input: ScopeChangeCreateInput) => {
    if (sprintId == null) throw new Error('缺少 Sprint ID');
    setMutation({ loading: true, error: null });
    try {
      const created = await apiClient.createScopeChange(sprintId, input);
      resource.setData((previous) => previous ? [created, ...previous] : [created]);
      setMutation({ loading: false, error: null });
      return created;
    } catch (error) {
      setMutation({ loading: false, error: apiErrorMessage(error) });
      throw error;
    }
  }, [resource.setData, sprintId]);
  return { ...resource, mutationLoading: mutation.loading, mutationError: mutation.error, createScopeChange };
}
