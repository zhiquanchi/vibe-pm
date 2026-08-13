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
  Stage,
  StageTemplateItem,
  StageUpdateInput,
  StageTask,
  MyTask,
  Task,
  TaskDependency,
  TaskBlocker,
  StageBlocker,
  TaskDependencyCreate,
  BlockerCreate,
  BlockerResolve,
  ConfirmBlockerInput,
  TaskCreate,
  TaskCreateInput,
  TaskMoveRequest,
  TaskUpdate,
  TaskUpdateInput,
  MemberCreateInput,
  MemberUpdateInput,
  Project,
  ProjectCreateInput,
  ProjectMember,
  ProjectUpdateInput,
} from '../types';

const env = import.meta.env as Record<string, string | undefined>;

/** Reads both Vite and Next-style names so the client can be reused in either build. */
export function getApiBaseUrl(): string {
  return (env.VITE_API_BASE_URL || env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api').replace(/\/$/, '');
}

export function getUserId(): string {
  return env.VITE_USER_ID || env.NEXT_PUBLIC_USER_ID || 'demo-user';
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
  put<T>(path: string, payload: unknown) { return this.request<T>(path, { method: 'PUT', body: JSON.stringify(payload) }); }
  delete<T>(path: string, query = '') { return this.request<T>(`${path}${query}`, { method: 'DELETE' }); }

  getSprintDetail(id: number, signal?: AbortSignal) { return this.get<SprintDetail>(`/sprints/${id}`, signal); }
  listSprints(signal?: AbortSignal) { return this.get<Sprint[]>('/sprints', signal); }
  createSprint(input: SprintCreateInput) { return this.post<Sprint>('/sprints', input); }
  updateSprint(id: number, status: SprintStatus) { return this.patch<SprintStatusResult>(`/sprints/${id}`, { status }); }
  listTasks(sprintId?: number, signal?: AbortSignal) { return this.get<Task[]>(sprintId == null ? '/tasks' : `/tasks?sprint_id=${sprintId}`, signal); }
  listBacklog(projectId = 1, signal?: AbortSignal) { return this.get<Task[]>(`/backlog?project_id=${projectId}`, signal); }
  addTaskToSprint(sprintId: number, taskId: number, reason?: string) { return this.post<Task>(`/sprints/${sprintId}/tasks/${taskId}`, { reason }); }
  removeTaskFromSprint(sprintId: number, taskId: number) { return this.delete<Task>(`/sprints/${sprintId}/tasks/${taskId}`); }
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
  getProject(projectId: number, signal?: AbortSignal) { return this.get<{ project: Project; members: ProjectMember[] }>(`/projects/${projectId}`, signal); }
  updateProject(projectId: number, input: ProjectUpdateInput) { return this.patch<Project>(`/projects/${projectId}`, input); }
  listMembers(projectId: number, signal?: AbortSignal) { return this.get<ProjectMember[]>(`/projects/${projectId}/members`, signal); }
  addMember(projectId: number, input: MemberCreateInput) { return this.post<ProjectMember>(`/projects/${projectId}/members`, input); }
  updateMemberRole(projectId: number, userId: string, input: MemberUpdateInput) { return this.patch<ProjectMember>(`/projects/${projectId}/members/${userId}`, input); }
  removeMember(projectId: number, userId: string) { return this.delete<{ removed: boolean }>(`/projects/${projectId}/members/${userId}`); }
  updateStageOwner(projectId: number, stageId: number, ownerId: string | null) { return this.patch<Stage>(`/projects/${projectId}/stages/${stageId}`, { owner_id: ownerId }); }
  updateSprintDates(id: number, start_date: string, end_date: string) { return this.patch<Sprint>(`/sprints/${id}/dates`, { start_date, end_date }); }
  getStageTemplate(signal?: AbortSignal) { return this.get<StageTemplateItem[]>('/stage-template', signal); }
  createProject(input: ProjectCreateInput) { return this.post<Project>('/projects', input); }
  listStages(projectId: number, signal?: AbortSignal) { return this.get<Stage[]>(`/projects/${projectId}/stages`, signal); }
  addStage(projectId: number, input: StageTemplateItem) { return this.post<Stage>(`/projects/${projectId}/stages`, input); }
  updateStage(projectId: number, stageId: number, input: StageUpdateInput) { return this.patch<Stage>(`/projects/${projectId}/stages/${stageId}`, input); }
  reorderStages(projectId: number, stageIds: number[]) { return this.put<Stage[]>(`/projects/${projectId}/stages/reorder`, { stage_ids: stageIds }); }
  deleteStage(projectId: number, stageId: number, confirm = false) { return this.delete<{ deleted: boolean }>(`/projects/${projectId}/stages/${stageId}`, confirm ? '?confirm=true' : ''); }
  startStage(projectId: number, stageId: number, primary: boolean) { return this.post<Stage>(`/projects/${projectId}/stages/${stageId}/start`, { primary }); }
  setPrimaryStage(projectId: number, stageId: number) { return this.post<Stage>(`/projects/${projectId}/stages/${stageId}/primary`, {}); }
  completeStage(projectId: number, stageId: number, successorStageId?: number) { return this.post<Stage>(`/projects/${projectId}/stages/${stageId}/complete`, successorStageId ? { successor_stage_id: successorStageId } : {}); }

  // --- PRD-03: stage-based task management ---

  listStageTasks(projectId: number, stageId: number, params: { status?: string; priority?: string; assignee?: string; search?: string; sort?: string } = {}, signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.priority) query.set('priority', params.priority);
    if (params.assignee) query.set('assignee', params.assignee);
    if (params.search) query.set('search', params.search);
    if (params.sort) query.set('sort', params.sort);
    const qs = query.toString();
    return this.get<StageTask[]>(`/projects/${projectId}/stages/${stageId}/tasks${qs ? `?${qs}` : ''}`, signal);
  }
  createStageTask(projectId: number, stageId: number, input: TaskCreate) {
    return this.post<StageTask>(`/projects/${projectId}/stages/${stageId}/tasks`, input);
  }
  updateStageTask(projectId: number, taskId: number, input: TaskUpdate) {
    return this.patch<StageTask>(`/projects/${projectId}/tasks/${taskId}`, input);
  }
  moveStageTask(projectId: number, taskId: number, input: TaskMoveRequest) {
    return this.put<StageTask>(`/projects/${projectId}/tasks/${taskId}/move`, input);
  }
  deleteStageTask(projectId: number, taskId: number) {
    return this.delete<{ deleted: boolean }>(`/projects/${projectId}/tasks/${taskId}`);
  }
  listMyTasks(params: { project_id?: number; stage_id?: number; status?: string; priority?: string; sort?: string } = {}, signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (params.project_id != null) query.set('project_id', String(params.project_id));
    if (params.stage_id != null) query.set('stage_id', String(params.stage_id));
    if (params.status) query.set('status', params.status);
    if (params.priority) query.set('priority', params.priority);
    if (params.sort) query.set('sort', params.sort);
    const qs = query.toString();
    return this.get<MyTask[]>(`/my-tasks${qs ? `?${qs}` : ''}`, signal);
  }

  // --- PRD-04: task dependencies & blockers ---

  listTaskDependencies(projectId: number, taskId: number, signal?: AbortSignal) {
    return this.get<TaskDependency[]>(`/projects/${projectId}/tasks/${taskId}/dependencies`, signal);
  }
  addTaskDependency(projectId: number, taskId: number, input: TaskDependencyCreate) {
    return this.post<TaskDependency>(`/projects/${projectId}/tasks/${taskId}/dependencies`, input);
  }
  removeTaskDependency(projectId: number, taskId: number, dependencyId: number) {
    return this.delete<{ deleted: boolean }>(`/projects/${projectId}/tasks/${taskId}/dependencies/${dependencyId}`);
  }
  listTaskBlockers(projectId: number, taskId: number, signal?: AbortSignal) {
    return this.get<TaskBlocker[]>(`/projects/${projectId}/tasks/${taskId}/blockers`, signal);
  }
  addTaskBlocker(projectId: number, taskId: number, input: BlockerCreate) {
    return this.post<TaskBlocker>(`/projects/${projectId}/tasks/${taskId}/blockers`, input);
  }
  resolveTaskBlocker(projectId: number, taskId: number, blockerId: number, input: BlockerResolve) {
    return this.patch<TaskBlocker>(`/projects/${projectId}/tasks/${taskId}/blockers/${blockerId}`, input);
  }
  listStageBlockers(projectId: number, stageId: number, signal?: AbortSignal) {
    return this.get<StageBlocker[]>(`/projects/${projectId}/stages/${stageId}/blockers`, signal);
  }
  addStageBlocker(projectId: number, stageId: number, input: BlockerCreate) {
    return this.post<StageBlocker>(`/projects/${projectId}/stages/${stageId}/blockers`, input);
  }
  resolveStageBlocker(projectId: number, stageId: number, blockerId: number, input: BlockerResolve) {
    return this.patch<StageBlocker>(`/projects/${projectId}/stages/${stageId}/blockers/${blockerId}`, input);
  }
  confirmBlocker(projectId: number, taskId: number, input: ConfirmBlockerInput) {
    return this.post<StageTask>(`/projects/${projectId}/tasks/${taskId}/confirm-blocker`, input);
  }
}

export const apiClient = new ApiClient();
