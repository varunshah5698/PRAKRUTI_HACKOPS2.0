import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  CalendarClock,
  ChevronRight,
  Clock,
  Filter,
  Layers3,
  MapPin,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Wind,
} from 'lucide-react';
import { Chart, chartAxis, chartGrid, chartTooltip } from '../../components/Chart';
import { MumbaiMap, type MapIncident, type MapReport, type MapStation } from '../../components/MumbaiMap';
import { RiskBadge } from '../../components/Status';
import { Badge, Button, DataLabel, EmptyState, LoadingBlock, Select, Sheet, Spinner, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { AQI_COLORS, CATEGORY_LABELS, categoryLabel, formatDate, number, timeAgo } from '../../lib/format';
import { toast } from 'sonner';

interface Locality { id: string; name: string; lat: number; lng: number }
interface TimelineStation {
  id: string; name: string; code: string; localityName: string | null; lat: number; lng: number; stationType?: string;
  healthStatus: string; isSimulated: boolean; isStale: boolean; latestObservedAt: string | null;
  values?: Record<string, { value: number; unit: string; observedAt: string; qualityState: string; sourceId: string; isSimulated: boolean }>;
  aqi?: number | null; aqiCategory?: string;
  forecast?: { predictedValue: number; lowerBound: number; upperBound: number; horizonHours: number; method: string; confidence: string; targetTime: string } | null;
  forecastUnavailable?: boolean;
  markerKind?: string;
}
interface TimelineData {
  at: string; mode: 'PAST' | 'CURRENT' | 'FUTURE'; category: string; stations: TimelineStation[];
  reports: Array<{ id: string; public_ref: string; category: string; incident_type: string; status: string; verification_state: string; submitted_at: string; lat: number; lng: number; is_simulated: boolean; locality_name: string | null }>;
  incidents: Array<{ id: string; public_ref: string; title: string; category: string; status: string; risk_level: string; detected_at: string; lat: number; lng: number; is_simulated: boolean }>;
  alerts: Array<{ id: string; public_ref: string; category: string; level: string; state: string; trigger_type: string; title: string; triggered_at: string; locality_name: string | null; is_simulated: boolean }>;
  localities: Locality[];
  warnings: string[];
  forecastMeta: Record<string, unknown> | null;
  estimatedZones: unknown[];
  estimatedZoneNote: string;
  boundary: { url: string; source: string; note: string };
  mapAttribution: string;
}

interface StationDetail {
  station: {
    id: string; code: string; name: string; provider: string; stationType: string; localityName: string | null;
    lat: number; lng: number; healthStatus: string; lastSeenAt: string | null; isSimulated: boolean; isStale: boolean;
    values: Record<string, { value: number; unit: string; observedAt: string; qualityState: string; sourceId: string; isSimulated: boolean }>;
    aqi: { aqi: number | null; category: string; dominantPollutant: string | null; caveat: string } | null;
    latestObservedAt: string | null;
  };
  pollutants: string[];
  series: Array<{ observed_at: string; value: number; unit: string; quality_state: string; is_simulated: boolean }>;
  seriesAll: Array<{ pollutant_code: string; observed_at: string; value: number; unit: string; quality_state: string; is_simulated: boolean }>;
  weather: { observed_at: string; temperature_c: number; relative_humidity: number; wind_speed_kmh: number; wind_direction_deg: number; precipitation_mm: number; is_simulated: boolean; source_id: string } | null;
  forecasts: Array<{ horizonHours: number; predictedValue: number; lowerBound: number; upperBound: number; method: string; confidence: string; targetTime: string; currentValue: number; intervalNote: string }>;
  anomaly: { status: string; zScore: number | null; latest: number | null; mean: number | null; sd: number | null; method: string };
  nearbyStations: Array<{ id: string; name: string; code: string; station_type: string; health_status: string; distance_m: number; latest_pm25: number | null; latest_observed_at: string | null }>;
  nearbyReports: Array<{ id: string; public_ref: string; category: string; incident_type: string; status: string; verification_state: string; submitted_at: string; distance_m: number }>;
  alerts: Array<{ id: string; public_ref: string; category: string; level: string; state: string; trigger_type: string; title: string; summary: string; triggered_at: string; is_simulated: boolean }>;
  risk: { risk_score: number | null; risk_level: string; confidence_score: number | null; confidence_level: string; alert_state: string; method: string; supporting_evidence: unknown[]; missing_inputs: string[]; calculated_at: string; ruleset_version: string } | null;
  forecastStatus: { trainedModel: string; availableMethod: string; note: string; shap: string };
  dataQuality: { stationHealth: string; latestObservedAt: string | null; isStale: boolean; simulated: boolean; note: string };
}

interface AiAnswer {
  status: string;
  provider: string;
  model: string | null;
  narrative: string;
  sections: { observed: string[]; predicted: string[]; reported: string[]; estimated: string[]; standards: string[]; limitations: string[]; nextActions: string[] };
  citations: Array<{ title: string; section: string; authority: string; url: string | null }>;
  disclaimer: string;
}

const POLLUTANTS = [
  ['aqi', 'Indicative AQI'],
  ['pm25', 'PM2.5'],
  ['pm10', 'PM10'],
  ['no2', 'NO₂'],
  ['so2', 'SO₂'],
  ['co', 'CO'],
  ['o3', 'O₃'],
  ['ph', 'pH'],
  ['do', 'Dissolved oxygen'],
  ['turbidity', 'Turbidity'],
];

function buildTimeline(now: Date) {
  return [
    { label: '−24h', offset: -24 },
    { label: '−18h', offset: -18 },
    { label: '−12h', offset: -12 },
    { label: '−6h', offset: -6 },
    { label: 'Current', offset: 0 },
    { label: '+1h', offset: 1 },
    { label: '+3h', offset: 3 },
    { label: '+6h', offset: 6 },
  ].map((item) => ({ ...item, date: new Date(now.getTime() + item.offset * 3_600_000) }));
}

function stationToMap(station: TimelineStation): MapStation {
  const forecast = station.forecast;
  const aqi = forecast ? forecast.predictedValue : station.aqi;
  const category = forecast ? 'PREDICTED' : station.aqiCategory;
  const color = forecast
    ? '#56c1b3'
    : station.stationType === 'WATER_SAMPLING'
      ? '#56c1b3'
      : station.stationType === 'INDUSTRIAL_STACK'
        ? '#e88a43'
        : AQI_COLORS[station.aqiCategory ?? 'INSUFFICIENT DATA'] ?? '#788493';
  const pm25 = station.values?.pm25?.value ?? null;
  return {
    id: station.id,
    name: station.name,
    code: station.code,
    localityName: station.localityName,
    lat: station.lat,
    lng: station.lng,
    color,
    valueLabel: forecast
      ? `Forecast ${forecast.predictedValue} µg/m³ · ${forecast.lowerBound}–${forecast.upperBound}`
      : station.aqi
        ? `AQI ${station.aqi} · ${station.aqiCategory} · PM2.5 ${pm25 ?? '—'}`
        : station.values?.ph
          ? `pH ${station.values.ph.value} · DO ${station.values.do?.value ?? '—'} mg/L`
          : 'No recent value',
    markerKind: forecast ? 'PREDICTED' : 'OBSERVED',
    isSimulated: station.isSimulated,
    isStale: station.isStale,
    aqi: aqi ?? null,
    aqiCategory: category ?? 'INSUFFICIENT DATA',
    latestObservedAt: station.latestObservedAt,
    healthStatus: station.healthStatus,
    forecast: forecast ?? null,
  };
}

function StationDrawer({
  stationId,
  onClose,
}: {
  stationId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<StationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');
  const [pollutant, setPollutant] = useState('pm25');
  const [aiType, setAiType] = useState<'observation' | 'predictive' | 'compliance' | null>(null);
  const [ai, setAi] = useState<AiAnswer | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!stationId) return;
    setLoading(true);
    setDetail(null);
    setAi(null);
    setTab('overview');
    api
      .get<StationDetail>(`/map/stations/${stationId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load station'))
      .finally(() => setLoading(false));
  }, [stationId]);

  const loadAi = async (type: 'observation' | 'predictive' | 'compliance') => {
    if (!stationId) return;
    setAiType(type);
    setAiLoading(true);
    try {
      const result = await api.post<AiAnswer>('/ai/analyse', { stationId, type });
      setAi(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI analysis failed');
    } finally {
      setAiLoading(false);
    }
  };

  const seriesOption = useMemo(() => {
    if (!detail) return {};
    const filtered = detail.seriesAll.filter((row) => row.pollutant_code === pollutant);
    return {
      grid: { ...chartGrid, top: 26 },
      tooltip: chartTooltip,
      xAxis: { type: 'category', data: filtered.map((row) => new Date(row.observed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })), ...chartAxis, axisLabel: { ...chartAxis.axisLabel, interval: Math.max(1, Math.floor(filtered.length / 8)) } },
      yAxis: { type: 'value', name: filtered[0]?.unit ?? '', nameTextStyle: { color: '#788493', fontSize: 10 }, ...chartAxis },
      series: [
        {
          type: 'line',
          smooth: 0.3,
          symbol: 'none',
          data: filtered.map((row) => row.value),
          lineStyle: { color: '#b5e36b', width: 2 },
          areaStyle: { color: 'rgba(181,227,107,0.09)' },
        },
      ],
    };
  }, [detail, pollutant]);

  const pollutantBreakdown = useMemo(() => {
    if (!detail) return [];
    return Object.entries(detail.station.values)
      .filter(([code]) => ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3'].includes(code))
      .map(([code, value]) => ({ code: code.toUpperCase(), value: value.value, unit: value.unit }));
  }, [detail]);

  return (
    <Sheet open={Boolean(stationId)} onOpenChange={(open) => !open && onClose()} title={detail?.station.name ?? 'Station detail'} description={detail ? `${detail.station.localityName ?? 'Mumbai'} · ${detail.station.code}` : 'Loading station…'}>
      {loading ? <LoadingBlock className="min-h-[50vh]" label="Loading station evidence" /> : error ? (
        <EmptyState title="Station unavailable" description={error} icon={<AlertTriangle className="h-5 w-5" />} />
      ) : detail ? (
        <div>
          <div className="flex flex-wrap items-center gap-2 border-b border-[#2b333e] px-5 py-3">
            <Badge tone={detail.station.isSimulated ? 'amber' : 'green'} dot>{detail.station.isSimulated ? 'Simulation data' : 'Source record'}</Badge>
            <Badge tone={detail.station.healthStatus === 'ONLINE' ? 'green' : 'amber'}>{detail.station.healthStatus}</Badge>
            {detail.station.aqi?.aqi !== null && detail.station.aqi?.aqi !== undefined ? <Badge tone="neutral">Indicative AQI {detail.station.aqi.aqi}</Badge> : null}
            <span className="ml-auto text-[9px] text-[#6f7c89]">Last update {formatDate(detail.station.latestObservedAt)}</span>
          </div>
          <div className="px-5 pt-4">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'analytics', label: 'Analytics' },
                { id: 'forecast', label: 'Forecasts' },
                { id: 'ai', label: 'AI analyses' },
              ]}
            />
          </div>

          {tab === 'overview' ? (
            <div className="space-y-5 px-5 py-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(detail.station.values).map(([code, value]) => (
                  <div key={code} className="rounded-xl border border-[#303945] bg-[#101317] p-3">
                    <DataLabel>{code.toUpperCase()}</DataLabel>
                    <p className="mt-1 text-lg font-semibold text-[#f3f5f7]">{number(value.value)} <span className="text-[10px] font-normal text-[#788493]">{value.unit}</span></p>
                    <p className="mt-1 text-[9px] text-[#6f7c89]">{value.qualityState} · {value.sourceId}</p>
                  </div>
                ))}
                {Object.keys(detail.station.values).length === 0 ? <p className="col-span-full text-xs text-[#788493]">No recent values available.</p> : null}
              </div>
              <div className="rounded-xl border border-[#303945] bg-[#101317] p-4">
                <div className="flex items-center justify-between"><DataLabel>Station identity</DataLabel><span className="text-[9px] text-[#6f7c89]">{detail.station.provider}</span></div>
                <div className="mt-3 grid gap-2 text-[11px] text-[#a2adba] sm:grid-cols-2">
                  <p>Identifier <span className="text-[#e8edf2]">{detail.station.code}</span></p>
                  <p>Type <span className="text-[#e8edf2]">{detail.station.stationType}</span></p>
                  <p>Locality <span className="text-[#e8edf2]">{detail.station.localityName ?? '—'}</span></p>
                  <p>Coordinates <span className="text-[#e8edf2]">{detail.station.lat.toFixed(5)}, {detail.station.lng.toFixed(5)}</span></p>
                  <p>Last seen <span className="text-[#e8edf2]">{formatDate(detail.station.lastSeenAt)}</span></p>
                  <p>Quality note <span className="text-[#e8edf2]">{detail.dataQuality.note}</span></p>
                </div>
              </div>
              {detail.station.aqi ? (
                <div className="rounded-xl border border-[#303945] bg-[#101317] p-4">
                  <div className="flex items-center justify-between"><DataLabel>Indicative AQI</DataLabel><RiskBadge level={detail.station.aqi.category === 'Good' || detail.station.aqi.category === 'Satisfactory' ? 'LOW' : detail.station.aqi.category === 'Moderate' ? 'MODERATE' : detail.station.aqi.category === 'Poor' ? 'HIGH' : 'CRITICAL'} /></div>
                  <p className="display mt-2 text-4xl font-bold" style={{ color: AQI_COLORS[detail.station.aqi.category] }}>{detail.station.aqi.aqi}</p>
                  <p className="mt-1 text-xs font-medium text-[#dbe2e9]">{detail.station.aqi.category} · dominant {detail.station.aqi.dominantPollutant?.toUpperCase()}</p>
                  <p className="mt-2 text-[10px] leading-relaxed text-[#6f7c89]">{detail.station.aqi.caveat}</p>
                </div>
              ) : null}
              <div className="rounded-xl border border-[#303945] bg-[#101317] p-4">
                <DataLabel>Weather context</DataLabel>
                {detail.weather ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[#a2adba]">
                    <p>Temperature <span className="text-[#e8edf2]">{number(detail.weather.temperature_c)}°C</span></p>
                    <p>Humidity <span className="text-[#e8edf2]">{number(detail.weather.relative_humidity, 0)}%</span></p>
                    <p>Wind <span className="text-[#e8edf2]">{number(detail.weather.wind_speed_kmh)} km/h · {number(detail.weather.wind_direction_deg, 0)}°</span></p>
                    <p>Rain <span className="text-[#e8edf2]">{number(detail.weather.precipitation_mm)} mm</span></p>
                    <p className="col-span-2 text-[9px] text-[#6f7c89]">Observed {formatDate(detail.weather.observed_at)} · source {detail.weather.source_id} · weather is context, not evidence of causation.</p>
                  </div>
                ) : <p className="mt-2 text-[11px] text-[#6f7c89]">No weather observation available.</p>}
              </div>
              <div className="rounded-xl border border-[#303945] bg-[#101317] p-4">
                <DataLabel>Nearby context</DataLabel>
                <div className="mt-2 space-y-2">
                  {detail.nearbyStations.slice(0, 4).map((station) => (
                    <div key={station.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-[#c5d0db]">{station.name.replace(' demo air monitor', '')}</span>
                      <span className="text-[#6f7c89]">{Math.round(station.distance_m)} m · PM2.5 {station.latest_pm25 ?? '—'}</span>
                    </div>
                  ))}
                  {detail.nearbyStations.length === 0 ? <p className="text-[11px] text-[#6f7c89]">No nearby stations within 6 km.</p> : null}
                </div>
                <p className="mt-2 text-[9px] text-[#6f7c89]">Proximity is not evidence of a common source.</p>
              </div>
              {detail.nearbyReports.length ? (
                <div className="rounded-xl border border-[#303945] bg-[#101317] p-4">
                  <DataLabel>Nearby citizen reports</DataLabel>
                  <div className="mt-2 space-y-2">
                    {detail.nearbyReports.slice(0, 4).map((report) => (
                      <div key={report.id} className="text-[11px] text-[#a2adba]">
                        <span className="text-[#dbe2e9]">{report.public_ref}</span> · {report.incident_type.replace(/_/g, ' ')} · {Math.round(report.distance_m)} m · {report.verification_state}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {detail.risk ? (
                <div className="rounded-xl border border-[#303945] bg-[#101317] p-4">
                  <div className="flex items-center justify-between"><DataLabel>Risk assessment</DataLabel><RiskBadge level={detail.risk.risk_level} /></div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                    <div><DataLabel>Risk score</DataLabel><p className="mt-1 text-lg font-semibold">{detail.risk.risk_score ?? '—'}/100</p></div>
                    <div><DataLabel>Confidence</DataLabel><p className="mt-1 text-lg font-semibold">{detail.risk.confidence_score ?? '—'}/100 · {detail.risk.confidence_level}</p></div>
                  </div>
                  <p className="mt-2 text-[9px] leading-relaxed text-[#6f7c89]">{detail.risk.method} · {detail.risk.ruleset_version}</p>
                  {detail.risk.missing_inputs.length ? <p className="mt-2 text-[9px] text-amber-300/70">Missing: {detail.risk.missing_inputs.join('; ')}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'analytics' ? (
            <div className="space-y-4 px-5 py-5">
              <div className="flex items-center justify-between gap-2">
                <DataLabel>Stored time series · 48h</DataLabel>
                <Select value={pollutant} onChange={(e) => setPollutant(e.target.value)} className="h-8 w-[160px] text-[11px]">
                  {POLLUTANTS.filter(([code]) => detail.seriesAll.some((row) => row.pollutant_code === code)).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </Select>
              </div>
              <Chart height={250} empty={!detail.seriesAll.some((row) => row.pollutant_code === pollutant)} option={seriesOption} />
              <p className="text-[9px] leading-relaxed text-[#6f7c89]">Stored observations only. Missing periods are not interpolated. Simulation-labelled values are not official monitoring records.</p>
              <div className="rounded-xl border border-[#303945] bg-[#101317] p-4">
                <DataLabel>Anomaly check</DataLabel>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{detail.anomaly.status}</span>
                  <Badge tone={detail.anomaly.status === 'UNUSUAL' ? 'amber' : 'neutral'}>z = {detail.anomaly.zScore ?? '—'}</Badge>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-[#6f7c89]">{detail.anomaly.method}. This is an analytical check, not a trained anomaly model.</p>
              </div>
              <div className="rounded-xl border border-[#303945] bg-[#101317] p-4">
                <DataLabel>Pollutant breakdown</DataLabel>
                <div className="mt-2 space-y-2">
                  {pollutantBreakdown.map((item) => (
                    <div key={item.code} className="flex items-center justify-between text-[11px]">
                      <span className="text-[#a2adba]">{item.code}</span>
                      <span className="text-[#e8edf2]">{number(item.value)} {item.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'forecast' ? (
            <div className="space-y-4 px-5 py-5">
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-[10px] leading-relaxed text-amber-100/80">
                <strong className="text-amber-200">LightGBM models are NOT TRAINED.</strong> {detail.forecastStatus.note}
              </div>
              {detail.forecasts.length ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {detail.forecasts.map((forecast) => (
                    <div key={forecast.horizonHours} className="rounded-xl border border-[#303945] bg-[#101317] p-3">
                      <DataLabel>+{forecast.horizonHours} hour</DataLabel>
                      <p className="mt-1 text-xl font-semibold text-[#f3f5f7]">{forecast.predictedValue} <span className="text-[10px] font-normal text-[#788493]">µg/m³</span></p>
                      <p className="mt-1 text-[9px] text-[#6f7c89]">Band {forecast.lowerBound}–{forecast.upperBound}</p>
                      <p className="mt-2 text-[8px] uppercase tracking-[0.08em] text-amber-300/70">{forecast.method}</p>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="FORECAST UNAVAILABLE" description="Insufficient stored history for a persistence baseline." icon={<CalendarClock className="h-5 w-5" />} />}
              <div className="rounded-xl border border-[#303945] bg-[#101317] p-4 text-[10px] leading-relaxed text-[#788493]">
                <p><strong className="text-[#dbe2e9]">Method:</strong> {detail.forecastStatus.availableMethod}</p>
                <p className="mt-1"><strong className="text-[#dbe2e9]">SHAP:</strong> {detail.forecastStatus.shap}</p>
                <p className="mt-1">Forecasts are not confirmed future conditions and never constitute a regulatory determination.</p>
              </div>
              {detail.alerts.length ? (
                <div className="space-y-2">
                  <DataLabel>Linked alerts</DataLabel>
                  {detail.alerts.map((alert) => (
                    <div key={alert.id} className="rounded-xl border border-[#303945] bg-[#101317] p-3">
                      <div className="flex items-center justify-between gap-2"><RiskBadge level={alert.level} /><span className="text-[8px] uppercase text-[#6f7c89]">{alert.trigger_type}</span></div>
                      <p className="mt-1 text-[11px] font-medium text-[#dbe2e9]">{alert.title}</p>
                      <p className="mt-0.5 text-[9px] text-[#6f7c89]">{formatDate(alert.triggered_at)}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'ai' ? (
            <div className="space-y-4 px-5 py-5">
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  ['observation', 'Observation & anomaly', 'Facts, quality, nearby context'],
                  ['predictive', 'Predictive explanation', 'Baseline, intervals, limits'],
                  ['compliance', 'Context & compliance', 'Standards, evidence gaps'],
                ].map(([type, label, copy]) => (
                  <button
                    key={type}
                    onClick={() => loadAi(type as 'observation' | 'predictive' | 'compliance')}
                    disabled={aiLoading}
                    className={`rounded-xl border p-3 text-left transition ${aiType === type ? 'border-[#b5e36b]/45 bg-[#b5e36b]/[0.06]' : 'border-[#303945] bg-[#101317] hover:border-[#46515e]'}`}
                  >
                    <p className="text-[11px] font-semibold text-[#e8edf2]">{label}</p>
                    <p className="mt-1 text-[9px] leading-relaxed text-[#6f7c89]">{copy}</p>
                  </button>
                ))}
              </div>
              {aiLoading ? <LoadingBlock className="min-h-[160px]" label="Building grounded evidence digest" /> : null}
              {ai && !aiLoading ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={ai.provider === 'RIVER_AI' ? 'lime' : 'amber'}>{ai.provider === 'RIVER_AI' ? `River AI · ${ai.model}` : 'Rule-based digest'}</Badge>
                    <Badge tone={ai.status === 'COMPLETED' ? 'green' : 'neutral'}>{ai.status.replace(/_/g, ' ')}</Badge>
                  </div>
                  <p className="rounded-xl border border-[#303945] bg-[#101317] p-3 text-[11px] leading-relaxed text-[#c5d0db]">{ai.narrative}</p>
                  {[
                    ['OBSERVED', ai.sections.observed, 'green'],
                    ['PREDICTED', ai.sections.predicted, 'teal'],
                    ['REPORTED', ai.sections.reported, 'amber'],
                    ['ESTIMATED', ai.sections.estimated, 'neutral'],
                    ['REFERENCE STANDARDS', ai.sections.standards, 'neutral'],
                    ['LIMITATIONS', ai.sections.limitations, 'red'],
                    ['NEXT ACTIONS', ai.sections.nextActions, 'lime'],
                  ].map(([label, items, tone]) => Array.isArray(items) && items.length ? (
                    <div key={String(label)} className="rounded-xl border border-[#303945] bg-[#101317] p-3">
                      <Badge tone={tone as never}>{String(label)}</Badge>
                      <ul className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-[#a2adba]">
                        {items.map((item, index) => <li key={index} className="flex gap-2"><span className="text-[#6f7c89]">—</span>{item}</li>)}
                      </ul>
                    </div>
                  ) : null)}
                  {ai.citations.length ? (
                    <div className="rounded-xl border border-[#303945] bg-[#101317] p-3">
                      <DataLabel>Source references</DataLabel>
                      <ul className="mt-2 space-y-1 text-[10px] text-[#a2adba]">
                        {ai.citations.map((citation, index) => (
                          <li key={index}>{citation.title} · {citation.section} · {citation.authority}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <p className="text-[9px] leading-relaxed text-[#5f6b78]">{ai.disclaimer}</p>
                </div>
              ) : !aiLoading ? (
                <p className="rounded-xl border border-[#303945] bg-[#101317] p-4 text-[10px] leading-relaxed text-[#788493]">
                  Select one of the three analyses. The AI never creates readings or overrides model output. If River AI is not configured, the server returns a rule-based evidence digest labelled as such.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

export function MapPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const timeline = useMemo(() => buildTimeline(now), [now]);
  const [timelineIndex, setTimelineIndex] = useState(4);
  const [category, setCategory] = useState('air');
  const [localityId, setLocalityId] = useState('');
  const [pollutant, setPollutant] = useState('aqi');
  const [sourceId, setSourceId] = useState('');
  const [severity, setSeverity] = useState('');
  const [verification, setVerification] = useState('');
  const [includeForecast, setIncludeForecast] = useState(true);
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(params.get('station'));
  const playRef = useRef<number | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (selectedStationId) query.set('station', selectedStationId);
    setParams(query, { replace: true });
  }, [selectedStationId, setParams]);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams({
      at: timeline[timelineIndex].date.toISOString(),
      category,
      includeForecast: String(includeForecast),
    });
    if (localityId) query.set('localityId', localityId);
    if (pollutant && pollutant !== 'aqi') query.set('pollutant', pollutant);
    if (sourceId) query.set('sourceId', sourceId);
    if (severity) query.set('severity', severity);
    if (verification) query.set('verification', verification);
    api
      .get<TimelineData>(`/map/timeline?${query.toString()}`)
      .then((result) => { setData(result); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load map timeline'))
      .finally(() => setLoading(false));
  }, [timeline, timelineIndex, category, localityId, pollutant, sourceId, severity, verification, includeForecast]);

  useEffect(() => {
    if (!playing) {
      if (playRef.current) window.clearInterval(playRef.current);
      return;
    }
    playRef.current = window.setInterval(() => {
      setTimelineIndex((index) => {
        if (index >= timeline.length - 1) {
          setPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, 2200);
    return () => {
      if (playRef.current) window.clearInterval(playRef.current);
    };
  }, [playing, timeline.length]);

  const stations = useMemo(() => (data?.stations ?? []).map(stationToMap), [data]);
  const reports: MapReport[] = useMemo(() => (data?.reports ?? []).map((report) => ({ ...report, verification_state: report.verification_state })), [data]);
  const incidents: MapIncident[] = useMemo(() => data?.incidents ?? [], [data]);
  const current = timeline[timelineIndex];
  const selectedLocality = data?.localities.find((l) => l.id === localityId);

  const reset = () => {
    setCategory('air');
    setLocalityId('');
    setPollutant('aqi');
    setSourceId('');
    setSeverity('');
    setVerification('');
    setIncludeForecast(true);
    setTimelineIndex(4);
    setPlaying(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="lime" dot>Mumbai boundary</Badge>
            <Badge tone={current.offset === 0 ? 'green' : current.offset > 0 ? 'teal' : 'neutral'}>{current.offset === 0 ? 'CURRENT' : current.offset > 0 ? 'FORECAST' : 'PAST'}</Badge>
            <Badge tone="amber">Station data simulated</Badge>
          </div>
          <h2 className="display mt-2 text-[24px] font-bold tracking-[-0.04em]">Live environmental intelligence map</h2>
          <p className="mt-1 text-[11px] text-[#788493]">Measured, predicted, reported and official records are visually distinct. No interpolated pollution surface is drawn.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="dark" size="sm" onClick={() => setFiltersOpen((v) => !v)}><Filter className="h-3.5 w-3.5" /> Filters</Button>
          <Button variant="dark" size="sm" onClick={reset}><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
        </div>
      </div>

      {filtersOpen ? (
        <div className="grid gap-2 rounded-2xl border border-[#303945] bg-[#181d23] p-3 md:grid-cols-2 xl:grid-cols-6">
          <div>
            <DataLabel>Category</DataLabel>
            <Select value={category} onChange={(e) => { setCategory(e.target.value); setPollutant(e.target.value === 'air' ? 'aqi' : ''); }} className="mt-1 h-9 text-[11px]">
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>
          <div>
            <DataLabel>Locality</DataLabel>
            <Select value={localityId} onChange={(e) => setLocalityId(e.target.value)} className="mt-1 h-9 text-[11px]">
              <option value="">All Mumbai</option>
              {data?.localities.map((locality) => <option key={locality.id} value={locality.id}>{locality.name}</option>)}
            </Select>
          </div>
          <div>
            <DataLabel>Pollutant</DataLabel>
            <Select value={pollutant} onChange={(e) => setPollutant(e.target.value)} className="mt-1 h-9 text-[11px]">
              <option value="aqi">Indicative AQI</option>
              {POLLUTANTS.filter(([code]) => code !== 'aqi').map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </Select>
          </div>
          <div>
            <DataLabel>Source</DataLabel>
            <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="mt-1 h-9 text-[11px]">
              <option value="">All sources</option>
              <option value="demo-network">Demo network (simulated)</option>
            </Select>
          </div>
          <div>
            <DataLabel>Severity</DataLabel>
            <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="mt-1 h-9 text-[11px]">
              <option value="">Any</option>
              {['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe'].map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </div>
          <div>
            <DataLabel>Report verification</DataLabel>
            <Select value={verification} onChange={(e) => setVerification(e.target.value)} className="mt-1 h-9 text-[11px]">
              <option value="">Any</option>
              <option value="VERIFIED">Verified</option>
              <option value="UNVERIFIED">Unverified</option>
              <option value="REJECTED">Rejected</option>
            </Select>
          </div>
          <div className="flex items-end gap-4 md:col-span-2 xl:col-span-6">
            <label className="flex items-center gap-2 text-[10px] text-[#a2adba]">
              <input type="checkbox" checked={includeForecast} onChange={(e) => setIncludeForecast(e.target.checked)} className="h-3.5 w-3.5 accent-[#b5e36b]" />
              Forecast layer
            </label>
            <label className="flex items-center gap-2 text-[10px] text-[#5f6b78]" title="No interpolated surface is produced.">
              <input type="checkbox" disabled className="h-3.5 w-3.5" />
              Estimated zones (unavailable)
            </label>
            <span className="ml-auto text-[9px] text-[#5f6b78]">{selectedLocality ? `${selectedLocality.name} filter active` : 'Greater Mumbai · all localities'}</span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="relative overflow-hidden rounded-2xl border border-[#303945] bg-[#14191f]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2b333e] px-3 py-2">
            <div className="flex items-center gap-2 text-[10px] text-[#8d99a6]">
              <Clock className="h-3.5 w-3.5 text-[#b5e36b]" />
              <span className="font-semibold text-[#dbe2e9]">{formatDate(current.date.toISOString())}</span>
              <span className="text-[#5f6b78]">Asia/Kolkata</span>
              {data?.mode === 'FUTURE' ? <Badge tone="teal">Forecast · {data.forecastMeta?.method as string ?? 'unavailable'}</Badge> : null}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="dark" size="icon" onClick={() => setTimelineIndex((v) => Math.max(0, v - 1))} aria-label="Previous timeline step"><ArrowLeft className="h-3.5 w-3.5" /></Button>
              <Button variant={playing ? 'lime' : 'dark'} size="icon" onClick={() => setPlaying((v) => !v)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</Button>
              <Button variant="dark" size="icon" onClick={() => setTimelineIndex((v) => Math.min(timeline.length - 1, v + 1))} aria-label="Next timeline step"><ArrowRight className="h-3.5 w-3.5" /></Button>
              <Button variant="dark" size="sm" onClick={() => { setTimelineIndex(4); setPlaying(false); }}>Current</Button>
            </div>
          </div>
          <div className="relative">
            <MumbaiMap
              stations={stations}
              reports={reports}
              incidents={incidents}
              selectedStationId={selectedStationId}
              onStationSelect={(id) => setSelectedStationId(id)}
              onReportSelect={(id) => navigate(`/reports/${id}`)}
              onIncidentSelect={(id) => navigate(`/incidents/${id}`)}
              className="h-[calc(100vh-300px)] min-h-[480px] w-full"
              theme="dark"
              showBuildings
              autoFit={false}
              initialZoom={12.2}
              initialPitch={55}
            />
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap gap-2">
              <div className="pointer-events-auto rounded-xl border border-[#303945] bg-[#101317]/90 px-3 py-2 text-[9px] backdrop-blur">
                <p className="font-semibold uppercase tracking-[0.1em] text-[#8d99a6]">Marker legend</p>
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[#a2adba]">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#b5e36b]" /> Measured</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[#56c1b3]" /> Predicted</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#d2b04c]" /> Citizen report</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[#dc555b]" /> Incident</span>
                </div>
              </div>
              <div className="pointer-events-auto rounded-xl border border-[#303945] bg-[#101317]/90 px-3 py-2 text-[9px] text-[#8d99a6] backdrop-blur">
                <p className="font-semibold uppercase tracking-[0.1em]">3D buildings</p>
                <p className="mt-1 max-w-[190px] leading-relaxed">OpenMapTiles render heights — visual context, not surveyed data.</p>
              </div>
            </div>
            {loading ? <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#101317]/40 backdrop-blur-[1px]"><Spinner className="text-[#b5e36b]" /></div> : null}
          </div>
          <div className="border-t border-[#2b333e] px-3 py-2">
            <div className="flex items-center justify-between text-[9px] text-[#6f7c89]">
              <span>{current.label} · {data?.stations.length ?? 0} stations · {data?.reports.length ?? 0} reports · {data?.incidents.length ?? 0} incidents</span>
              <span>{data?.mode === 'FUTURE' ? 'Forecast values are not confirmed future conditions.' : data?.mode === 'PAST' ? 'Archived observations · ±90 minute match' : 'Latest valid observations · stale values flagged'}</span>
            </div>
            <input
              type="range"
              min={0}
              max={timeline.length - 1}
              value={timelineIndex}
              onChange={(e) => { setTimelineIndex(Number(e.target.value)); setPlaying(false); }}
              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#29323d] accent-[#b5e36b]"
              aria-label="Map timeline"
            />
            <div className="mt-1 flex justify-between text-[8px] uppercase tracking-[0.08em] text-[#5f6b78]">
              {timeline.map((item) => <span key={item.label} className={item.label === current.label ? 'text-[#b5e36b]' : ''}>{item.label}</span>)}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {data?.warnings.length ? (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-[10px] leading-relaxed text-amber-100/80">
              {data.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
            </div>
          ) : null}
          <div className="rounded-2xl border border-[#303945] bg-[#181d23] p-4">
            <div className="flex items-center justify-between"><DataLabel>Active alerts at selected time</DataLabel><Badge tone="neutral">{data?.alerts.length ?? 0}</Badge></div>
            <div className="mt-2 space-y-2">
              {data?.alerts.slice(0, 5).map((alert) => (
                <button key={alert.id} onClick={() => navigate(`/alerts/${alert.id}`)} className="block w-full rounded-xl border border-[#303945] bg-[#101317] p-3 text-left hover:border-[#b5e36b]/30">
                  <div className="flex items-center justify-between gap-2"><RiskBadge level={alert.level} /><span className="text-[8px] uppercase text-[#6f7c89]">{alert.trigger_type}</span></div>
                  <p className="mt-1 text-[11px] font-medium text-[#dbe2e9]">{alert.title}</p>
                  <p className="mt-0.5 text-[9px] text-[#6f7c89]">{alert.locality_name ?? 'Mumbai'} · {timeAgo(alert.triggered_at)}</p>
                </button>
              ))}
              {data && data.alerts.length === 0 ? <p className="rounded-xl border border-[#303945] bg-[#101317] p-4 text-center text-[10px] text-[#6f7c89]">No active alerts at this time.</p> : null}
            </div>
          </div>
          <div className="rounded-2xl border border-[#303945] bg-[#181d23] p-4">
            <DataLabel>Coverage & uncertainty</DataLabel>
            <p className="mt-2 text-[10px] leading-relaxed text-[#788493]">{data?.estimatedZoneNote}</p>
            <div className="mt-3 rounded-xl border border-[#303945] bg-[#101317] p-3 text-[9px] leading-relaxed text-[#6f7c89]">
              <p><strong className="text-[#a2adba]">Boundary:</strong> {data?.boundary.note}</p>
              <p className="mt-1"><strong className="text-[#a2adba]">Attribution:</strong> {data?.mapAttribution}</p>
            </div>
          </div>
          {data?.forecastMeta ? (
            <div className="rounded-2xl border border-[#56c1b3]/20 bg-[#56c1b3]/[0.04] p-4">
              <div className="flex items-center justify-between"><DataLabel>Forecast metadata</DataLabel><Badge tone="teal">Baseline</Badge></div>
              <div className="mt-2 space-y-1 text-[10px] text-[#8d99a6]">
                <p>Method: {String(data.forecastMeta.method ?? '—')}</p>
                <p>Status: {String(data.forecastMeta.status ?? '—')}</p>
                <p>Horizon: {String(data.forecastMeta.horizonHours ?? '—')} h</p>
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-[#6f7c89]">{String(data.forecastMeta.note ?? '')}</p>
            </div>
          ) : null}
          <div className="rounded-2xl border border-[#303945] bg-[#181d23] p-4">
            <DataLabel>Nearby reports</DataLabel>
            <div className="mt-2 space-y-2">
              {data?.reports.slice(0, 4).map((report) => (
                <button key={report.id} onClick={() => navigate(`/reports/${report.id}`)} className="flex w-full items-center justify-between gap-2 text-left text-[10px] text-[#a2adba] hover:text-white">
                  <span>{categoryLabel(report.category)} · {report.incident_type.replace(/_/g, ' ')}</span>
                  <ChevronRight className="h-3 w-3 shrink-0" />
                </button>
              ))}
              {data && data.reports.length === 0 ? <p className="text-[10px] text-[#6f7c89]">No reports in this view.</p> : null}
            </div>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">{error}</div> : null}

      <StationDrawer stationId={selectedStationId} onClose={() => setSelectedStationId(null)} />
    </div>
  );
}
