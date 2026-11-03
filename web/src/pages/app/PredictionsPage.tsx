import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Layers3,
  LineChart as LineChartIcon,
  ShieldAlert,
  Sparkles,
  Wind,
} from 'lucide-react';
import { Chart, chartAxis, chartGrid, chartTooltip } from '../../components/Chart';
import { RiskBadge } from '../../components/Status';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, EmptyState, LoadingBlock, ProgressBar, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, number } from '../../lib/format';

interface PredictionData {
  detail: {
    station: { id: string; name: string; code: string; localityName: string | null; isSimulated: boolean; healthStatus: string; latestObservedAt: string | null; aqi?: { aqi: number | null; category: string } | null };
    current: { value: number; unit: string; observedAt: string; qualityState: string; sourceId: string; isSimulated: boolean } | null;
    forecasts: Array<{ horizonHours: number; predictedValue: number; lowerBound: number; upperBound: number; method: string; confidence: string; targetTime: string; currentValue: number; intervalNote: string; trendPerHour: number }>;
    history: Array<{ observedAt: string; value: number }>;
    anomaly: { status: string; zScore: number | null; latest: number | null; mean: number | null; sd: number | null; method: string };
    criteria: { threshold: number; unit: string; averaging: string; current: number | null; forecast3h: number | null; persistence: number; predictiveWarningMet: boolean; deteriorationProbability: number | null; note: string };
    risk: { risk_score: number | null; risk_level: string; confidence_score: number | null; confidence_level: string; alert_state: string; method: string; calculated_at: string } | null;
    modelStatus: string;
    method: string;
    intervals: string;
    shap: string;
    shapValues: Array<{ feature: string; contribution: number }>;
    forecastLimitations: string[];
    modelVersion: string | null;
    forecastPerformance: { status: string; reason: string };
  } | null;
  stations: Array<{ id: string; name: string; locality: string; pm25: number | null; aqi: number | null; isSimulated: boolean }>;
  models: Array<{ id: string; name: string; version: string; target: string; horizon_hours: number | null; model_type: string; status: string; metrics: unknown; trained_at: string | null; notes: string }>;
  externalContext: { cams: Array<{ locality_name: string; pollutant_code: string; value: number; unit: string; observed_at: string }> };
  status: { trainedModels: string; reason: string; available: string; shap: string; quantileIntervals: string; deteriorationClassifier: string; anomalyDetector: string; modelVersion?: string | null };
  generatedAt: string;
}

