import { useCallback, useState } from 'react';
import { apiClient } from '@/services/api';
import type { Task, TaskCreateInput, TaskUpdateInput } from '@/types';
import { apiErrorMessage, useAsyncResource } from './useAsyncResource';

export function useTasks(sprintId?: number) {
  const resource = useAsyncResource<Task[]>(
    (signal) => apiClient.listTasks(sprintId, signal),
    [sprintId],
  );
  const [mutation, setMutation] = useState({ loading: false, error: null as string | null });
  const runMutation = useCallback(async <T,>(action: () => Promise<T>) => {
    setMutation({ loading: true, error: null });
    try { const value = await action(); setMutation({ loading: false, error: null }); resource.reload(); return value; }
    catch (error) { setMutation({ loading: false, error: apiErrorMessage(error) }); throw error; }
  }, [resource.reload]);

  const updateTask = useCallback(async (id: number, input: TaskUpdateInput) => {
    const previous = resource.data;
    const optimistic = previous?.map((task) => task.id === id ? { ...task, ...input } : task);
    if (optimistic) resource.setData(optimistic);
    try { return await runMutation(() => apiClient.updateTask(id, input)); }
    catch (error) { resource.setData(previous); throw error; }
  }, [resource.data, resource.setData, runMutation]);

  const createTask = useCallback((input: TaskCreateInput) => runMutation(() => apiClient.createTask(input)), [runMutation]);
  const deleteTask = useCallback((id: number, reason?: string) => runMutation(() => apiClient.deleteTask(id, reason)), [runMutation]);
  const deleteTaskOptimistic = useCallback(async (id: number, reason?: string) => {
    const previous = resource.data;
    resource.setData(previous?.filter((task) => task.id !== id) ?? null);
    try { return await deleteTask(id, reason); }
    catch (error) { resource.setData(previous); throw error; }
  }, [deleteTask, resource.data, resource.setData]);
  return { ...resource, mutationLoading: mutation.loading, mutationError: mutation.error, createTask, updateTask, deleteTask: deleteTaskOptimistic };
}
