import { useCallback, useState } from 'react';
import { apiClient } from '@/services/api';
import type { SprintStatus, TaskUpdateInput } from '@/types';
import { apiErrorMessage } from './useAsyncResource';
import { useScopeChanges } from './useScopeChanges';
import { useSnapshots } from './useSnapshots';
import { useSprintDetail } from './useSprintDetail';
import { useTasks } from './useTasks';

/** 接线示例：看板页面可用此 Hook 同时读取 Sprint、任务、时间线和图表数据。 */
export function useSprintWorkspace(sprintId: number | null) {
  const sprint = useSprintDetail(sprintId);
  const tasks = useTasks(sprintId ?? undefined);
  const scopeChanges = useScopeChanges(sprintId);
  const snapshots = useSnapshots(sprintId);
  const [sprintMutation, setSprintMutation] = useState({ loading: false, error: null as string | null });

  const updateSprint = useCallback(async (status: SprintStatus) => {
    if (sprintId == null) throw new Error('缺少 Sprint ID');
    const previous = sprint.sprint;
    setSprintMutation({ loading: true, error: null });
    sprint.setData((data) => data && data.sprint ? { ...data, sprint: { ...data.sprint, status } } : data);
    try {
      const result = await apiClient.updateSprint(sprintId, status);
      sprint.setData((data) => data && result.sprint ? { ...data, sprint: result.sprint } : data);
      setSprintMutation({ loading: false, error: null });
      return result;
    } catch (error) {
      sprint.setData((data) => data && previous ? { ...data, sprint: previous } : data);
      setSprintMutation({ loading: false, error: apiErrorMessage(error) });
      throw error;
    }
  }, [sprint, sprintId]);

  const updateTask = useCallback((id: number, input: TaskUpdateInput) => tasks.updateTask(id, input), [tasks.updateTask]);
  return {
    sprint: sprint.sprint,
    tasks: tasks.data ?? [],
    scopeChanges: scopeChanges.data ?? [],
    snapshots: snapshots.data ?? [],
    loading: sprint.loading || tasks.loading || scopeChanges.loading || snapshots.loading,
    error: sprint.error || tasks.error || scopeChanges.error || snapshots.error || sprintMutation.error,
    refresh: () => { sprint.reload(); tasks.reload(); scopeChanges.reload(); snapshots.reload(); },
    updateSprint,
    updateTask,
    createTask: tasks.createTask,
    deleteTask: tasks.deleteTask,
    createScopeChange: scopeChanges.createScopeChange,
    mutationLoading: tasks.mutationLoading || scopeChanges.mutationLoading || sprintMutation.loading,
  };
}
