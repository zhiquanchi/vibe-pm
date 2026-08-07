import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ScopeChange, SprintSnapshot } from '../types';
import './BurnupChart.css';

type ChartMode = 'burnup' | 'burndown';

export interface BurnupChartProps {
  snapshots: SprintSnapshot[];
  scopeChanges?: ScopeChange[];
  /** Used when the first snapshot is missing an initial scope value. */
  initialPoints?: number;
  className?: string;
  onSelectChange?: (change: ScopeChange) => void;
}

interface ChartPoint {
  date: string;
  label: string;
  scope: number;
  completed: number;
  remaining: number;
  ideal: number;
  idealRemaining: number;
}

const formatDate = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

const formatDelta = (value: number) => `${value > 0 ? '+' : ''}${value} pt`;

function buildPoints(snapshots: SprintSnapshot[], initialPoints?: number): ChartPoint[] {
  const ordered = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  if (!ordered.length) return [];
  const startScope = initialPoints ?? ordered[0].total_scope;
  const endScope = ordered[ordered.length - 1].total_scope;
  const endRemaining = ordered[ordered.length - 1].remaining_points;
  const denominator = Math.max(ordered.length - 1, 1);

  return ordered.map((snapshot, index) => ({
    date: snapshot.snapshot_date.slice(0, 10),
    label: formatDate(snapshot.snapshot_date),
    scope: snapshot.total_scope,
    completed: snapshot.completed_points,
    remaining: snapshot.remaining_points,
    ideal: snapshot.ideal_completed ?? startScope + ((endScope - startScope) * index) / denominator,
    idealRemaining: snapshot.ideal_remaining ?? Math.max(startScope - (startScope * index) / denominator, endRemaining),
  }));
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const labels: Record<string, string> = {
    scope: '范围',
    completed: '已完成',
    remaining: '剩余',
    ideal: '理想进度',
    idealRemaining: '理想剩余',
  };
  return (
    <div className="burnup-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <div key={item.dataKey}>
          <span style={{ color: item.color }}>●</span>
          {labels[item.dataKey ?? ''] ?? item.dataKey}
          <b>{item.value ?? 0} pt</b>
        </div>
      ))}
    </div>
  );
}

export function BurnupChart({ snapshots, scopeChanges = [], initialPoints, className = '', onSelectChange }: BurnupChartProps) {
  const [mode, setMode] = useState<ChartMode>('burnup');
  const points = useMemo(() => buildPoints(snapshots, initialPoints), [snapshots, initialPoints]);
  const latest = points[points.length - 1];
  const first = points[0];
  const totalDelta = scopeChanges.reduce((sum, change) => sum + change.points_delta, 0);
  const increases = scopeChanges.filter((change) => change.points_delta > 0).reduce((sum, change) => sum + change.points_delta, 0);
  const decreases = scopeChanges.filter((change) => change.points_delta < 0).reduce((sum, change) => sum + change.points_delta, 0);
  const markers = useMemo(() => {
    const byDate = new Map(points.map((point) => [point.date, point]));
    return scopeChanges.map((change) => {
      const date = change.created_at.slice(0, 10);
      const point = byDate.get(date);
      if (!point) return null;
      return { change, point };
    }).filter((value): value is { change: ScopeChange; point: ChartPoint } => value !== null);
  }, [points, scopeChanges]);

  if (!points.length) {
    return (
      <section className={`burnup-chart ${className}`}>
        <div className="burnup-chart-empty">
          <span className="burnup-chart-empty-icon">图</span>
          <strong>暂无图表数据</strong>
          <p>迭代开始后，每日快照会自动显示在这里。</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`burnup-chart ${className}`}>
      <div className="burnup-chart-header">
        <div>
          <h2>范围与进度</h2>
          <p>每日快照 · 点击变更点查看范围调整</p>
        </div>
        <div className="burnup-chart-toggle" role="group" aria-label="图表类型">
          <button className={mode === 'burnup' ? 'active' : ''} onClick={() => setMode('burnup')} type="button">燃起图</button>
          <button className={mode === 'burndown' ? 'active' : ''} onClick={() => setMode('burndown')} type="button">燃尽图</button>
        </div>
      </div>

      <div className="burnup-chart-legend" aria-label="图例">
        {mode === 'burnup' ? <><span><i className="legend-line scope" />范围</span><span><i className="legend-line complete" />已完成</span></> : <span><i className="legend-line remaining" />实际剩余</span>}
        <span><i className="legend-line ideal" />理想进度</span>
        <span><i className="legend-dot" />范围变更</span>
      </div>

      <div className="burnup-chart-canvas">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: -18 }}>
            <defs><linearGradient id="burnup-completed-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.24} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#edf0f4" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8d96a5', fontSize: 11 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8d96a5', fontSize: 11 }} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            {mode === 'burnup' ? <>
              <Area type="monotone" dataKey="completed" stroke="none" fill="url(#burnup-completed-fill)" />
              <Line type="monotone" dataKey="completed" name="已完成" stroke="#22c55e" strokeWidth={3} dot={false} />
              <Line type="stepAfter" dataKey="scope" name="范围" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="ideal" name="理想进度" stroke="#9ca3af" strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
            </> : <>
              <Line type="monotone" dataKey="remaining" name="剩余" stroke="#ef4444" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="idealRemaining" name="理想剩余" stroke="#9ca3af" strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
            </>}
            {markers.map(({ change, point }) => <ReferenceDot key={change.id} x={point.label} y={mode === 'burnup' ? point.scope : point.remaining} r={5} fill={change.points_delta >= 0 ? '#ef4444' : '#22c55e'} stroke="#fff" strokeWidth={2} onClick={() => onSelectChange?.(change)} aria-label={`查看范围变更：${change.description}`} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="burnup-chart-summary">
        <div><span>当前范围</span><b>{latest.scope} pt</b></div>
        <div><span>已完成</span><b className="complete-text">{latest.completed} pt</b></div>
        <div><span>剩余</span><b>{latest.remaining} pt</b></div>
        <div><span>范围变更</span><b>{scopeChanges.length} 次</b><small>{formatDelta(increases)} / {formatDelta(decreases)}</small></div>
      </div>
      {first && totalDelta !== 0 && <p className="burnup-chart-note">相较初始范围，当前范围 {formatDelta(totalDelta)}。</p>}
    </section>
  );
}

export default BurnupChart;
