import { useEffect, useState } from 'react';
import { Archive, Plus, Search } from 'lucide-react';
import { apiClient } from '../../api';
import { useProjectMeta, useToast } from '../../context';
import { errorText, formatDate } from '../../lib/format';
import { Modal } from '../../components/shared/Modal';
import { PageHeader } from '../../components/shared/PageHeader';
import { EmptyState } from '../../components/shared/States';
import type { Task } from '../../types';

/** 兼容视图：Backlog（Sprint 模型待规划任务）。 */
export function BacklogView() {
  const { projectId, sprints, refresh } = useProjectMeta();
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const load = () =>
    apiClient
      .listBacklog(projectId)
      .then(setTasks)
      .catch((error) => showToast(errorText(error)));
  useEffect(() => {
    void load();
  }, [projectId]);
  const filtered = tasks.filter(
    (task) =>
      task.title.toLowerCase().includes(query.toLowerCase()) &&
      (priority === 'all' || task.priority === priority) &&
      (assignee === 'all' || (task.assignee || '未分配') === assignee),
  );
  const assignees = [...new Set(tasks.map((task) => task.assignee || '未分配'))];
  const addSelected = async () => {
    const target = sprints.find((item) => item.status === 'planning');
    if (!target) {
      showToast('请先新建一个规划中的迭代');
      return;
    }
    try {
      for (const id of selected)
        await apiClient.addTaskToSprint(target.id, id, '从 Backlog 规划加入');
      setSelected([]);
      await load();
      await refresh();
      showToast(`已将 ${selected.length} 个任务加入 ${target.name}`);
    } catch (error) {
      showToast(errorText(error));
    }
  };
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiClient.createTask({
        project_id: projectId,
        sprint_id: null,
        title: String(form.get('title')),
        story_points: Number(form.get('points')) as 1 | 2 | 3 | 5 | 8 | 13,
        priority: String(form.get('priority')) as Task['priority'],
        assignee: String(form.get('assignee') || '') || null,
      });
      await load();
      setOpen(false);
      showToast('Backlog 任务已创建');
    } catch (error) {
      showToast(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="PRODUCT BACKLOG"
        title="Backlog"
        copy="管理尚未进入迭代的任务，并规划下一次迭代。"
        actions={
          <button className="primary-btn" onClick={() => setOpen(true)}>
            <Plus size={15} /> 创建任务
          </button>
        }
      />
      <section className="panel backlog-page">
        <div className="filter-bar">
          <label className="search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="按标题搜索"
            />
          </label>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="all">全部优先级</option>
            {['P0', 'P1', 'P2', 'P3'].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="all">全部负责人</option>
            {assignees.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <button
            className="ghost-btn"
            disabled={!selected.length}
            onClick={() => void addSelected()}
          >
            <Archive size={14} /> 加入规划中的迭代 ({selected.length})
          </button>
        </div>
        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>任务</th>
                  <th>故事点</th>
                  <th>优先级</th>
                  <th>负责人</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(task.id)}
                        onChange={(event) =>
                          setSelected((items) =>
                            event.target.checked
                              ? [...items, task.id]
                              : items.filter((id) => id !== task.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <b>{task.title}</b>
                      <small>{task.description || '暂无描述'}</small>
                    </td>
                    <td>{task.story_points} pt</td>
                    <td>
                      <span className={`priority p-${task.priority}`}>
                        {task.priority}
                      </span>
                    </td>
                    <td>{task.assignee || '未分配'}</td>
                    <td>{formatDate(task.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Backlog 为空"
            copy="创建第一个待规划任务，开始组织下一次迭代。"
            action={
              <button className="primary-btn" onClick={() => setOpen(true)}>
                <Plus size={15} /> 创建任务
              </button>
            }
          />
        )}
      </section>
      {open && (
        <Modal title="创建 Backlog 任务" close={() => setOpen(false)}>
          <form className="form-stack" onSubmit={create}>
            <label>
              任务标题
              <input name="title" required />
            </label>
            <div className="form-grid">
              <label>
                故事点
                <select name="points" defaultValue="3">
                  {[1, 2, 3, 5, 8, 13].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                优先级
                <select name="priority" defaultValue="P2">
                  {['P0', 'P1', 'P2', 'P3'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              负责人
              <input name="assignee" placeholder="姓名或缩写" />
            </label>
            <button className="primary-btn full" disabled={saving}>
              {saving ? '创建中…' : '创建任务'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
