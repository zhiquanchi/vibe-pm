import { useNavigate, useParams } from 'react-router-dom';
import BurnupChart from '../../components/BurnupChart';
import ScopeTimeline from '../../components/ScopeTimeline';
import { PageHeader } from '../../components/shared/PageHeader';
import { EmptyState, ErrorState } from '../../components/shared/States';
import { Metric } from '../../components/shared/Metric';
import { useProjectMeta, useToast } from '../../context';
import { useSprintWorkspace } from '../../hooks';
import { formatRange } from '../../lib/format';
import { sprintStatusLabel } from '../../lib/labels';

/** 兼容视图：迭代报告。支持 /reports 与 /reports/:sprintId 直连。 */
export function ReportsView() {
  const { projectId, sprints } = useProjectMeta();
  const navigate = useNavigate();
  const params = useParams();
  const routeSprintId = params.sprintId ? Number(params.sprintId) : null;
  const sprint =
    sprints.find((item) => item.id === routeSprintId) ||
    sprints.find((item) => item.status === 'active') ||
    null;
  const workspace = useSprintWorkspace(sprint?.id || null);
  const initial = sprint?.initial_points || 0;
  const final =
    workspace.snapshots[workspace.snapshots.length - 1]?.total_scope ??
    workspace.tasks.reduce((sum, task) => sum + task.story_points, 0);
  const done = workspace.tasks
    .filter((task) => task.status === 'done')
    .reduce((sum, task) => sum + task.story_points, 0);
  const copy = sprint
    ? `${sprint.name} 报告\n时间：${formatRange(sprint)}\n完成点数：${done} pt\n完成率：${final ? Math.round((done / final) * 100) : 0}%\n初始范围：${initial} pt\n最终范围：${final} pt\n范围净变化：${final - initial >= 0 ? '+' : ''}${final - initial} pt\n范围变更：${workspace.scopeChanges.length} 次`
    : '';
  return (
    <>
      <PageHeader
        eyebrow="迭代报告"
        title="迭代报告"
        copy="用数据复盘结果、范围和未完成工作。"
        actions={
          <>
            <select
              className="sprint-select"
              value={sprint?.id || ''}
              onChange={(event) =>
                navigate(`/projects/${projectId}/reports/${event.target.value}`)
              }
            >
              {sprints.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {sprintStatusLabel[item.status]}
                </option>
              ))}
            </select>
            <CopySummaryButton disabled={!sprint} copy={copy} />
          </>
        }
      />
      {workspace.error ? (
        <ErrorState message={workspace.error} retry={workspace.refresh} />
      ) : sprint ? (
        <>
          <section className="metrics">
            <Metric
              label="完成点数"
              value={`${done} pt`}
              note={`${final ? Math.round((done / final) * 100) : 0}% 完成率`}
              tone="green"
            />
            <Metric label="初始范围" value={`${initial} pt`} note="迭代开始时" tone="blue" />
            <Metric
              label="最终范围"
              value={`${final} pt`}
              note={`${final - initial >= 0 ? '+' : ''}${final - initial} pt 净变化`}
              tone="orange"
            />
            <Metric
              label="未完成任务"
              value={`${workspace.tasks.filter((task) => task.status !== 'done').length} 个`}
              note={sprint.status === 'completed' ? '已回到 Backlog' : '当前剩余工作'}
              tone="purple"
            />
          </section>
          <div className="report-chart panel">
            <BurnupChart
              snapshots={workspace.snapshots}
              scopeChanges={workspace.scopeChanges}
              initialPoints={sprint.initial_points}
            />
          </div>
          <ScopeTimeline changes={workspace.scopeChanges} />
        </>
      ) : (
        <EmptyState title="请选择一个迭代" copy="报告需要绑定具体迭代。" />
      )}
    </>
  );
}

function CopySummaryButton({ copy, disabled }: { copy: string; disabled: boolean }) {
  const { showToast } = useToast();
  return (
    <button
      className="ghost-btn"
      disabled={disabled}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(copy);
          showToast('迭代摘要已复制');
        } catch {
          showToast('复制失败，请检查浏览器权限');
        }
      }}
    >
      复制摘要
    </button>
  );
}
