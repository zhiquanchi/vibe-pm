import { useEffect, useState } from 'react';
import type React from 'react';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from '@umijs/max';
import { apiClient } from '@/services/api';
import { errorText } from '@/utils/format';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { useAppContext } from '@/layouts/MainLayout';
import type { StageTemplateItem } from '@/types';

function validateStages(stages: StageTemplateItem[]): string | null {
  if (!stages.length) return '项目必须至少保留一个阶段';
  const names = stages.map((item) => item.name.trim());
  if (names.some((name) => !name)) return '阶段名称不能为空';
  if (new Set(names).size !== names.length) return '同一项目内阶段名称不能重复';
  return null;
}

function LoadingState() {
  return <div className="state-panel"><ReloadOutlined className="spin" style={{ fontSize: 20 }} /><b>正在加载项目数据…</b></div>;
}

export default function ProjectCreatePage() {
  const ctx = useAppContext();
  const onToast = ctx.onToast;
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState<StageTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    apiClient.getStageTemplate()
      .then((items) => setStages(items.map((item) => ({ name: item.name }))))
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const validation = validateStages(stages);
  const update = (index: number, value: string) => setStages((items) => items.map((item, i) => (i === index ? { ...item, name: value } : item)));
  const move = (index: number, delta: number) => setStages((items) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (validation) { onToast(validation); return; }
    setSaving(true);
    try {
      const project = await apiClient.createProject({
        name: name.trim(),
        description: description.trim() || null,
        stages: stages.map((item) => ({ ...item, name: item.name.trim() })),
      });
      onToast('项目已创建');
      navigate(`/projects/${project.id}/stages`);
    } catch (err) {
      onToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return <>
    <PageHeader eyebrow="NEW PROJECT" title="新建项目" copy="从默认开发模板创建项目，创建前可调整阶段。" />
    {error
      ? <ErrorState message={error} retry={load} />
      : loading
        ? <LoadingState />
        : <section className="panel stage-create">
          <form className="form-stack" onSubmit={submit}>
            <label>项目名称<input value={name} onChange={(event) => setName(event.target.value)} required placeholder="例如：支付中台 2.0" /></label>
            <label>项目描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="这个项目要交付什么？" /></label>
            <div className="stage-edit-list">
              <div className="section-label"><span>项目阶段</span><em>{stages.length}</em></div>
              {stages.map((stage, index) => <div className="stage-edit-row" key={index}>
                <span className="stage-pos">{index + 1}</span>
                <input value={stage.name} onChange={(event) => update(index, event.target.value)} placeholder="阶段名称" />
                <div className="stage-row-actions">
                  <button type="button" className="icon-btn" title="上移" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUpOutlined style={{ fontSize: 14 }} /></button>
                  <button type="button" className="icon-btn" title="下移" disabled={index === stages.length - 1} onClick={() => move(index, 1)}><ArrowDownOutlined style={{ fontSize: 14 }} /></button>
                  <button type="button" className="icon-btn danger" title="删除阶段" onClick={() => setStages((items) => items.filter((_, i) => i !== index))}><DeleteOutlined style={{ fontSize: 14 }} /></button>
                </div>
              </div>)}
              <button type="button" className="ghost-btn" onClick={() => setStages((items) => [...items, { name: '' }])}><PlusOutlined style={{ fontSize: 14 }} /> 添加阶段</button>
            </div>
            {validation && <p className="permission-note"><QuestionCircleOutlined style={{ fontSize: 14 }} /> {validation}</p>}
            <button className="primary-btn full" disabled={saving || !!validation}>{saving ? '创建中…' : '创建项目'}</button>
          </form>
        </section>}
  </>;
}
