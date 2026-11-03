import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { classNames } from '../lib/format';

export function Chart({
  option,
  height = 240,
  className,
  loading = false,
  empty = false,
  emptyLabel = 'INSUFFICIENT DATA',
}: {
  option: EChartsOption | Record<string, unknown>;
  height?: number;
  className?: string;
  loading?: boolean;
  empty?: boolean;
  emptyLabel?: string;
}) {
  if (loading) {
    return (
      <div className={classNames('flex items-center justify-center text-[11px] uppercase tracking-[0.14em] text-[#788493]', className)} style={{ height }}>
        Loading chart…
      </div>
    );
  }
  if (empty) {
    return (
      <div className={classNames('flex flex-col items-center justify-center gap-2 text-center', className)} style={{ height }}>
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#788493]">{emptyLabel}</span>
        <span className="max-w-xs text-[11px] leading-relaxed text-[#5f6b78]">No reliable series is available for this view. Missing data is not filled or invented.</span>
      </div>
    );
  }
  return (
    <div className={className} style={{ height }}>
      <ReactECharts
        option={{
          backgroundColor: 'transparent',
          textStyle: { fontFamily: 'Inter Variable, Inter, sans-serif', color: '#a2adba' },
          ...(option as EChartsOption),
        }}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}

export const chartGrid = {
  left: 40,
  right: 16,
  top: 24,
  bottom: 30,
  containLabel: true,
};

export const chartAxis = {
  axisLine: { lineStyle: { color: '#303945' } },
  axisTick: { show: false },
  axisLabel: { color: '#788493', fontSize: 10 },
  splitLine: { lineStyle: { color: '#252d37' } },
};

export const chartTooltip = {
  trigger: 'axis' as const,
  backgroundColor: '#202730',
  borderColor: '#303945',
  textStyle: { color: '#f3f5f7', fontSize: 11 },
  extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35)',
};
