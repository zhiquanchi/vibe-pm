import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { apiClient, ApiError, getUserId } from '../api';
import { AppShell } from './AppShell';
import { LoadingState } from '../components/shared/States';
import { PermissionDenied } from '../views/ErrorPages';
import { ProjectMetaContext, type ProjectMetaValue } from '../context/ProjectMetaContext';
import { errorText } from '../lib/format';
import { useToast } from '../context/ToastContext';
import type { Project, ProjectMember, ScopeChange, Sprint } from '../types';

type Notice = {
  id: string;
  type: 'scope' | 'start' | 'end';
  title: string;
  detail: string;
  sprintId: number;
  changeId?: number;
  read?: boolean;
};

/** /projects/:projectId 布局：加载项目元数据并注入 ProjectMetaContext。 */
export function ProjectLayout() {
  const params = useParams();
  const projectId = Number(params.projectId);
  const { showToast } = useToast();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const isOwner =
    members.find((member) => member.id === getUserId())?.role === 'owner' ||
    getUserId() === 'demo-user';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSprints, detail] = await Promise.all([
        apiClient.listSprints(),
        apiClient.getProject(projectId),
      ]);
      setForbidden(false);
      setSprints(nextSprints);
      setProject(detail.project);
      setMembers(detail.members);
      const recentChanges = (
        await Promise.all(
          nextSprints.map((sprint) =>
            apiClient.listScopeChanges(sprint.id).catch(() => []),
          ),
        )
      )
        .flat()
        .slice(0, 10);
      const nextNotices = nextSprints.reduce<Notice[]>((items, sprint) => {
        if (sprint.status === 'active')
          items.push({
            id: `start-${sprint.id}`,
            type: 'start',
            title: `${sprint.name} 正在进行`,
            detail: '迭代已开始，继续关注范围变化。',
            sprintId: sprint.id,
          });
        if (sprint.status === 'completed')
          items.push({
            id: `end-${sprint.id}`,
            type: 'end',
            title: `${sprint.name} 已结束`,
            detail: '迭代报告已准备好查看。',
            sprintId: sprint.id,
          });
        return items;
      }, []);
      recentChanges.forEach((change) =>
        nextNotices.push({
          id: `change-${change.id}`,
          type: 'scope',
          title: '迭代范围发生变化',
          detail: change.description,
          sprintId: change.sprint_id,
          changeId: change.id,
        }),
      );
      setNotices(nextNotices);
    } catch (error) {
      setForbidden(error instanceof ApiError && error.status === 403);
      showToast(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [projectId, showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addNotice = useCallback((change: ScopeChange, sprintId: number) => {
    setNotices((items) => [
      {
        id: `change-${change.id}`,
        type: 'scope',
        title: '迭代范围发生变化',
        detail: change.description,
        sprintId,
        changeId: change.id,
      },
      ...items,
    ]);
  }, []);

  const markNoticeRead = useCallback((id: string) => {
    setNotices((items) =>
      items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
  }, []);

  const value = useMemo<ProjectMetaValue>(
    () => ({
      projectId,
      project,
      members,
      sprints,
      isOwner,
      loading,
      refresh,
      addNotice,
    }),
    [projectId, project, members, sprints, isOwner, loading, refresh, addNotice],
  );

  if (forbidden) return <PermissionDenied />;
  return (
    <ProjectMetaContext.Provider value={value}>
      <AppShell
        project={project}
        notices={notices}
        isOwner={isOwner}
        onNoticeRead={markNoticeRead}
      >
        {loading && !project ? <LoadingState /> : <Outlet />}
      </AppShell>
    </ProjectMetaContext.Provider>
  );
}

/** 全局路由布局（我的任务 / 新建项目）：无项目上下文。 */
export function GlobalLayout() {
  return (
    <AppShell project={null} notices={[]} isOwner={false}>
      <Outlet />
    </AppShell>
  );
}
