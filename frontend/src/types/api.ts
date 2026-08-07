export type SprintStatus = 'planning' | 'active' | 'completed';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type StoryPoints = 1 | 2 | 3 | 5 | 8 | 13;
export type ScopeChangeType = 'add_task' | 'remove_task' | 'change_points';

export interface Sprint {
  id: number;
  project_id: number;
  name: string;
  goal: string | null;
  start_date: string;
  end_date: string;
  status: SprintStatus;
  initial_points: number;
  extension_count?: number;
  delay_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Task {
  id: number;
  project_id: number;
  sprint_id: number | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  story_points: number;
  priority: Priority;
  assignee: string | null;
  position: number;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

export interface ScopeChange {
  id: number;
  sprint_id: number;
  task_id: number | null;
  type: ScopeChangeType;
  description: string;
  points_delta: number;
  reason: string | null;
  created_by: string;
  created_at: string;
}

export interface SprintSnapshot {
  id: number;
  sprint_id: number;
  snapshot_date: string;
  total_scope: number;
  completed_points: number;
  remaining_points: number;
  ideal_completed?: number | null;
  ideal_remaining?: number | null;
  scope_change_id?: number | null;
  created_at?: string;
}

export interface SprintDetail {
  sprint: Sprint;
  tasks: Task[];
  scope_changes?: ScopeChange[];
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  default_sprint_weeks?: number;
}

export interface ProjectMember {
  id: string;
  name: string;
  email: string;
  avatar_url?: string | null;
  role: 'owner' | 'member';
}

export interface SprintStats {
  total_points: number;
  completed_points: number;
  remaining_points: number;
  completion_rate: number;
  task_count: number;
  completed_task_count: number;
}

export interface SprintStatusResult {
  sprint: Sprint;
  stats: SprintStats | null;
}

export interface SprintCreateInput {
  project_id?: number;
  name: string;
  goal?: string | null;
  start_date: string;
  end_date: string;
}

export interface TaskCreateInput {
  project_id?: number;
  sprint_id?: number | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  story_points: StoryPoints;
  priority?: Priority;
  assignee?: string | null;
  position?: number;
  reason?: string | null;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  story_points?: StoryPoints;
  priority?: Priority;
  assignee?: string | null;
  sprint_id?: number | null;
  position?: number;
  reason?: string | null;
}

export interface ScopeChangeCreateInput {
  task_id?: number | null;
  type: ScopeChangeType;
  title?: string | null;
  description: string;
  story_points?: StoryPoints;
  points_delta: number;
  reason?: string | null;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string | null;
  default_sprint_weeks?: 1 | 2;
}

export interface MemberCreateInput {
  user_id: string;
  name: string;
  email: string;
  role?: 'owner' | 'member';
}

export interface ApiErrorShape {
  detail?: string | Array<{ msg?: string }>;
  message?: string;
}
