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
      <div className={classNames('flex items-center justify-center text-[11px] uppercase tracking-[0.14em] text-[#66766b]', className)} style={{ height }}>
        Loading chart…
      </div>
    );
  }
  if (empty) {
    return (
      <div className={classNames('flex flex-col items-center justify-center gap-2 text-center', className)} style={{ height }}>
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#66766b]">{emptyLabel}</span>
        <span className="max-w-xs text-[11px] leading-relaxed text-[#5f7065]">No reliable series is available for this view. Missing data is not filled or invented.</span>
      </div>
    );
  }
  return (
    <div className={className} style={{ height }}>
      <ReactECharts
        option={{
          backgroundColor: 'transparent',
          textStyle: { fontFamily: 'Inter Variable, Inter, sans-serif', color: '#5a6a5f' },
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
  axisLine: { lineStyle: { color: '#dce5d8' } },
  axisTick: { show: false },
  axisLabel: { color: '#5f7065', fontSize: 10 },
  splitLine: { lineStyle: { color: '#e8eee4' } },
};

export const chartTooltip = {
  trigger: 'axis' as const,
  backgroundColor: 'rgba(255,255,255,0.97)',
  borderColor: '#dce5d8',
  borderWidth: 1,
  textStyle: { color: '#142016', fontSize: 11 },
  extraCssText: 'border-radius:12px;box-shadow:0 20px 50px -30px rgba(23,42,29,.5)',
};
