import type {
  ProjectOverallStatus,
  SprintStatus,
  StageStatus,
  StageTaskPriority,
  StageTaskStatus,
} from "../../types";
import {
  projectOverallStatusLabel,
  projectOverallStatusTone,
  sprintStatusLabel,
  sprintStatusTone,
  stageStatusLabel,
  stageStatusTone,
  stageTaskPriorityLabel,
  stageTaskStatusLabel,
} from "../../lib/labels";

type BadgeStatus =
  | SprintStatus
  | StageStatus
  | StageTaskStatus
  | ProjectOverallStatus;

type BadgeKind = "sprint" | "stage" | "task" | "project";

function resolve(kind: BadgeKind, status: BadgeStatus) {
  switch (kind) {
    case "sprint":
      return {
        label: sprintStatusLabel[status as SprintStatus],
        tone: sprintStatusTone[status as SprintStatus],
      };
    case "stage":
      return {
        label: stageStatusLabel[status as StageStatus],
        tone: stageStatusTone[status as StageStatus],
      };
    case "project":
      return {
        label: projectOverallStatusLabel[status as ProjectOverallStatus],
        tone: projectOverallStatusTone[status as ProjectOverallStatus],
      };
    default:
      return {
        label: stageTaskStatusLabel[status as StageTaskStatus],
        tone: status as string,
      };
  }
}

/** 统一状态徽章：阶段 5 态 / 任务 5 态 / Sprint 3 态 / 项目整体 5 态。 */
export function StatusBadge({
  kind,
  status,
  dot = false,
}: {
  kind: BadgeKind;
  status: BadgeStatus;
  dot?: boolean;
}) {
  const { label, tone } = resolve(kind, status);
  return (
    <span className={`status-pill ${tone}`}>
      {dot && <i />} {label}
    </span>
  );
}

/** 优先级标签：紧急 / 重要 / 正常 / 低。 */
export function PriorityBadge({ priority }: { priority: StageTaskPriority }) {
  return (
    <span className={`role-tag priority-${priority}`}>
      {stageTaskPriorityLabel[priority]}
    </span>
  );
}
