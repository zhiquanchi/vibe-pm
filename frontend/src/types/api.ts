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
  role: 'owner' | 'member' | 'observer';
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
  role?: 'owner' | 'member' | 'observer';
}

export interface MemberUpdateInput {
  role: 'owner' | 'member' | 'observer';
}

// PRD-05 起阶段含「待验收」中间态
export type StageStatus = 'planned' | 'active' | 'blocked' | 'pending_acceptance' | 'completed';

/** 项目整体状态：由主阶段状态自动映射（PRD-06）。 */
export type ProjectOverallStatus = 'planned' | 'active' | 'blocked' | 'pending_acceptance' | 'completed';

export interface Stage {
  id: number;
  project_id: number;
  name: string;
  goal: string | null;
  position: number;
  owner_id: string | null;
  planned_start: string | null;
  planned_end: string | null;
  status: StageStatus;
  is_primary: boolean;
  created_at: string;
}

export interface StageTemplateItem {
  name: string;
  goal?: string | null;
  owner_id?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
}

export interface ProjectCreateInput {
  name: string;
  description?: string | null;
  stages?: StageTemplateItem[] | null;
}

export interface StageUpdateInput {
  name?: string;
  goal?: string | null;
  owner_id?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
}

export interface StageDeletePreview {
  message: string;
  impact: { tasks: number; deliverables: number };
  confirm_required: boolean;
}

// --- PRD-03: stage-based task types ---

export type StageTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'pending_verification' | 'done';
export type StageTaskPriority = 'urgent' | 'important' | 'normal' | 'low';

export interface TaskCreate {
  project_id: number;
  stage_id?: number | null;
  title: string;
  description?: string | null;
  status?: StageTaskStatus;
  priority?: StageTaskPriority;
  assignee?: string | null;
  planned_date?: string | null;
}

export interface TaskUpdate {
  title?: string;
  description?: string | null;
  status?: StageTaskStatus;
  priority?: StageTaskPriority;
  assignee?: string | null;
  planned_date?: string | null;
  position?: number;
  reason?: string | null;
  /** PRD-05：标记/取消验收必需 */
  acceptance_required?: boolean;
}

export interface TaskMoveRequest {
  target_stage_id?: number | null;
  reason?: string | null;
}

