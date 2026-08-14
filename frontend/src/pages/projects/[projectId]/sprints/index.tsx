import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from '@umijs/max';
import { PlusOutlined, DownOutlined } from '@ant-design/icons';
import { PageHeader, Modal } from '@/components/common';
import { apiClient } from '@/services/api';
import { statusLabel, statusTone, formatRange, errorText, sprintPath } from '@/utils/format';
import { useAppContext } from '@/layouts/MainLayout';
import type { Sprint, SprintStatus } from '@/types';

export default function SprintListPage() {
  const ctx = useAppContext();
  const { projectId: pid } = useParams();
  const projectId = Number(pid) || ctx.projectId;
  const navigate = useNavigate();

  const sprints = ctx.sprints;
  const onToast = ctx.onToast;
  const onCreate = (sprint: Sprint) => {
    ctx.setSprints([sprint, ...ctx.sprints]);
    navigate(sprintPath(projectId, sprint.id));
  };

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
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
      onCreate(sprint);
      onToast('迭代已创建');
    } catch (error) {
      onToast(errorText(error));
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
            <PlusOutlined style={{ fontSize: 15 }} /> 新建迭代
          </button>
        }
      />
      <div className="sprint-list">
        {(['active', 'planning', 'completed'] as SprintStatus[]).map((status) => (
          <section key={status}>
            <div className="section-label">
              <span>{statusLabel[status]}</span>
              <em>{sprints.filter((item) => item.status === status).length}</em>
            </div>
            {sprints
              .filter((item) => item.status === status)
              .map((sprint) => (
                <button className="sprint-card" key={sprint.id} onClick={() => navigate(sprintPath(projectId, sprint.id))}>
                  <span className={`status-dot ${statusTone[status]}`} />
                  <span className="sprint-card-main">
                    <b>{sprint.name}</b>
                    <small>{formatRange(sprint)} · {sprint.goal || '暂无目标'}</small>
                  </span>
                  <span className="sprint-card-meta">
                    {sprint.initial_points} pt
                    <DownOutlined style={{ fontSize: 16 }} />
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
              迭代名称<input name="name" required placeholder="迭代 15" />
            </label>
            <label>
              目标<input name="goal" placeholder="本次迭代要达成什么？" />
            </label>
            <div className="form-grid">
              <label>
                开始日期<input name="start_date" type="date" required />
              </label>
              <label>
                结束日期<input name="end_date" type="date" required />
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