export function PredictionsPage() {
  const [data, setData] = useState<PredictionData | null>(null);
  const [stationId, setStationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = (id?: string) => {
    setLoading(true);
    const query = id ? `?stationId=${id}` : '';
    api
      .get<PredictionData>(`/predictions${query}`)
      .then((result) => {
        setData(result);
        setStationId(result.detail?.station.id ?? '');
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load predictions'))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const chartOption = useMemo(() => {
    if (!data?.detail) return {};
    const history = data.detail.history.slice(-36);
    const forecast = data.detail.forecasts;
    const times = [
      ...history.map((h) => new Date(h.observedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })),
      ...forecast.map((f) => new Date(f.targetTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })),
    ];
    const historyValues = [...history.map((h) => h.value), ...forecast.map(() => null)];
    const median = [...history.map(() => null), ...forecast.map((f) => f.predictedValue)];
    const lower = [...history.map(() => null), ...forecast.map((f) => f.lowerBound)];
    const upper = [...history.map(() => null), ...forecast.map((f) => f.upperBound)];
    return {
      grid: { ...chartGrid, top: 40, right: 20 },
      tooltip: chartTooltip,
      legend: { top: 0, textStyle: { color: '#6f7f74', fontSize: 10 } },
      xAxis: { type: 'category', data: times, ...chartAxis, axisLabel: { ...chartAxis.axisLabel, interval: Math.max(1, Math.floor(times.length / 8)) } },
      yAxis: { type: 'value', name: 'µg/m³', nameTextStyle: { color: '#6f7f74', fontSize: 10 }, ...chartAxis },
      series: [
        {
          name: 'Observed (demo)',
          type: 'line',
          data: historyValues,
          symbol: 'none',
          lineStyle: { color: '#5b9e46', width: 2 },
          areaStyle: { color: 'rgba(91,158,70,0.06)' },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: 60, label: { formatter: '24h NAAQS 60', color: '#c94a50', fontSize: 9 }, lineStyle: { color: '#c94a50', type: 'dashed', opacity: 0.5 } }],
          },
        },
        { name: data.detail?.method === 'LIGHTGBM_TRAINED' ? 'Model median' : 'Baseline median', type: 'line', data: median, symbol: 'circle', symbolSize: 5, lineStyle: { color: '#2f8f84', width: 2, type: 'dashed' }, itemStyle: { color: '#2f8f84' } },
        { name: 'Lower band', type: 'line', data: lower, symbol: 'none', lineStyle: { color: 'rgba(47,143,132,0.35)', width: 1, type: 'dotted' } },
        { name: 'Upper band', type: 'line', data: upper, symbol: 'none', lineStyle: { color: 'rgba(47,143,132,0.35)', width: 1, type: 'dotted' } },
      ],
    };
  }, [data]);

  const progressionOption = useMemo(() => {
    if (!data?.detail) return {};
    const current = data.detail.current?.value ?? 0;
    const values = [current, ...data.detail.forecasts.map((f) => f.predictedValue)];
    return {
      grid: { ...chartGrid, top: 24 },
      tooltip: chartTooltip,
      xAxis: { type: 'category', data: ['Now', '+1h', '+3h', '+6h'], ...chartAxis },
      yAxis: { type: 'value', name: 'µg/m³', nameTextStyle: { color: '#6f7f74', fontSize: 10 }, ...chartAxis },
      series: [
        {
          type: 'bar',
          data: values.map((value, index) => ({ value, itemStyle: { color: index === 0 ? '#5b9e46' : '#2f8f84', borderRadius: [5, 5, 0, 0], opacity: index === 0 ? 1 : 0.7 } })),
          barWidth: '45%',
          label: { show: true, position: 'top', color: '#5a6a5f', fontSize: 10 },
        },
      ],
    };
  }, [data]);

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading predictive intelligence" />;
  if (error || !data) {
    return <EmptyState title="Predictions unavailable" description={error ?? 'Could not load predictions.'} icon={<AlertTriangle className="h-5 w-5" />} action={<Button variant="lime" onClick={() => load()}>Retry</Button>} />;
  }

  const detail = data.detail;
  const trained = detail?.method === 'LIGHTGBM_TRAINED';
  const alertState = detail?.risk?.alert_state ?? 'NORMAL';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={trained ? 'green' : data.status.trainedModels === 'UNAVAILABLE' ? 'amber' : 'amber'} dot>
              {trained ? `Trained model · ${detail?.modelVersion ?? data.status.modelVersion ?? 'registered'}` : data.status.trainedModels === 'UNAVAILABLE' ? 'ML service unavailable' : 'ML models not trained'}
            </Badge>
            <Badge tone={trained ? 'teal' : 'teal'}>{trained ? 'LightGBM forecasts' : 'Persistence baseline'}</Badge>
            <Badge tone="neutral">{trained ? 'Quantile 10–90' : 'Intervals not calibrated'}</Badge>
          </div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Predictive environmental intelligence</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6f7f74]">
            Air pollution is the primary predictive application.{' '}
            {trained
              ? 'A registered LightGBM model is active. Forecasts and quantile intervals come from that model; the model card and metrics must be reviewed before operational use.'
              : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={stationId} onChange={(e) => { setStationId(e.target.value); load(e.target.value); }} className="h-9 w-[240px] text-[11px]">
            {data.stations.map((station) => <option key={station.id} value={station.id}>{station.name.replace(' demo air monitor', '')} · PM2.5 {station.pm25 ?? '—'}</option>)}
          </Select>
          <Link to="/map"><Button variant="dark" size="sm">Map <ArrowUpRight className="h-3.5 w-3.5" /></Button></Link>
        </div>
      </div>

      {detail ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-[#5b9e46]/20 bg-[#5b9e46]/[0.04] p-4">
              <div className="flex items-center justify-between"><DataLabel>Current observed PM2.5</DataLabel><Badge tone={detail.station.isSimulated ? 'amber' : 'green'}>{detail.station.isSimulated ? 'Demo' : 'Source'}</Badge></div>
              <p className="display mt-3 text-[34px] font-bold">{detail.current ? number(detail.current.value) : '—'} <span className="text-sm font-normal text-[#6f7f74]">µg/m³</span></p>
              <p className="mt-1 text-[10px] text-[#6f7f74]">{formatDate(detail.current?.observedAt)} · {detail.current?.qualityState}</p>
              <p className="mt-2 text-[9px] text-[#66766b]">{detail.current?.isSimulated ? 'SIMULATION DATA — not a CPCB reading' : `Connected source · ${detail.current?.sourceId ?? ''}`}</p>
            </Card>
            {[1, 3, 6].map((horizon) => {
              const forecast = detail.forecasts.find((f) => f.horizonHours === horizon);
              return (
                <Card key={horizon} className="p-4">
                  <div className="flex items-center justify-between"><DataLabel>+{horizon} hour forecast</DataLabel><Badge tone="teal">{trained ? 'LightGBM' : 'Baseline'}</Badge></div>
                  <p className="display mt-3 text-[30px] font-bold">{forecast ? number(forecast.predictedValue) : '—'} <span className="text-sm font-normal text-[#6f7f74]">µg/m³</span></p>
                  <p className="mt-1 text-[10px] text-[#6f7f74]">{trained ? 'Quantile 10–90' : '80% band'} {forecast ? `${number(forecast.lowerBound)}–${number(forecast.upperBound)}` : 'unavailable'}</p>
                  <div className="mt-3"><ProgressBar value={forecast ? Math.min(100, (forecast.predictedValue / 100) * 100) : 0} tone={forecast && forecast.predictedValue >= 60 ? '#cf7227' : '#2f8f84'} /></div>
                  <p className="mt-2 text-[9px] text-[#66766b]">{forecast?.method ?? 'FORECAST UNAVAILABLE'}</p>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
            <Card>
              <CardHeader>
                <div><CardTitle>Historical observations vs baseline forecast</CardTitle><p className="mt-1 text-[10px] text-[#66766b]">Stored demo observations · dashed median · dotted empirical band · not a calibrated prediction interval</p></div>
                <Badge tone="amber">Not trained</Badge>
              </CardHeader>
              <div className="px-2 pb-2 pt-3"><Chart height={320} empty={detail.history.length === 0} option={chartOption} /></div>
            </Card>
            <Card>
              <CardHeader><CardTitle>Pollution progression</CardTitle><Badge tone="teal">Baseline</Badge></CardHeader>
              <div className="px-2 pb-3 pt-2"><Chart height={320} empty={detail.forecasts.length === 0} option={progressionOption} /></div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Predictive warning decision</CardTitle><RiskBadge level={alertState} /></CardHeader>
              <div className="p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-[11px]"><span className="text-[#6f7f74]">Threshold</span><span className="font-semibold text-[#1b2a1f]">{detail.criteria.threshold} {detail.criteria.unit}</span></div>
                  <div className="flex items-center justify-between text-[11px]"><span className="text-[#6f7f74]">Averaging basis</span><span className="font-semibold text-[#1b2a1f]">{detail.criteria.averaging}</span></div>
                  <div className="flex items-center justify-between text-[11px]"><span className="text-[#6f7f74]">+3h baseline</span><span className="font-semibold text-[#1b2a1f]">{detail.criteria.forecast3h ?? '—'} µg/m³</span></div>
                  <div className="flex items-center justify-between text-[11px]"><span className="text-[#6f7f74]">Persistence readings</span><span className="font-semibold text-[#1b2a1f]">{detail.criteria.persistence} / 6</span></div>
                  <div className="flex items-center justify-between text-[11px]"><span className="text-[#6f7f74]">Deterioration probability</span><span className="font-semibold text-amber-600">{detail.criteria.deteriorationProbability === null ? 'NOT AVAILABLE' : `${Math.round(detail.criteria.deteriorationProbability * 100)}%`}</span></div>
                  <div className={`rounded-xl border p-3 text-[10px] leading-relaxed ${detail.criteria.predictiveWarningMet ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-700/80' : 'border-[#dfe6db] bg-[#f5f8f2] text-[#6f7f74]'}`}>
                    {detail.criteria.predictiveWarningMet ? 'Configured baseline criteria are met. This is an analytical early warning, not a confirmed future condition or a violation.' : 'Configured baseline criteria are not met. No predictive warning is raised from this method.'}
                  </div>
                </div>
                <p className="mt-3 text-[9px] leading-relaxed text-[#66766b]">{detail.criteria.note}</p>
              </div>
            </Card>
            <Card>
              <CardHeader><CardTitle>Risk & confidence</CardTitle><RiskBadge level={detail.risk?.risk_level ?? 'UNKNOWN'} /></CardHeader>
              <div className="p-4">
                {detail.risk ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div><DataLabel>Risk score</DataLabel><p className="mt-1 text-3xl font-semibold">{detail.risk.risk_score ?? '—'}</p><p className="text-[9px] text-[#66766b]">out of 100</p></div>
                      <div><DataLabel>Confidence</DataLabel><p className="mt-1 text-3xl font-semibold">{detail.risk.confidence_score ?? '—'}</p><p className="text-[9px] text-[#66766b]">{detail.risk.confidence_level}</p></div>
                    </div>
                    <p className="mt-3 text-[10px] leading-relaxed text-[#6f7f74]">{detail.risk.method}</p>
                    <p className="mt-2 text-[9px] text-[#66766b]">Calculated {formatDate(detail.risk.calculated_at)}. Confidence is separate from severity.</p>
                  </>
                ) : <p className="text-[11px] text-[#6f7f74]">No risk assessment available.</p>}
                <div className="mt-4 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                  <DataLabel>Anomaly check</DataLabel>
                  <p className="mt-1 text-sm font-semibold">{detail.anomaly.status}</p>
                  <p className="mt-1 text-[9px] text-[#66766b]">z = {detail.anomaly.zScore ?? '—'} · {detail.anomaly.method}</p>
                </div>
              </div>
            </Card>
            <Card>
              <CardHeader><CardTitle>Explainability</CardTitle><Badge tone="neutral">Not available</Badge></CardHeader>
              <div className="p-4">
                {trained && detail.shapValues.length ? (
                  <>
                    <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="h-4 w-4" /><p className="text-[11px] font-semibold">SHAP computed by the registered model</p></div>
                    <div className="mt-3 space-y-1.5">
                      {detail.shapValues.slice(0, 8).map((item) => (
                        <div key={item.feature} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="truncate text-[#5a6a5f]">{item.feature}</span>
                          <span className={item.contribution >= 0 ? 'text-amber-600' : 'text-teal-600'}>{item.contribution >= 0 ? '+' : ''}{item.contribution.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[9px] leading-relaxed text-[#66766b]">SHAP contribution to the +3h prediction. Positive values push the forecast higher.</p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-[#66766b]"><CircleSlash className="h-4 w-4" /><p className="text-[11px] font-semibold text-[#5f6f64]">SHAP is unavailable</p></div>
                    <p className="mt-2 text-[10px] leading-relaxed text-[#6f7f74]">
                      SHAP values can only be computed by a trained model. No trained LightGBM artifact is active for this deployment. Generic feature
                      importance is not shown in place of SHAP.
                    </p>
                  </>
                )}
                <div className="mt-4 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 text-[10px] leading-relaxed text-[#6f7f74]">
                  <p className="font-semibold text-[#5a6a5f]">Actual vs forecast</p>
                  <p className="mt-1">{detail.forecastPerformance.reason}</p>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Model registry</CardTitle><Badge tone="neutral">{data.models.length} entries</Badge></CardHeader>
              <div className="scrollbar-thin max-h-[360px] overflow-auto">
                <table className="w-full text-left text-[10px]">
                  <thead className="sticky top-0 bg-[#ffffff] text-[9px] uppercase tracking-[0.1em] text-[#66766b]"><tr><th className="px-4 py-2">Model</th><th className="px-4 py-2">Target</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Metrics</th></tr></thead>
                  <tbody className="divide-y divide-[#e7ece3]">
                    {data.models.map((model) => (
                      <tr key={model.id} className="text-[#5a6a5f]">
                        <td className="px-4 py-2"><p className="font-medium text-[#26362a]">{model.name}</p><p className="text-[9px] text-[#66766b]">{model.version}</p></td>
                        <td className="px-4 py-2">{model.target}{model.horizon_hours ? ` · ${model.horizon_hours}h` : ''}</td>
                        <td className="px-4 py-2"><Badge tone={model.status === 'BASELINE' ? 'teal' : model.status === 'TRAINED' ? 'green' : 'amber'}>{model.status.replace(/_/g, ' ')}</Badge></td>
                        <td className="px-4 py-2 text-[9px]">{model.metrics ? 'Available' : 'None — not evaluated'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card>
              <CardHeader><CardTitle>External modelled context · CAMS</CardTitle><Badge tone="neutral">Modelled</Badge></CardHeader>
              <div className="divide-y divide-[#e7ece3]">
                {data.externalContext.cams.slice(0, 8).map((row, index) => (
                  <div key={`${row.locality_name}-${row.pollutant_code}-${index}`} className="flex items-center justify-between px-4 py-2 text-[10px]">
                    <span className="text-[#5a6a5f]">{row.locality_name} · {row.pollutant_code.toUpperCase()}</span>
                    <span className="text-[#1b2a1f]">{number(row.value)} {row.unit}</span>
                  </div>
                ))}
                {data.externalContext.cams.length === 0 ? <p className="p-4 text-[10px] text-[#66766b]">CAMS context unavailable.</p> : null}
              </div>
              <p className="border-t border-[#e7ece3] px-4 py-2 text-[9px] leading-relaxed text-[#66766b]">
                CAMS is a regional atmospheric model, not a Mumbai monitoring station. It is shown as context only and is never used as a CPCB reading or official AQI.
              </p>
            </Card>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-4 text-[10px] text-[#6f7f74]">
            <Sparkles className="h-4 w-4 text-[#3f7d2a]" />
            Need an explanation? The <Link to="/ai-analyst" className="font-semibold text-[#3f7d2a] underline">AI analyst</Link> can explain this evidence, but it cannot create or override forecasts.
            <Link to="/map" className="ml-auto inline-flex items-center gap-1 font-semibold text-[#3f7d2a]">Open map <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
        </>
      ) : (
        <EmptyState title="No station selected" description="Select an air monitoring station to inspect forecasts." />
      )}
    </div>
  );
}
