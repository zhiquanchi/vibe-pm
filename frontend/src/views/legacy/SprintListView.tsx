import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Plus } from 'lucide-react';
import { apiClient } from '../../api';
import { useProjectMeta, useToast } from '../../context';
import { sprintStatusLabel, sprintStatusTone } from '../../lib/labels';
import { errorText, formatRange } from '../../lib/format';
import { Modal } from '../../components/shared/Modal';
import { PageHeader } from '../../components/shared/PageHeader';
import type { Sprint, SprintStatus } from '../../types';

/** 兼容视图：迭代列表（Sprint 模型）。 */
export function SprintListView() {
  const { projectId, sprints, refresh } = useProjectMeta();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const sprint = await apiClient.createSprint({
        project_id: projectId,
        name: String(form.get('name')),
        goal: String(form.get('goal') || ''),
        start_date: String(form.get('start_date')),
        end_date: String(form.get('end_date')),
      });
      await refresh();
      navigate(`/projects/${projectId}/sprints/${sprint.id}`);
      showToast('迭代已创建');
    } catch (error) {
      showToast(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="ITERATIONS"
        title="迭代"
        copy="切换历史迭代，或规划下一次交付。"
        actions={
          <button className="primary-btn" onClick={() => setOpen(true)}>
            <Plus size={15} /> 新建迭代
          </button>
        }
      />
      <div className="sprint-list">
        {(['active', 'planning', 'completed'] as SprintStatus[]).map((status) => (
          <section key={status}>
            <div className="section-label">
              <span>{sprintStatusLabel[status]}</span>
              <em>{sprints.filter((item) => item.status === status).length}</em>
            </div>
            {sprints
              .filter((item) => item.status === status)
              .map((sprint: Sprint) => (
                <button
                  className="sprint-card"
                  key={sprint.id}
                  onClick={() => navigate(`/projects/${projectId}/sprints/${sprint.id}`)}
                >
                  <span className={`status-dot ${sprintStatusTone[status]}`} />
                  <span className="sprint-card-main">
                    <b>{sprint.name}</b>
                    <small>
                      {formatRange(sprint)} · {sprint.goal || '暂无目标'}
                    </small>
                  </span>
                  <span className="sprint-card-meta">
                    {sprint.initial_points} pt
                    <ChevronDown size={16} />
                  </span>
                </button>
              ))}
          </section>
        ))}
      </div>
      {open && (
        <Modal title="新建迭代" close={() => setOpen(false)}>
          <form className="form-stack" onSubmit={submit}>
            <label>
              迭代名称
              <input name="name" required placeholder="迭代 15" />
            </label>
            <label>
              目标
              <input name="goal" placeholder="本次迭代要达成什么？" />
            </label>
            <div className="form-grid">
              <label>
                开始日期
                <input name="start_date" type="date" required />
              </label>
              <label>
                结束日期
                <input name="end_date" type="date" required />
              </label>
            </div>
            <button className="primary-btn full" disabled={saving}>
              {saving ? '创建中…' : '创建迭代'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

/** 供路由解析 sprintId 使用。 */
export function useRouteSprintId() {
  const { sprintId } = useParams();
  return sprintId ? Number(sprintId) : null;
}