export interface StageTask {
  id: number;
  project_id: number;
  stage_id: number | null;
  title: string;
  description: string | null;
  status: StageTaskStatus;
  priority: StageTaskPriority;
  assignee: string | null;
  planned_date: string | null;
  position: number;
  /** PRD-05：是否为阶段验收必需项 */
  acceptance_required?: boolean;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

export interface MyTask extends StageTask {
  project_name: string;
  stage_name: string | null;
  overdue: boolean;
  blocked: boolean;
}

export interface ApiErrorShape {
  detail?: string | Array<{ msg?: string }> | StageDeletePreview;
  message?: string;
}

// --- PRD-04: task dependencies & blockers ---

export interface TaskDependency {
  id: number;
  task_id: number;
  dependency_id: number;
  created_by: string;
  created_at: string;
  /** 前置任务摘要（含 id/title/status） */
  dependency: { id: number; title: string; status: StageTaskStatus };
}

export interface TaskBlocker {
  id: number;
  task_id: number;
  reason: string;
  handler_id: string;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

export interface StageBlocker {
  id: number;
  stage_id: number;
  reason: string;
  handler_id: string;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

export interface TaskDependencyCreate {
  dependency_id: number;
  created_by?: string;
}

export interface BlockerCreate {
  reason: string;
  handler_id: string;
  created_by?: string;
}

export interface BlockerResolve {
  resolution: string;
}

export interface ConfirmBlockerInput {
  action: 'continue' | 'reblock';
  reason?: string;
  handler_id?: string;
}

// --- PRD-05: stage deliverables & acceptance ---

export type DeliverableType = 'document' | 'code' | 'deployment' | 'other';
export type DeliverableContentKind = 'text' | 'link' | 'file';
export type AcceptanceStatus = 'pending' | 'approved' | 'rejected';

export const deliverableTypeLabel: Record<DeliverableType, string> = {
  document: '文档',
  code: '代码',
  deployment: '部署产物',
  other: '其他',
};

export interface StageDeliverable {
  id: number;
  stage_id: number;
  name: string;
  type: DeliverableType;
  content_kind: DeliverableContentKind;
  text: string | null;
  link: string | null;
  file_name: string | null;
  file_size: number | null;
  file_url: string | null;
  submitted_by: string;
  submitted_at: string;
  is_required: boolean;
}

export interface StageDeliverableCreateInput {
  name: string;
  type: DeliverableType;
  content_kind: DeliverableContentKind;
  text?: string | null;
  link?: string | null;
  file_name?: string | null;
  file_url?: string | null;
}

export interface StageDeliverableUpdateInput {
  name?: string;
  type?: DeliverableType;
  content_kind?: DeliverableContentKind;
  text?: string | null;
  link?: string | null;
  file_name?: string | null;
  file_url?: string | null;
}

/** 提交验收被阻止时的三类明细（PRD-05） */
export interface AcceptanceBlockerDetail {
  incomplete_required_tasks: Array<{ id: number; title: string }>;
  missing_required_deliverables: Array<{ id: number; name: string }>;
  unresolved_stage_blockers: Array<{ id: number; reason: string }>;
}

export interface StageAcceptance {
  id: number;
  stage_id: number;
  status: AcceptanceStatus;
  submitted_by: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  note: string | null;
  rejection_reason: string | null;
  blockers?: AcceptanceBlockerDetail | null;
}

export interface StageAcceptanceReviewInput {
  action: 'approve' | 'reject';
  note?: string | null;
  rejection_reason?: string | null;
}

// --- PRD-06: project overview / risks / activities ---

export interface ProjectOverview {
  project: Project;
  overall_status: ProjectOverallStatus;
  primary_stage: Stage | null;
  parallel_stages: Stage[];
  metrics: {
    open_tasks: number;
    blocked_tasks: number;
    pending_acceptance_stages: number;
  };
}

export type RiskKind = 'stage_blocker' | 'task_blocker' | 'overdue_stage' | 'overdue_task';

export interface ProjectRisk {
  kind: RiskKind;
  severity: 'high' | 'medium';
  title: string;
  detail: string | null;
  owner_name: string | null;
  duration_days: number;
  overdue_days: number | null;
  stage_id: number | null;
  task_id: number | null;
  blocker_id: number | null;
}

export interface ProjectActivity {
  id: number;
  type: string;
  description: string;
  stage_id: number | null;
  stage_name: string | null;
  task_id: number | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  target_deleted: boolean;
}

// --- PRD-07: AI project copilot ---

/** AI 输出的最小单元：事实 / 推断 / 建议，可附带记录跳转链接 */
export interface CopilotItem {
  kind: 'fact' | 'inference' | 'suggestion';
  text: string;
  link_path: string | null;
  link_label: string | null;
}

export interface CopilotSummary {
  primary_stage: { name: string; status: StageStatus; owner_name: string | null } | null;
  parallel_stages: Array<{ name: string; owner_name: string | null }>;
  risks: CopilotItem[];
  actions: Array<{ order: number; text: string; reason: string; link_path: string | null }>;
  insufficient_data: boolean;
}

export interface CopilotStageAnalysis {
  has_risk: boolean;
  items: CopilotItem[];
}

export interface CopilotChatTurn {
  role: 'user' | 'assistant';
  content: string;
  links: Array<{ label: string; path: string }> | null;
}

export type CopilotRange = '24h' | '7d' | '30d';

export interface CopilotChanges {
  completed: CopilotItem[];
  unresolved: CopilotItem[];
  new_risks: CopilotItem[];
}

export interface CopilotTaskAdvice {
  task_id: number;
  task_title: string;
  reason: string;
  project_id: number;
  project_name: string;
  stage_id: number | null;
  stage_name: string | null;
  link_path: string;
}
