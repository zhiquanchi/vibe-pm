import type {
  ApiErrorShape,
  ScopeChange,
  ScopeChangeCreateInput,
  Sprint,
  SprintCreateInput,
  SprintDetail,
  SprintSnapshot,
  SprintStatus,
  SprintStatusResult,
  Task,
  TaskCreateInput,
  TaskUpdateInput,
} from '../types';

const env = import.meta.env as Record<string, string | undefined>;

/** Reads both Vite and Next-style names so the client can be reused in either build. */
export function getApiBaseUrl(): string {
  return (env.VITE_API_BASE_URL || env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api').replace(/\/$/, '');
}

export function getUserId(): string {
  return env.VITE_USER_ID || env.NEXT_PUBLIC_USER_ID || 'current-user';
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function errorMessage(body: ApiErrorShape | null, status: number): string {
  if (typeof body?.detail === 'string') return body.detail;
  if (Array.isArray(body?.detail)) return body.detail.map((item) => item.msg).filter(Boolean).join('；') || `请求失败（${status}）`;
  return body?.message || `请求失败（${status}）`;
}

export class ApiClient {
  constructor(private readonly baseUrl = getApiBaseUrl(), private readonly userId = getUserId()) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('X-User-Id', this.userId);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : '网络连接失败，请检查 API 服务', 0);
    }
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) {
      throw new ApiError(errorMessage((body && typeof body === 'object' ? body : null) as ApiErrorShape | null, response.status), response.status, body);
    }
    return body as T;
  }

  get<T>(path: string, signal?: AbortSignal) { return this.request<T>(path, { method: 'GET', signal }); }
  post<T>(path: string, payload: unknown) { return this.request<T>(path, { method: 'POST', body: JSON.stringify(payload) }); }
  patch<T>(path: string, payload: unknown) { return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) }); }
  delete<T>(path: string, query = '') { return this.request<T>(`${path}${query}`, { method: 'DELETE' }); }

  getSprintDetail(id: number, signal?: AbortSignal) { return this.get<SprintDetail>(`/sprints/${id}`, signal); }
  createSprint(input: SprintCreateInput) { return this.post<Sprint>('/sprints', input); }
  updateSprint(id: number, status: SprintStatus) { return this.patch<SprintStatusResult>(`/sprints/${id}`, { status }); }
  listTasks(sprintId?: number, signal?: AbortSignal) { return this.get<Task[]>(sprintId == null ? '/tasks' : `/tasks?sprint_id=${sprintId}`, signal); }
  createTask(input: TaskCreateInput) { return this.post<Task>('/tasks', input); }
  updateTask(id: number, input: TaskUpdateInput) { return this.patch<Task>(`/tasks/${id}`, input); }
  deleteTask(id: number, reason?: string) {
    const query = reason ? `?reason=${encodeURIComponent(reason)}&created_by=${encodeURIComponent(this.userId)}` : '';
    return this.delete<{ deleted: boolean }>(`/tasks/${id}`, query);
  }
  listScopeChanges(sprintId: number, signal?: AbortSignal) { return this.get<ScopeChange[]>(`/sprints/${sprintId}/scope-changes`, signal); }
  async createScopeChange(sprintId: number, input: ScopeChangeCreateInput) {
    const result = await this.post<ScopeChange | { scope_change: ScopeChange; capacity_warning?: string | null }>(`/sprints/${sprintId}/scope-changes`, input);
    return 'scope_change' in result ? result.scope_change : result;
  }
  listSnapshots(sprintId: number, signal?: AbortSignal) { return this.get<SprintSnapshot[]>(`/sprints/${sprintId}/snapshots`, signal); }
}

export const apiClient = new ApiClient();
