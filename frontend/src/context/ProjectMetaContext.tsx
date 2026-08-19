import { createContext, useContext } from "react";
import type { Project, ProjectMember, ScopeChange, Sprint } from "../types";

/** 项目路由布局注入的共享元数据：所有 /projects/:projectId 下的视图可用。 */
export interface ProjectMetaValue {
  projectId: number;
  project: Project | null;
  members: ProjectMember[];
  sprints: Sprint[];
  isOwner: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  addNotice: (change: ScopeChange, sprintId: number) => void;
}

export const ProjectMetaContext = createContext<ProjectMetaValue | null>(null);

export function useProjectMeta(): ProjectMetaValue {
  const value = useContext(ProjectMetaContext);
  if (!value) throw new Error("useProjectMeta 必须在项目路由布局内使用");
  return value;
}
