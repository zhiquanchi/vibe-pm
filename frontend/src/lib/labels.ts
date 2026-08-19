import type {
  ProjectOverallStatus,
  SprintStatus,
  StageStatus,
  StageTaskPriority,
  StageTaskStatus,
  TaskStatus,
} from "../types";

export const sprintStatusLabel: Record<SprintStatus, string> = {
  planning: "规划中",
  active: "进行中",
  completed: "已完成",
};
export const sprintStatusTone: Record<SprintStatus, string> = {
  planning: "planning",
  active: "active",
  completed: "completed",
};

export const stageStatusLabel: Record<StageStatus, string> = {
  planned: "未开始",
  active: "进行中",
  blocked: "受阻",
  pending_acceptance: "待验收",
  completed: "已完成",
};
export const stageStatusTone: Record<StageStatus, string> = {
  planned: "planning",
  active: "active",
  blocked: "blocked",
  pending_acceptance: "pending-acceptance",
  completed: "completed",
};

export const taskStatusWeight: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 0.5,
  in_review: 0.8,
  done: 1,
};

export const stageTaskStatusLabel: Record<StageTaskStatus, string> = {
  todo: "未开始",
  in_progress: "进行中",
  blocked: "受阻",
  pending_verification: "待确认",
  done: "已完成",
};
export const stageTaskPriorityLabel: Record<StageTaskPriority, string> = {
  urgent: "紧急",
  important: "重要",
  normal: "正常",
  low: "低",
};
export const stageTaskTransitions: Record<StageTaskStatus, StageTaskStatus[]> = {
  todo: ["in_progress"],
  in_progress: ["done", "blocked"],
  blocked: ["pending_verification"],
  pending_verification: ["done"],
  done: [],
};

export const projectOverallStatusLabel: Record<ProjectOverallStatus, string> = {
  planned: "未开始",
  active: "进行中",
  blocked: "受阻",
  pending_acceptance: "待验收",
  completed: "已完成",
};
export const projectOverallStatusTone: Record<ProjectOverallStatus, string> = {
  planned: "planning",
  active: "active",
  blocked: "blocked",
  pending_acceptance: "pending-acceptance",
  completed: "completed",
};

export const memberRoleLabel: Record<string, string> = {
  owner: "项目负责人",
  member: "成员",
  observer: "观察者",
};
export const memberRoleTone: Record<string, string> = {
  owner: "owner",
  member: "member",
  observer: "observer",
};
