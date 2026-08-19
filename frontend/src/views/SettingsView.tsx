import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { apiClient } from '../api';
import { useProjectMeta, useToast } from '../context';
import { errorText } from '../lib/format';
import { PageHeader } from '../components/shared/PageHeader';

/** 项目设置页：/projects/:projectId/settings */
export function SettingsView() {
  const { projectId, project, isOwner, refresh } = useProjectMeta();
  const { showToast } = useToast();
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [cycle, setCycle] = useState('2');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(project?.name || '');
    setDescription(project?.description || '');
  }, [project]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.updateProject(projectId, {
        name,
        description,
        default_sprint_weeks: Number(cycle) as 1 | 2,
      });
      await refresh();
      setDirty(false);
      showToast('项目设置已保存');
    } catch (error) {
      showToast(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="PROJECT SETTINGS"
        title="设置"
        copy="管理项目基本信息与默认迭代周期。"
      />
      <section className="panel settings-page">
        <form className="settings-form" onSubmit={save}>
          <div className="settings-section">
            <h2>基本信息</h2>
            <p>这些信息会显示在项目顶栏和工作区选择器中。</p>
            <label>
              项目名称
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setDirty(true);
                }}
                disabled={!isOwner}
              />
            </label>
            <label>
              项目描述
              <textarea
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setDirty(true);
                }}
                disabled={!isOwner}
              />
            </label>
          </div>
          <div className="settings-section">
            <h2>迭代默认周期</h2>
            <p>新建迭代时使用的默认时间长度。</p>
            <div className="segmented wide">
              <button
                type="button"
                className={cycle === '1' ? 'selected' : ''}
                onClick={() => {
                  setCycle('1');
                  setDirty(true);
                }}
              >
                1 周
              </button>
              <button
                type="button"
                className={cycle === '2' ? 'selected' : ''}
                onClick={() => {
                  setCycle('2');
                  setDirty(true);
                }}
              >
                2 周
              </button>
            </div>
          </div>
          {!isOwner && (
            <div className="permission-note">
              <Shield size={14} /> 只有项目 Owner 可以修改设置，当前字段为只读。
            </div>
          )}
          <div className="settings-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                if (dirty && !window.confirm('有未保存的修改，确定取消吗？')) return;
                setName(project?.name || '');
                setDescription(project?.description || '');
                setDirty(false);
              }}
            >
              取消
            </button>
            <button className="primary-btn" disabled={!isOwner || !dirty || saving}>
              {saving ? '保存中…' : '保存设置'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
