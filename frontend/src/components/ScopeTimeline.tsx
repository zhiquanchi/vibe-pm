import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Clock3, Inbox, Loader2, Minus, Pencil, Plus, UserRound } from 'lucide-react';
import type { ScopeChange, ScopeChangeType } from '../types';
import './ScopeTimeline.css';

export interface ScopeTimelineProps {
  /** 按时间倒序展示的范围变更；组件也会在渲染前再次排序。 */
  changes: ScopeChange[];
  loading?: boolean;
  /** true 使用默认提示，传字符串可自定义提示内容。 */
  capacityWarning?: boolean | string | null;
  onAddTask?: () => void;
  onRemoveTask?: (change: ScopeChange) => void;
  onChangePoints?: (change: ScopeChange) => void;
  onSelectChange?: (change: ScopeChange) => void;
  className?: string;
}

const typeMeta: Record<ScopeChangeType, { label: string; icon: typeof Plus; tone: string }> = {
  add_task: { label: '新增需求', icon: Plus, tone: 'add' },
  remove_task: { label: '移出需求', icon: Minus, tone: 'remove' },
  change_points: { label: '修改点数', icon: Pencil, tone: 'change' },
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function changeLabel(change: ScopeChange) {
  const meta = typeMeta[change.type];
  return meta?.label ?? '范围变更';
}

export function ScopeTimeline({
  changes,
  loading = false,
  capacityWarning = null,
  onAddTask,
  onRemoveTask,
  onChangePoints,
  onSelectChange,
  className = '',
}: ScopeTimelineProps) {
  const sortedChanges = [...changes].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const warningText = typeof capacityWarning === 'string' ? capacityWarning : '范围已增加，当前容量可能不足';

  return (
    <aside className={`scope-timeline ${className}`.trim()} aria-label="范围变更时间线">
      <div className="scope-timeline__header">
        <div>
          <h2>范围变更时间线</h2>
          <p>所有影响迭代范围的变化</p>
        </div>
        {onAddTask && (
          <button className="scope-timeline__add-button" type="button" onClick={onAddTask}>
            <Plus size={15} aria-hidden="true" />
            <span>新增需求</span>
          </button>
        )}
      </div>

      {capacityWarning && (
        <div className="scope-timeline__warning" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{warningText}</span>
        </div>
      )}

      {loading ? (
        <div className="scope-timeline__state" role="status">
          <Loader2 className="scope-timeline__spinner" size={20} aria-hidden="true" />
          <span>正在加载变更记录…</span>
        </div>
      ) : sortedChanges.length === 0 ? (
        <div className="scope-timeline__state">
          <Inbox size={22} aria-hidden="true" />
          <strong>暂无范围变更</strong>
          <span>新增或调整需求后，记录会显示在这里</span>
          {onAddTask && (
            <button type="button" className="scope-timeline__empty-action" onClick={onAddTask}>
              <Plus size={14} aria-hidden="true" /> 添加第一条需求
            </button>
          )}
        </div>
      ) : (
        <ol className="scope-timeline__list">
          {sortedChanges.map((change) => {
            const meta = typeMeta[change.type] ?? { label: '范围变更', icon: Clock3, tone: 'change' };
            const Icon = meta.icon;
            const isPositive = change.points_delta > 0;
            const deltaClass = isPositive ? 'positive' : change.points_delta < 0 ? 'negative' : 'neutral';

            return (
              <li className="scope-timeline__item" key={change.id}>
                <div className={`scope-timeline__marker scope-timeline__marker--${meta.tone}`} aria-hidden="true">
                  <Icon size={13} strokeWidth={2.5} />
                </div>
                <button
                  type="button"
                  className="scope-timeline__entry"
                  onClick={() => onSelectChange?.(change)}
                  aria-label={`${changeLabel(change)}：${change.description}`}
                >
                  <div className="scope-timeline__meta">
                    <time dateTime={change.created_at}>{formatDate(change.created_at)}</time>
                    <span className={`scope-timeline__delta scope-timeline__delta--${deltaClass}`}>
                      {change.points_delta > 0 ? '+' : ''}{change.points_delta} pt
                    </span>
                  </div>
                  <div className="scope-timeline__title-row">
                    <strong>{change.description}</strong>
                    <span className={`scope-timeline__type scope-timeline__type--${meta.tone}`}>{meta.label}</span>
                  </div>
                  {change.reason && <p className="scope-timeline__reason">原因：{change.reason}</p>}
                  <p className="scope-timeline__author"><UserRound size={12} aria-hidden="true" /> 操作人：{change.created_by || '未知'}</p>
                </button>
                {(change.type === 'remove_task' && onRemoveTask) || (change.type === 'change_points' && onChangePoints) ? (
                  <div className="scope-timeline__actions">
                    {change.type === 'remove_task' && onRemoveTask && (
                      <button type="button" onClick={() => onRemoveTask(change)}>移出迭代</button>
                    )}
                    {change.type === 'change_points' && onChangePoints && (
                      <button type="button" onClick={() => onChangePoints(change)}>修改点数</button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {!loading && sortedChanges.length > 0 && (
        <div className="scope-timeline__footer">
          <span><ArrowUpRight size={13} aria-hidden="true" /> 增加</span>
          <span><ArrowDownLeft size={13} aria-hidden="true" /> 减少</span>
          <span>{sortedChanges.length} 条记录</span>
        </div>
      )}
    </aside>
  );
}

export default ScopeTimeline;
