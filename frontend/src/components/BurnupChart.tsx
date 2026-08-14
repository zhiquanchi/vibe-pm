import { useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { ScopeChange, ScopeChangeType, SprintSnapshot } from '@/types';
import './BurnupChart.css';

const THEME_PURPLE = '#7056df';
const SCOPE_BLUE = '#3b82f6';
const IDEAL_GRAY = '#9ca3af';
const COMPLETED_GREEN = '#22c55e';
const REMAINING_RED = '#ef4444';

const changeTypeLabel = (type: ScopeChangeType): string => {
  switch (type) {
    case 'add_task': return '新增需求';
    case 'remove_task': return '移出需求';
    case 'change_points': return '调整点数';
    default: return '范围变更';
  }
};

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

export function BurnupChart({ snapshots, scopeChanges = [], initialPoints, className = '', onSelectChange }: BurnupChartProps) {
  const [mode, setMode] = useState<ChartMode>('burnup');
  const [hovered, setHovered] = useState<{ change: ScopeChange; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
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

  const option = useMemo<EChartsOption>(() => {
    const xData = points.map((point) => point.label);
    const seriesLabels: Record<string, string> = {
      scope: '范围',
      completed: '已完成',
      remaining: '剩余',
      ideal: '理想进度',
      idealRemaining: '理想剩余',
    };

    const changeSeries = {
      name: '范围变更',
      type: 'scatter' as const,
      symbolSize: 12,
      z: 10,
      data: markers.map(({ change, point }) => ({
        value: [point.label, mode === 'burnup' ? point.scope : point.remaining],
        itemStyle: {
          color: change.points_delta >= 0 ? REMAINING_RED : COMPLETED_GREEN,
          borderColor: '#fff',
          borderWidth: 2,
        },
        change,
      })),
      tooltip: { show: false },
    };

    const progressSeries = mode === 'burnup'
      ? [
          {
            name: 'completed',
            type: 'line' as const,
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 3, color: THEME_PURPLE },
            itemStyle: { color: THEME_PURPLE },
            areaStyle: { color: 'rgba(112, 86, 223, 0.18)' },
            data: points.map((point) => point.completed),
          },
          {
            name: 'scope',
            type: 'line' as const,
            step: 'end' as const,
            showSymbol: false,
            lineStyle: { width: 2.5, color: SCOPE_BLUE },
            itemStyle: { color: SCOPE_BLUE },
            data: points.map((point) => point.scope),
          },
          {
            name: 'ideal',
            type: 'line' as const,
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 1.5, color: IDEAL_GRAY, type: 'dashed' as const },
            itemStyle: { color: IDEAL_GRAY },
            data: points.map((point) => point.ideal),
          },
          changeSeries,
        ]
      : [
          {
            name: 'remaining',
            type: 'line' as const,
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 3, color: THEME_PURPLE },
            itemStyle: { color: THEME_PURPLE },
            data: points.map((point) => point.remaining),
          },
          {
            name: 'idealRemaining',
            type: 'line' as const,
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 1.5, color: IDEAL_GRAY, type: 'dashed' as const },
            itemStyle: { color: IDEAL_GRAY },
            data: points.map((point) => point.idealRemaining),
          },
          changeSeries,
        ];

    return {
      grid: { top: 12, right: 12, bottom: 0, left: 12, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#fff',
        borderColor: '#edf0f4',
        textStyle: { color: '#333', fontSize: 12 },
        formatter: (params) => {
          const items = Array.isArray(params) ? params : [params];
          const dateLabel = items[0]?.axisValue;
          let html = `<strong>${dateLabel ?? ''}</strong>`;
          for (const item of items) {
            if (item.seriesName === '范围变更') continue;
            const name = seriesLabels[item.seriesName as string] ?? item.seriesName;
            const value = typeof item.value === 'number' ? item.value : (Array.isArray(item.value) ? item.value[1] : '');
            html += `<div><span style="color:${item.color}">●</span> ${name} <b>${value ?? 0} pt</b></div>`;
          }
          return html;
        },
      },
      xAxis: {
        type: 'category',
        data: xData,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#8d96a5', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#8d96a5', fontSize: 11 },
        splitLine: { lineStyle: { color: '#edf0f4' } },
        minInterval: 1,
      },
      series: progressSeries as EChartsOption['series'],
    };
  }, [points, mode, markers]);

  const handleEvents = useMemo(() => ({
    click: (params: { seriesName?: string; data?: { change?: ScopeChange } }) => {
      if (params.seriesName === '范围变更' && params.data?.change) {
        onSelectChange?.(params.data.change);
      }
    },
    mouseover: (params: { seriesName?: string; data?: { change?: ScopeChange; value?: [string, number] }; event?: { offsetX: number; offsetY: number } }) => {
      if (params.seriesName === '范围变更' && params.data?.change && params.event) {
        setHovered({ change: params.data.change, x: params.event.offsetX, y: params.event.offsetY });
      }
    },
    mouseout: (params: { seriesName?: string }) => {
      if (params.seriesName === '范围变更') setHovered(null);
    },
  }), [onSelectChange]);

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
          <p>每日快照 · 悬停或点击变更点查看范围调整</p>
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

      <div className="burnup-chart-canvas" ref={canvasRef}>
        <ReactECharts
          option={option}
          notMerge
          style={{ height: 300, width: '100%' }}
          onEvents={handleEvents}
        />
        {hovered && (() => {
          const above = hovered.y > 130;
          return (
            <div
              className={`burnup-change-tip ${above ? 'above' : 'below'}`}
              style={{ left: hovered.x, top: hovered.y }}
              role="tooltip"
            >
              <div className="burnup-change-tip-head">
                <span className={`burnup-change-tag ${hovered.change.type}`}>{changeTypeLabel(hovered.change.type)}</span>
                <b className={hovered.change.points_delta >= 0 ? 'up' : 'down'}>{formatDelta(hovered.change.points_delta)}</b>
              </div>
              <p className="burnup-change-tip-desc">{hovered.change.description}</p>
              {hovered.change.reason && <p className="burnup-change-tip-reason">原因：{hovered.change.reason}</p>}
              <p className="burnup-change-tip-meta">{hovered.change.created_by} · {formatDate(hovered.change.created_at.slice(0, 10))}</p>
            </div>
          );
        })()}
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
