import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services/api';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

export function useAsyncResource<T>(loader: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const requestId = useRef(0);
  const reload = useCallback(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: null }));
    loader(controller.signal).then(
      (data) => { if (id === requestId.current) setState({ data, loading: false, error: null }); },
      (error) => { if (id === requestId.current && !controller.signal.aborted) setState((previous) => ({ ...previous, loading: false, error: apiErrorMessage(error) })); },
    );
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);
  const setData = useCallback((next: T | null | ((previous: T | null) => T | null)) => {
    setState((previous) => ({ ...previous, data: typeof next === 'function' ? (next as (value: T | null) => T | null)(previous.data) : next }));
  }, []);
  return { ...state, reload, setData };
}
