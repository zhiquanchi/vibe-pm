import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, Flag, Pencil, Play, Plus, Shield, Trash2 } from 'lucide-react';
import { apiClient, ApiError, getUserId } from '../api';
import { useToast } from '../context';
import { errorText, formatDate } from '../lib/format';
import { stageStatusLabel, stageStatusTone } from '../lib/labels';
import { Modal } from '../components/shared/Modal';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/States';
import { StatusBadge } from '../components/shared/StatusBadge';
import type { ProjectMember, Stage, StageDeletePreview, StageTemplateItem } from '../types';

type StageModal =
  | { kind: 'add' }
  | { kind: 'edit'; stage: Stage }
  | { kind: 'delete'; stage: Stage; impact: { tasks: number; deliverables: number } }
  | { kind: 'start'; stage: Stage }
  | { kind: 'complete'; stage: Stage };

/** 阶段列表页：/projects/:projectId/stages */
export function StagesView() {
  const { projectId } = useParams();
  const routeProjectId = Number(projectId);
  const { showToast } = useToast();
  const [stages, setStages] = useState<Stage[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<StageModal | null>(null);
  const isOwner =
    members.find((member) => member.id === getUserId())?.role === 'owner' ||
    getUserId() === 'demo-user';
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [stageList, detail] = await Promise.all([
        apiClient.listStages(routeProjectId),
        apiClient.getProject(routeProjectId),
      ]);
      setStages(stageList);
      setMembers(detail.members);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [routeProjectId]);
  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      setModal(null);
      await load();
      showToast(message);
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const move = (stage: Stage, delta: number) => {
    const movable = stages.filter((item) => item.status !== 'completed');
    const index = movable.findIndex((item) => item.id === stage.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= movable.length) return;
    const ids = movable.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => apiClient.reorderStages(routeProjectId, ids), '阶段顺序已调整');
  };
  const remove = async (stage: Stage) => {
    try {
      await apiClient.deleteStage(routeProjectId, stage.id);
      await load();
      showToast('阶段已删除');
    } catch (err) {
      const detail =
        err instanceof ApiError ? (err.body as { detail?: unknown } | null)?.detail : null;
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        detail &&
        typeof detail === 'object' &&
        'confirm_required' in detail
      ) {
        const preview = detail as unknown as StageDeletePreview;
        setModal({ kind: 'delete', stage, impact: preview.impact });
        return;
      }
      showToast(errorText(err));
    }
  };
  const ownerName = (ownerId: string | null) =>
    ownerId
      ? members.find((member) => member.id === ownerId)?.name || ownerId
      : '未指定';
  const activeStages = stages.filter((item) => item.status === 'active');
  return (
    <>
      <PageHeader
        eyebrow="PROJECT STAGES"
        title="项目阶段"
        copy="按开发流程推进阶段，主阶段标识当前主要方向。"
        actions={
          <button
            className="primary-btn"
            disabled={!isOwner}
            title={!isOwner ? '只有项目负责人可以修改阶段结构' : undefined}
            onClick={() => setModal({ kind: 'add' })}
          >
            <Plus size={15} /> 新增阶段
          </button>
        }
      />
      {error ? (
        <ErrorState message={error} retry={load} />
      ) : loading ? (
        <LoadingState />
      ) : !stages.length ? (
        <EmptyState
          title="暂无阶段"
          copy="从新增阶段开始搭建项目开发流程。"
          action={
            isOwner ? (
              <button className="primary-btn" onClick={() => setModal({ kind: 'add' })}>
                <Plus size={15} /> 新增阶段
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="stage-list">
          {stages.map((stage) => (
            <div className={`stage-row ${stage.status}`} key={stage.id}>
              <span className="stage-pos">{stage.position + 1}</span>
              <div className="stage-main">
                <a
                  className="stage-name"
                  href={`/projects/${routeProjectId}/stages/${stage.id}`}
                >
                  {stage.name}
                </a>
                <small>{stage.goal || '暂无阶段目标'}</small>
              </div>
              <div className="stage-meta">
                <span>{ownerName(stage.owner_id)}</span>
                <small>
                  {stage.planned_start || stage.planned_end
                    ? `${formatDate(stage.planned_start)} - ${formatDate(stage.planned_end)}`
                    : '未排期'}
                </small>
              </div>
              <StatusBadge kind="stage" status={stage.status} dot />
              {stage.status === 'active' && (
                <span className={`role-tag ${stage.is_primary ? 'owner' : ''}`}>
                  {stage.is_primary ? '主阶段' : '并行阶段'}
                </span>
              )}
              <div className="stage-row-actions">
                {isOwner && stage.status !== 'completed' && (
                  <>
                    <button className="icon-btn" title="上移" onClick={() => move(stage, -1)}>
                      <ArrowUp size={14} />
                    </button>
                    <button className="icon-btn" title="下移" onClick={() => move(stage, 1)}>
                      <ArrowDown size={14} />
                    </button>
                  </>
                )}
                {isOwner && stage.status === 'planned' && (
                  <button
                    className="ghost-btn small"
                    onClick={() => setModal({ kind: 'start', stage })}
                  >
                    <Play size={13} /> 启动
                  </button>
                )}
                {isOwner && stage.status === 'active' && !stage.is_primary && (
                  <button
                    className="ghost-btn small"
                    onClick={() =>
                      void run(
                        () => apiClient.setPrimaryStage(routeProjectId, stage.id),
                        '主阶段已切换',
                      )
                    }
                  >
                    <Flag size={13} /> 设为主阶段
                  </button>
                )}
                {isOwner && stage.status === 'active' && (
                  <button
                    className="ghost-btn small"
                    onClick={() => setModal({ kind: 'complete', stage })}
                  >
                    <Check size={13} /> 完成
                  </button>
                )}
                {isOwner && (
                  <button
                    className="icon-btn"
                    title="编辑阶段"
                    onClick={() => setModal({ kind: 'edit', stage })}
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {isOwner && stage.status !== 'completed' && (
                  <button
                    className="icon-btn danger"
                    title="删除阶段"
                    onClick={() => void remove(stage)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {!isOwner && !loading && !error && (
        <p className="permission-note">
          <Shield size={14} /> 你是项目成员，只能查看阶段列表。
        </p>
      )}
      {modal && (modal.kind === 'add' || modal.kind === 'edit') && (
        <StageFormModal
          routeProjectId={routeProjectId}
          members={members}
          stage={modal.kind === 'edit' ? modal.stage : null}
          onClose={() => setModal(null)}
          reload={load}
          onToast={showToast}
        />
      )}
      {modal?.kind === 'delete' && (
        <Modal title="删除阶段" close={() => setModal(null)}>
          <div className="form-stack">
            <p>
              删除「{modal.stage.name}」将同时影响其中 <b>{modal.impact.tasks}</b> 个任务和{' '}
              <b>{modal.impact.deliverables}</b> 个交付物，确认删除？
            </p>
            <div className="form-grid">
              <button className="ghost-btn" onClick={() => setModal(null)}>
                取消
              </button>
              <button
                className="primary-btn danger"
                onClick={() =>
                  void run(
                    () => apiClient.deleteStage(routeProjectId, modal.stage.id, true),
                    '阶段已删除',
                  )
                }
              >
                确认删除
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal?.kind === 'start' && (
        <Modal title={`启动阶段「${modal.stage.name}」`} close={() => setModal(null)}>
          <div className="form-stack">
            <p>
              {activeStages.length
                ? '选择启动方式：主阶段是当前主要推进方向，并行阶段与主阶段同时推进。'
                : '这是项目首个启动的阶段，将自动成为主阶段。'}
            </p>
            <div className="form-grid">
              <button
                className="ghost-btn"
                disabled={!activeStages.length}
                onClick={() =>
                  void run(
                    () => apiClient.startStage(routeProjectId, modal.stage.id, false),
                    '阶段已启动为并行阶段',
                  )
                }
              >
                并行启动
              </button>
              <button
                className="primary-btn"
                onClick={() =>
                  void run(
                    () => apiClient.startStage(routeProjectId, modal.stage.id, true),
                    '阶段已启动',
                  )
                }
              >
                {activeStages.length ? '作为主阶段启动' : '启动（自动成为主阶段）'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal?.kind === 'complete' && (
        <StageCompleteModal
          routeProjectId={routeProjectId}
          stage={modal.stage}
          activeStages={activeStages}
          onClose={() => setModal(null)}
          onToast={showToast}
          reload={load}
        />
      )}
    </>
  );
}

function StageFormModal({
  routeProjectId,
  members,
  stage,
  onClose,
  reload,
  onToast,
}: {
  routeProjectId: number;
  members: ProjectMember[];
  stage: Stage | null;
  onClose: () => void;
  reload: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const input: StageTemplateItem = {
      name: String(form.get('name') || '').trim(),
      goal: String(form.get('goal') || '').trim() || null,
      owner_id: String(form.get('owner_id') || '') || null,
      planned_start: String(form.get('planned_start') || '') || null,
      planned_end: String(form.get('planned_end') || '') || null,
    };
    try {
      if (stage) await apiClient.updateStage(routeProjectId, stage.id, input);
      else await apiClient.addStage(routeProjectId, input);
      await reload();
      onClose();
      onToast(stage ? '阶段已更新' : '阶段已新增');
    } catch (err) {
      onToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };
  const completed = stage?.status === 'completed';
  return (
    <Modal title={stage ? `编辑阶段「${stage.name}」` : '新增阶段'} close={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label>
          阶段名称
          <input
            name="name"
            defaultValue={stage?.name || ''}
            required
            disabled={completed}
            title={completed ? '已完成阶段不能重命名' : undefined}
          />
        </label>
        <label>
          阶段目标
          <input name="goal" defaultValue={stage?.goal || ''} placeholder="这个阶段要达成什么？" />
        </label>
        <label>
          负责人
          <select name="owner_id" defaultValue={stage?.owner_id || ''}>
            <option value="">未指定</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} ({member.email})
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            计划开始
            <input
              name="planned_start"
              type="date"
              defaultValue={stage?.planned_start || ''}
            />
          </label>
          <label>
            计划结束
            <input name="planned_end" type="date" defaultValue={stage?.planned_end || ''} />
          </label>
        </div>
        <button className="primary-btn full" disabled={saving}>
          {saving ? '保存中…' : stage ? '保存修改' : '新增阶段'}
        </button>
      </form>
    </Modal>
  );
}

function StageCompleteModal({
  routeProjectId,
  stage,
  activeStages,
  onClose,
  onToast,
  reload,
}: {
  routeProjectId: number;
  stage: Stage;
  activeStages: Stage[];
  onClose: () => void;
  onToast: (message: string) => void;
  reload: () => Promise<void>;
}) {
  const others = activeStages.filter((item) => item.id !== stage.id);
  const needsSuccessor = stage.is_primary && others.length > 0;
  const [successor, setSuccessor] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (needsSuccessor && !successor) {
      onToast('完成主阶段需指定继任主阶段');
      return;
    }
    setSaving(true);
    try {
      await apiClient.completeStage(
        routeProjectId,
        stage.id,
        successor ? Number(successor) : undefined,
      );
      onClose();
      await reload();
      onToast('阶段已完成');
    } catch (err) {
      onToast(errorText(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={`完成阶段「${stage.name}」`} close={onClose}>
      <div className="form-stack">
        <p>
          {needsSuccessor
            ? '该阶段是主阶段，完成后需由其他活动阶段接任主阶段。'
            : '完成后阶段将转为已完成，不能删除或调整顺序。'}
        </p>
        {needsSuccessor && (
          <label>
            继任主阶段
            <select value={successor} onChange={(event) => setSuccessor(event.target.value)}>
              <option value="">请选择</option>
              {others.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="form-grid">
          <button className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button className="primary-btn" disabled={saving} onClick={() => void submit()}>
            {saving ? '提交中…' : '确认完成'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
