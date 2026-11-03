import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  Crosshair,
  Factory,
  Filter,
  Link2,
  MapPin,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  Wind,
} from 'lucide-react';
import { Chart, chartAxis, chartGrid, chartTooltip } from '../../components/Chart';
import { LocationDrawer } from '../../components/LocationDrawer';
import { MumbaiMap, type MapIncident, type MapReport, type MapSourceLink, type MapStation } from '../../components/MumbaiMap';
import {
  impactTone,
  sourceColor,
  type SourceImpactData,
  type SourceImpactSource,
  type SourceImpactWind,
  type StationSourceAttribution,
} from '../../lib/sourceImpact';
import { RiskBadge } from '../../components/Status';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, EmptyState, LoadingBlock, Select, Sheet, Spinner, Tabs } from '../../components/ui';
import { AiActionText } from '../../components/AiActionText';
import { LivePanel } from '../../components/LivePanel';
import { useLiveFeed, useLiveStation } from '../../lib/liveFeed';
import { api } from '../../lib/api';
import { AQI_COLORS, CATEGORY_LABELS, categoryLabel, formatDate, number, timeAgo } from '../../lib/format';
import { useAuth } from '../../store/auth';
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
  sourceImpact: SourceImpactData | null;
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
  sourceAttribution: (StationSourceAttribution & { wind: SourceImpactWind; method: string; note: string; disclaimer: string }) | null;
  risk: { risk_score: number | null; risk_level: string; confidence_score: number | null; confidence_level: string; alert_state: string; method: string; supporting_evidence: unknown[]; missing_inputs: string[]; calculated_at: string; ruleset_version: string } | null;
  forecastStatus: { trainedModel: string; availableMethod: string; note: string; shap: string; shapValues?: Array<{ feature: string; contribution: number }>; limitations?: string[]; modelVersion?: string | null };
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

function stationToMap(station: TimelineStation, attribution: StationSourceAttribution | null | undefined): MapStation {
  const forecast = station.forecast;
  const aqi = forecast ? forecast.predictedValue : station.aqi;
  const category = forecast ? 'PREDICTED' : station.aqiCategory;
  const color = forecast
    ? '#2f8f84'
    : station.stationType === 'WATER_SAMPLING'
      ? '#2f8f84'
      : station.stationType === 'INDUSTRIAL_STACK'
        ? '#cf7227'
        : AQI_COLORS[station.aqiCategory ?? 'INSUFFICIENT DATA'] ?? '#6f7f74';
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
    impactSharePct: attribution && attribution.impactLevel !== 'NONE' ? attribution.estimatedSharePct : 0,
    impactLevel: attribution?.impactLevel ?? 'NONE',
    primarySourceName: attribution && attribution.impactLevel !== 'NONE' ? attribution.primarySourceName : null,
  };
}

function windLabel(wind: SourceImpactWind | null | undefined) {
  if (!wind) return 'Wind —';
  return `${wind.fromLabel} · ${Math.round(wind.speedKmh)} km/h`;
}

function StationDrawer({
  stationId,
  sourceImpact,
  onClose,
  onSourceSelect,
}: {
  stationId: string | null;
  sourceImpact: SourceImpactData | null;
  onClose: () => void;
  onSourceSelect?: (id: string) => void;
}) {
  const [detail, setDetail] = useState<StationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');
  const [pollutant, setPollutant] = useState('pm25');
  const [aiType, setAiType] = useState<'observation' | 'predictive' | 'compliance' | null>(null);
  const [ai, setAi] = useState<AiAnswer | null>(null);
  const [evidenceOpenByStation, setEvidenceOpenByStation] = useState<Record<string, boolean>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const { isAuthority } = useAuth();
  const live = useLiveStation(stationId);
  const { transport, status } = useLiveFeed();
  const evidenceOpen = stationId ? (evidenceOpenByStation[stationId] ?? true) : true;
  const setEvidenceOpen = (open: boolean) => {
    if (!stationId) return;
    setEvidenceOpenByStation((prev) => ({ ...prev, [stationId]: open }));
  };
  const timelineAttribution = stationId && sourceImpact ? sourceImpact.stationAttributions[stationId] : null;
  const screen = timelineAttribution && sourceImpact
    ? {
        ...timelineAttribution,
        wind: sourceImpact.wind,
        method: sourceImpact.method,
        note: sourceImpact.note,
        disclaimer: sourceImpact.disclaimer,
      }
    : detail?.sourceAttribution ?? null;

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

  // A new minute reading lands on the stream; re-pull the drawer evidence so the
  // inspector sees the same numbers the live panel reports.
  const lastLiveObservation = live?.latestObservedAt ?? null;
  const detailObservation = detail?.station.latestObservedAt ?? null;
  useEffect(() => {
    if (!stationId || !lastLiveObservation || !detailObservation) return;
    if (detailObservation === lastLiveObservation) return;
    setRefreshing(true);
    api
      .get<StationDetail>(`/map/stations/${stationId}`)
      .then((next) => setDetail(next))
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [lastLiveObservation, detailObservation, stationId]);

  const loadAi = async (type: 'observation' | 'predictive' | 'compliance') => {
    if (!stationId) return;
    setAiType(type);
    setEvidenceOpen(true);
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
      yAxis: { type: 'value', name: filtered[0]?.unit ?? '', nameTextStyle: { color: '#6f7f74', fontSize: 10 }, ...chartAxis },
      series: [
        {
          type: 'line',
          smooth: 0.3,
          symbol: 'none',
          data: filtered.map((row) => row.value),
          lineStyle: { color: '#5b9e46', width: 2 },
          areaStyle: { color: 'rgba(91,158,70,0.09)' },
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
          <div className="flex flex-wrap items-center gap-2 border-b border-[#e7ece3] px-5 py-3">
            <Badge tone={detail.station.isSimulated ? 'amber' : 'green'} dot>{detail.station.isSimulated ? 'Simulation data' : 'Source record'}</Badge>
            <Badge tone={detail.station.healthStatus === 'ONLINE' ? 'green' : 'amber'}>{detail.station.healthStatus}</Badge>
            {detail.station.aqi?.aqi !== null && detail.station.aqi?.aqi !== undefined ? <Badge tone="neutral">Indicative AQI {detail.station.aqi.aqi}</Badge> : null}
            {screen && screen.impactLevel !== 'NONE' ? (
              <Badge tone="amber" dot>Plume screen {screen.estimatedSharePct}%</Badge>
            ) : null}
            <span className="ml-auto flex items-center gap-2 text-[9px] text-[#66766b]">
              {refreshing ? (
                <span className="flex items-center gap-1 text-[#3f7d2a]">
                  <Spinner className="h-3 w-3" /> updating
                </span>
              ) : null}
              Last update {formatDate(detail.station.latestObservedAt)}
            </span>
          </div>
          <div className="px-5 pt-4">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'analytics', label: 'Analytics' },
                { id: 'forecast', label: 'Forecasts' },
                ...(isAuthority() ? [{ id: 'ai', label: 'AI analyses' }] : []),
              ]}
            />
          </div>

          {tab === 'overview' ? (
            <div className="space-y-5 px-5 py-5">
              <LivePanel
                reading={live}
                pollutant={pollutant}
                series={(detail.seriesAll ?? [])
                  .filter((row) => row.pollutant_code === pollutant)
                  .map((row) => ({ observedAt: row.observed_at, value: Number(row.value) }))}
                transport={transport}
                status={status}
              />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(detail.station.values).map(([code, value]) => (
                  <div key={code} className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                    <DataLabel>{code.toUpperCase()}</DataLabel>
                    <p className="mt-1 text-lg font-semibold text-[#142016]">{number(value.value)} <span className="text-[10px] font-normal text-[#6f7f74]">{value.unit}</span></p>
                    <p className="mt-1 text-[9px] text-[#66766b]">{value.qualityState} · {value.sourceId}</p>
                  </div>
                ))}
                {Object.keys(detail.station.values).length === 0 ? <p className="col-span-full text-xs text-[#6f7f74]">No recent values available.</p> : null}
              </div>
              <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                <div className="flex items-center justify-between"><DataLabel>Station identity</DataLabel><span className="text-[9px] text-[#66766b]">{detail.station.provider}</span></div>
                <div className="mt-3 grid gap-2 text-[11px] text-[#5a6a5f] sm:grid-cols-2">
                  <p>Identifier <span className="text-[#1b2a1f]">{detail.station.code}</span></p>
                  <p>Type <span className="text-[#1b2a1f]">{detail.station.stationType}</span></p>
                  <p>Locality <span className="text-[#1b2a1f]">{detail.station.localityName ?? '—'}</span></p>
                  <p>Coordinates <span className="text-[#1b2a1f]">{detail.station.lat.toFixed(5)}, {detail.station.lng.toFixed(5)}</span></p>
                  <p>Last seen <span className="text-[#1b2a1f]">{formatDate(detail.station.lastSeenAt)}</span></p>
                  <p>Quality note <span className="text-[#1b2a1f]">{detail.dataQuality.note}</span></p>
                </div>
              </div>
              {detail.station.aqi ? (
                <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                  <div className="flex items-center justify-between"><DataLabel>Indicative AQI</DataLabel><RiskBadge level={detail.station.aqi.category === 'Good' || detail.station.aqi.category === 'Satisfactory' ? 'LOW' : detail.station.aqi.category === 'Moderate' ? 'MODERATE' : detail.station.aqi.category === 'Poor' ? 'HIGH' : 'CRITICAL'} /></div>
                  <p className="display mt-2 text-4xl font-bold" style={{ color: AQI_COLORS[detail.station.aqi.category] }}>{detail.station.aqi.aqi}</p>
                  <p className="mt-1 text-xs font-medium text-[#26362a]">{detail.station.aqi.category} · dominant {detail.station.aqi.dominantPollutant?.toUpperCase()}</p>
                  <p className="mt-2 text-[10px] leading-relaxed text-[#66766b]">{detail.station.aqi.caveat}</p>
                </div>
              ) : null}
              <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                <DataLabel>Weather context</DataLabel>
                {detail.weather ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[#5a6a5f]">
                    <p>Temperature <span className="text-[#1b2a1f]">{number(detail.weather.temperature_c)}°C</span></p>
                    <p>Humidity <span className="text-[#1b2a1f]">{number(detail.weather.relative_humidity, 0)}%</span></p>
                    <p>Wind <span className="text-[#1b2a1f]">{number(detail.weather.wind_speed_kmh)} km/h · {number(detail.weather.wind_direction_deg, 0)}°</span></p>
                    <p>Rain <span className="text-[#1b2a1f]">{number(detail.weather.precipitation_mm)} mm</span></p>
                    <p className="col-span-2 text-[9px] text-[#66766b]">Observed {formatDate(detail.weather.observed_at)} · source {detail.weather.source_id} · weather is context, not evidence of causation.</p>
                  </div>
                ) : <p className="mt-2 text-[11px] text-[#66766b]">No weather observation available.</p>}
              </div>
              {screen ? (
                <div className="rounded-xl border border-[#efd3bd] bg-gradient-to-br from-[#fff7ef] via-[#fdfaf4] to-[#f7f4ea] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <DataLabel>Industrial source screen</DataLabel>
                    <span
                      className="rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em]"
                      style={{ color: impactTone(screen.impactLevel).color, background: impactTone(screen.impactLevel).background, borderColor: impactTone(screen.impactLevel).border }}
                    >
                      {impactTone(screen.impactLevel).label}
                    </span>
                  </div>
                  {screen.sources.length ? (
                    <>
                      <p className="mt-2 text-[11px] leading-relaxed text-[#5a4636]">
                        This monitor falls inside the plume screen of <strong className="text-[#7c2d12]">{screen.primarySourceName}</strong>. The screen attributes{' '}
                        <strong>{screen.estimatedSharePct}%</strong> of the industrial contribution here to that source.
                      </p>
                      <div className="mt-3 space-y-2.5">
                        {screen.sources.map((contribution, index) => (
                          <button
                            key={contribution.sourceId}
                            type="button"
                            onClick={() => onSourceSelect?.(contribution.sourceId)}
                            className="block w-full text-left"
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px]">
                              <span className="truncate font-medium text-[#5a4636]">{contribution.sourceName}</span>
                              <span className="shrink-0 text-[#8a5a3b]">{contribution.contributionPct}% · ~{contribution.estimatedContributionPm25} µg/m³</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f0e2d5]">
                              <div className="h-full rounded-full" style={{ width: `${Math.max(3, contribution.contributionPct)}%`, background: sourceColor(index + 1) }} />
                            </div>
                            <p className="mt-0.5 text-[8px] text-[#9a7b66]">
                              {contribution.distanceKm} km · {contribution.downwind ? 'downwind' : 'plume edge'} · open source
                            </p>
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[9px] leading-relaxed text-[#9a7b66]">
                        Wind {screen.wind.fromLabel} at {number(screen.wind.speedKmh)} km/h. {screen.note}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[11px] leading-relaxed text-[#6f5b4b]">
                      No industrial source is inside this monitor&apos;s screening footprint right now. The screen is re-evaluated as the wind and timeline change.
                    </p>
                  )}
                  <p className="mt-2 text-[8px] leading-relaxed text-[#9a7b66]">{screen.disclaimer}</p>
                </div>
              ) : null}
              <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                <DataLabel>Nearby context</DataLabel>
                <div className="mt-2 space-y-2">
                  {detail.nearbyStations.slice(0, 4).map((station) => (
                    <div key={station.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-[#405246]">{station.name.replace(' demo air monitor', '')}</span>
                      <span className="text-[#66766b]">{Math.round(station.distance_m)} m · PM2.5 {station.latest_pm25 ?? '—'}</span>
                    </div>
                  ))}
                  {detail.nearbyStations.length === 0 ? <p className="text-[11px] text-[#66766b]">No nearby stations within 6 km.</p> : null}
                </div>
                <p className="mt-2 text-[9px] text-[#66766b]">Proximity is not evidence of a common source.</p>
              </div>
              {detail.nearbyReports.length ? (
                <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                  <DataLabel>Nearby citizen reports</DataLabel>
                  <div className="mt-2 space-y-2">
                    {detail.nearbyReports.slice(0, 4).map((report) => (
                      <div key={report.id} className="text-[11px] text-[#5a6a5f]">
                        <span className="text-[#26362a]">{report.public_ref}</span> · {report.incident_type.replace(/_/g, ' ')} · {Math.round(report.distance_m)} m · {report.verification_state}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {detail.risk ? (
                <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                  <div className="flex items-center justify-between"><DataLabel>Risk assessment</DataLabel><RiskBadge level={detail.risk.risk_level} /></div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                    <div><DataLabel>Risk score</DataLabel><p className="mt-1 text-lg font-semibold">{detail.risk.risk_score ?? '—'}/100</p></div>
                    <div><DataLabel>Confidence</DataLabel><p className="mt-1 text-lg font-semibold">{detail.risk.confidence_score ?? '—'}/100 · {detail.risk.confidence_level}</p></div>
                  </div>
                  <p className="mt-2 text-[9px] leading-relaxed text-[#66766b]">{detail.risk.method} · {detail.risk.ruleset_version}</p>
                  {detail.risk.missing_inputs.length ? <p className="mt-2 text-[9px] text-amber-600/70">Missing: {detail.risk.missing_inputs.join('; ')}</p> : null}
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
              <p className="text-[9px] leading-relaxed text-[#66766b]">Stored observations only. Missing periods are not interpolated. Simulation-labelled values are not official monitoring records.</p>
              <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                <DataLabel>Anomaly check</DataLabel>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">{detail.anomaly.status}</span>
                  <Badge tone={detail.anomaly.status === 'UNUSUAL' ? 'amber' : 'neutral'}>z = {detail.anomaly.zScore ?? '—'}</Badge>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-[#66766b]">{detail.anomaly.method}. This is an analytical check.</p>
              </div>
              <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                <DataLabel>Pollutant breakdown</DataLabel>
                <div className="mt-2 space-y-2">
                  {pollutantBreakdown.map((item) => (
                    <div key={item.code} className="flex items-center justify-between text-[11px]">
                      <span className="text-[#5a6a5f]">{item.code}</span>
                      <span className="text-[#1b2a1f]">{number(item.value)} {item.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'forecast' ? (
            <div className="space-y-4 px-5 py-5">
              <div className={`rounded-xl border p-3 text-[10px] leading-relaxed ${detail.forecastStatus.availableMethod === 'LIGHTGBM_TRAINED' ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-700/80' : 'border-amber-500/25 bg-amber-500/[0.06] text-amber-700/80'}`}>
                <strong>{detail.forecastStatus.availableMethod === 'LIGHTGBM_TRAINED' ? `Trained model active${detail.forecastStatus.modelVersion ? ` · ${detail.forecastStatus.modelVersion}` : ''}.` : 'Persistence baseline active.'}</strong> {detail.forecastStatus.note}
              </div>
              {detail.forecasts.length ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {detail.forecasts.map((forecast) => (
                    <div key={forecast.horizonHours} className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                      <DataLabel>+{forecast.horizonHours} hour</DataLabel>
                      <p className="mt-1 text-xl font-semibold text-[#142016]">{forecast.predictedValue} <span className="text-[10px] font-normal text-[#6f7f74]">µg/m³</span></p>
                      <p className="mt-1 text-[9px] text-[#66766b]">{detail.forecastStatus.availableMethod === 'LIGHTGBM_TRAINED' ? 'Quantile 10–90' : 'Empirical band'} {forecast.lowerBound}–{forecast.upperBound}</p>
                      <p className="mt-2 text-[8px] uppercase tracking-[0.08em] text-amber-600/70">{forecast.method}</p>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="FORECAST UNAVAILABLE" description="Insufficient stored history for a persistence baseline." icon={<CalendarClock className="h-5 w-5" />} />}
              <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4 text-[10px] leading-relaxed text-[#6f7f74]">
                <p><strong className="text-[#26362a]">Method:</strong> {detail.forecastStatus.availableMethod}</p>
                <p className="mt-1"><strong className="text-[#26362a]">SHAP:</strong> {detail.forecastStatus.shap}</p>
                <p className="mt-1">Forecasts are not confirmed future conditions and never constitute a regulatory determination.</p>
              </div>
              {detail.alerts.length ? (
                <div className="space-y-2">
                  <DataLabel>Linked alerts</DataLabel>
                  {detail.alerts.map((alert) => (
                    <div key={alert.id} className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                      <div className="flex items-center justify-between gap-2"><RiskBadge level={alert.level} /><span className="text-[8px] uppercase text-[#66766b]">{alert.trigger_type}</span></div>
                      <p className="mt-1 text-[11px] font-medium text-[#26362a]">{alert.title}</p>
                      <p className="mt-0.5 text-[9px] text-[#66766b]">{formatDate(alert.triggered_at)}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {isAuthority() && tab === 'ai' ? (
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
                    className={`rounded-xl border p-3 text-left transition ${aiType === type ? 'border-[#5b9e46]/45 bg-[#5b9e46]/[0.06]' : 'border-[#dfe6db] bg-[#f5f8f2] hover:border-[#c3d0bf]'}`}
                  >
                    <p className="text-[11px] font-semibold text-[#1b2a1f]">{label}</p>
                    <p className="mt-1 text-[9px] leading-relaxed text-[#66766b]">{copy}</p>
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
                  <p className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 text-[11px] leading-relaxed text-[#405246]">{ai.narrative}</p>
                  <details
                    open={evidenceOpen}
                    onToggle={(event) => setEvidenceOpen(event.currentTarget.open)}
                    className="group space-y-3"
                  >
                    <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-[#3f7d2a] hover:text-[#142016] [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                      Evidence and references
                    </summary>
                    {[
                      ['OBSERVED', ai.sections.observed, 'green'],
                      ['PREDICTED', ai.sections.predicted, 'teal'],
                      ['REPORTED', ai.sections.reported, 'amber'],
                      ['ANALYSIS / REASONING', ai.sections.estimated, 'neutral'],
                      ['REFERENCE STANDARDS', ai.sections.standards, 'neutral'],
                      ['LIMITATIONS', ai.sections.limitations, 'red'],
                      ['NEXT ACTIONS', ai.sections.nextActions, 'lime'],
                    ].map(([label, items, tone]) => Array.isArray(items) && items.length ? (
                      <div key={String(label)} className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                        <Badge tone={tone as never}>{String(label)}</Badge>
                        <ul className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-[#5a6a5f]">
                          {items.map((item, index) => <li key={index} className="flex gap-2"><span className="text-[#66766b]">—</span><AiActionText text={item} /></li>)}
                        </ul>
                      </div>
                    ) : null)}
                    {ai.citations.length ? (
                      <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                        <DataLabel>Source references</DataLabel>
                        <ul className="mt-2 space-y-1 text-[10px] text-[#5a6a5f]">
                          {ai.citations.map((citation, index) => (
                            <li key={index}>{citation.title} · {citation.section} · {citation.authority}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </details>
                  <p className="text-[9px] leading-relaxed text-[#66766b]">{ai.disclaimer}</p>
                </div>
              ) : !aiLoading ? (
                <p className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4 text-[10px] leading-relaxed text-[#6f7f74]">
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

function SourceSheet({
  source,
  wind,
  attributions,
  onClose,
  onStationSelect,
}: {
  source: SourceImpactSource | null;
  wind: SourceImpactWind | null;
  attributions: StationSourceAttribution[];
  onClose: () => void;
  onStationSelect: (id: string) => void;
}) {
  const entries = useMemo(() => {
    if (!source) return [];
    return attributions
      .flatMap((attribution) => {
        const contribution = attribution.sources.find((item) => item.sourceId === source.id);
        return contribution && contribution.contributionPct >= 8 ? [{ attribution, contribution }] : [];
      })
      .sort((a, b) => b.contribution.contributionPct - a.contribution.contributionPct);
  }, [source, attributions]);

  return (
    <Sheet
      open={Boolean(source)}
      onOpenChange={(open) => !open && onClose()}
      title={source?.name ?? 'Industrial source'}
      description={source ? `${source.type} · ${source.localityName} · simulated source` : 'Loading source…'}
    >
      {source ? (
        <div className="space-y-5 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="amber" dot>Rank #{source.rank}</Badge>
            <Badge tone="neutral">Emission index {source.emissionIndex}/100</Badge>
            <Badge tone="teal">Plume screen {source.plumeLengthKm} km</Badge>
            <Badge tone="outline">Simulated</Badge>
          </div>

          <div className="rounded-2xl border border-[#efd3bd] bg-gradient-to-br from-[#fff8f1] to-[#fdfcf7] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <DataLabel>Screening rank</DataLabel>
                <p className="display mt-1 text-[26px] font-bold leading-none tracking-[-0.04em] text-[#7c2d12]">#{source.rank}</p>
              </div>
              <div className="text-right text-[10px] text-[#8a5a3b]">
                <p>Screened city impact <strong>{source.impactScore}</strong></p>
                <p>{source.affectedMonitors} monitor(s) downwind</p>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[#5a4636]">
              When wind arrives from <strong>{wind?.fromLabel ?? '—'}</strong> at {number(wind?.speedKmh ?? 0)} km/h, the plume footprint points{' '}
              {source.plumeBearingDeg}° and can cover about {source.estimatedLandKm2} km² in this screen. Monitors and localities inside that footprint are flagged below.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-[#6f5b4b] sm:grid-cols-4">
              <div className="rounded-xl border border-white/80 bg-white/55 p-2.5"><DataLabel>Stack</DataLabel><p className="mt-1 font-semibold text-[#3f2b1d]">{source.stackHeightM} m</p></div>
              <div className="rounded-xl border border-white/80 bg-white/55 p-2.5"><DataLabel>Pollutant</DataLabel><p className="mt-1 font-semibold text-[#3f2b1d]">{source.primaryPollutant}</p></div>
              <div className="rounded-xl border border-white/80 bg-white/55 p-2.5"><DataLabel>Plume footprint</DataLabel><p className="mt-1 font-semibold text-[#3f2b1d]">{source.estimatedLandKm2} km²</p></div>
              <div className="rounded-xl border border-white/80 bg-white/55 p-2.5"><DataLabel>Wind from</DataLabel><p className="mt-1 font-semibold text-[#3f2b1d]">{wind?.fromLabel ?? '—'} · {number(wind?.speedKmh ?? 0)} km/h</p></div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <DataLabel>Monitors in this plume</DataLabel>
              <Badge tone="neutral">{entries.length}</Badge>
            </div>
            <div className="mt-2 space-y-2">
              {entries.map(({ attribution, contribution }) => {
                const tone = impactTone(attribution.impactLevel);
                return (
                  <button
                    key={attribution.stationId}
                    type="button"
                    onClick={() => onStationSelect(attribution.stationId)}
                    className="block w-full rounded-xl border border-[#ecdfd2] bg-white/60 p-3 text-left transition hover:border-[#d9b795] hover:bg-white"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold text-[#3f2b1d]">{attribution.stationName.replace(' demo air monitor', '')}</p>
                        <p className="mt-0.5 text-[9px] text-[#9a7b66]">{attribution.localityName ?? 'Mumbai'} · {contribution.distanceKm} km · {contribution.downwind ? 'downwind' : 'plume edge'}</p>
                      </div>
                      <span className="rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em]" style={{ color: tone.color, background: tone.background, borderColor: tone.border }}>
                        {tone.label}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f0e2d5]">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(3, contribution.contributionPct)}%`, background: sourceColor(source.rank) }} />
                      </div>
                      <span className="w-24 text-right text-[9px] font-semibold text-[#8a5a3b]">{contribution.contributionPct}% · ~{contribution.estimatedContributionPm25} µg/m³</span>
                    </div>
                  </button>
                );
              })}
              {entries.length === 0 ? (
                <p className="rounded-xl border border-[#ecdfd2] bg-white/55 p-4 text-[10px] leading-relaxed text-[#8a7565]">
                  No monitor currently passes the screening threshold for this source. The plume footprint still shows where the screen places the downwind area.
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-[#ecdfd2] bg-[#fdf8f2] p-4 text-[9px] leading-relaxed text-[#8a7565]">
            <p>{source.note}</p>
            <p className="mt-1">Source shares are a distance-and-wind screening estimate, not a measured apportionment. No legal threshold is applied and this is not a regulatory determination.</p>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

export function MapPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthority } = useAuth();
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(params.get('station'));
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [analysisPoint, setAnalysisPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [showSources, setShowSources] = useState(true);
  const [showPlumes, setShowPlumes] = useState(true);
  const [showImpactLinks, setShowImpactLinks] = useState(true);
  const [sourceListExpanded, setSourceListExpanded] = useState(false);
  const [liveTick, setLiveTick] = useState(0);
  const liveFeed = useLiveFeed();
  const playRef = useRef<number | null>(null);

  // New minute readings re-pull the current map frame.
  useEffect(() => {
    if (!liveFeed.generatedAt) return;
    if (playing) return;
    if (timeline[timelineIndex]?.offset !== 0) return;
    setLiveTick((tick) => tick + 1);
  }, [liveFeed.generatedAt, playing, timeline, timelineIndex]);

  useEffect(() => {
    const query = new URLSearchParams();
    if (selectedStationId) query.set('station', selectedStationId);
    setParams(query, { replace: true });
  }, [selectedStationId, setParams]);

  useEffect(() => {
    // "Current" must track real time, not the moment the page mounted.
    const slot = timeline[timelineIndex];
    const at = slot && slot.offset === 0 ? new Date() : slot?.date ?? new Date();
    if (!data) setLoading(true);
    const query = new URLSearchParams({
      at: at.toISOString(),
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
  }, [timeline, timelineIndex, category, localityId, pollutant, sourceId, severity, verification, includeForecast, liveTick]);

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

  const stations = useMemo(
    () => (data?.stations ?? []).map((station) => stationToMap(station, data?.sourceImpact?.stationAttributions[station.id])),
    [data],
  );
  const sourceImpact = data?.sourceImpact ?? null;
  const sourceAttributions = useMemo(() => Object.values(sourceImpact?.stationAttributions ?? {}), [sourceImpact]);
  const affectedAttributions = useMemo(
    () => sourceAttributions.filter((attribution) => attribution.impactLevel !== 'NONE').sort((a, b) => b.estimatedSharePct - a.estimatedSharePct),
    [sourceAttributions],
  );
  const worstSources = sourceImpact?.sources ?? [];
  const worstSource = worstSources[0] ?? null;
  const highestEmission = [...worstSources].sort((a, b) => b.emissionIndex - a.emissionIndex)[0] ?? null;
  const selectedSource = worstSources.find((source) => source.id === selectedSourceId) ?? null;
  const sourceLinks = useMemo<MapSourceLink[]>(() => {
    if (!sourceImpact) return [];
    const stationById = new Map((data?.stations ?? []).map((station) => [station.id, station]));
    const sourceById = new Map(sourceImpact.sources.map((source) => [source.id, source]));
    const links: MapSourceLink[] = [];
    for (const attribution of Object.values(sourceImpact.stationAttributions)) {
      const station = stationById.get(attribution.stationId);
      if (!station) continue;
      for (const contribution of attribution.sources.slice(0, 2)) {
        if (contribution.contributionPct < 15) continue;
        const source = sourceById.get(contribution.sourceId);
        if (!source) continue;
        links.push({
          id: `${source.id}:${station.id}`,
          sourceId: source.id,
          stationId: station.id,
          from: [source.lng, source.lat],
          to: [station.lng, station.lat],
          sharePct: contribution.contributionPct,
          color: sourceColor(source.rank),
          sourceName: source.name,
          stationName: station.name,
        });
      }
    }
    return links;
  }, [data, sourceImpact]);

  const sourceMixOption = useMemo(() => {
    const active = worstSources.filter((source) => source.impactScore > 0).slice(0, 6);
    return {
      tooltip: { trigger: 'item', formatter: '{b}<br/>{c} screened impact · {d}%' },
      series: [
        {
          type: 'pie',
          radius: ['56%', '82%'],
          center: ['50%', '48%'],
          itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 6 },
          data: active.map((source) => ({
            name: `${source.name}`,
            value: source.impactScore,
            itemStyle: { color: sourceColor(source.rank) },
          })),
        },
      ],
      graphic: [
        { type: 'text', left: 'center', top: '40%', style: { text: 'CITY', fill: '#9a7b66', fontSize: 9, fontWeight: 700, letterSpacing: 2 } },
        { type: 'text', left: 'center', top: '48%', style: { text: 'SOURCE MIX', fill: '#7c2d12', fontSize: 10, fontWeight: 700, letterSpacing: 1 } },
      ],
    };
  }, [worstSources]);

  const monitorMixOption = useMemo(() => {
    const chartStations = affectedAttributions.slice(0, 6);
    const primaryIds = new Set(chartStations.map((station) => station.primarySourceId).filter((id): id is string => Boolean(id)));
    const chartSources = worstSources.filter((source) => source.rank <= 3 || primaryIds.has(source.id));
    if (!chartStations.length || !chartSources.length) return {};
    const series = chartSources.map((source) => ({
      name: source.name,
      type: 'bar',
      stack: 'attribution',
      barWidth: 16,
      itemStyle: { color: sourceColor(source.rank) },
      data: chartStations.map((station) => station.sources.find((item) => item.sourceId === source.id)?.contributionPct ?? 0),
    }));
    const other = chartStations.map((station) => {
      const attributed = chartSources.reduce((sum, source) => sum + (station.sources.find((item) => item.sourceId === source.id)?.contributionPct ?? 0), 0);
      return Math.max(0, Number((100 - attributed).toFixed(1)));
    });
    if (other.some((value) => value > 0.5)) {
      series.push({ name: 'Other sources', type: 'bar', stack: 'attribution', barWidth: 16, itemStyle: { color: '#d8c4b2' }, data: other });
    }
    return {
      grid: { ...chartGrid, left: 12, top: 32, bottom: 54 },
      tooltip: { ...chartTooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { type: 'scroll', top: 0, left: 0, right: 0, textStyle: { color: '#7c6a5c', fontSize: 9 }, itemWidth: 8, itemHeight: 8 },
      xAxis: {
        type: 'category',
        data: chartStations.map((station) => station.stationName.replace(' demo air monitor', '').replace(', Mumbai - IITM', '').replace(', Mumbai - MPCB', '').replace(', Mumbai - BMC', '')),
        ...chartAxis,
        axisLabel: { ...chartAxis.axisLabel, interval: 0, rotate: 24, fontSize: 9 },
      },
      yAxis: { type: 'value', max: 100, name: '%', nameTextStyle: { color: '#8a7565', fontSize: 9 }, ...chartAxis },
      series,
    };
  }, [affectedAttributions, worstSources]);

  const sourceRankingOption = useMemo(() => {
    const ranked = worstSources.filter((source) => source.impactScore > 0).slice(0, 8).reverse();
    return {
      grid: { ...chartGrid, left: 8, right: 44, top: 12, bottom: 18 },
      tooltip: { ...chartTooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params: Array<{ dataIndex: number; value: number }>) => {
        const point = params[0];
        const source = ranked[point?.dataIndex ?? 0];
        return source ? `<div style="font-size:10px;color:#8a7565">${source.localityName}</div><div style="font-size:12px;font-weight:600;color:#7c2d12">${source.name}</div><div style="margin-top:3px;font-size:10px">${source.impactScore} screened impact · ${source.affectedMonitors} monitor(s)</div>` : '';
      } },
      xAxis: { type: 'value', ...chartAxis, axisLabel: { ...chartAxis.axisLabel, fontSize: 9 } },
      yAxis: {
        type: 'category',
        data: ranked.map((source) => `#${source.rank} ${source.name}`),
        ...chartAxis,
        axisLabel: { ...chartAxis.axisLabel, fontSize: 9, width: 130, overflow: 'truncate' },
      },
      series: [
        {
          type: 'bar',
          barWidth: 13,
          data: ranked.map((source) => ({ value: source.impactScore, itemStyle: { color: sourceColor(source.rank), borderRadius: [0, 5, 5, 0] } })),
          label: { show: true, position: 'right', color: '#8a5a3b', fontSize: 9 },
        },
      ],
    };
  }, [worstSources]);

  const stationDataMode = data?.stations.some((station) => station.isSimulated) && data?.stations.some((station) => !station.isSimulated)
    ? 'MIXED'
    : data?.stations.some((station) => !station.isSimulated)
      ? 'LIVE_SOURCE'
      : 'SIMULATION';
  const reports: MapReport[] = useMemo(() => (data?.reports ?? []).map((report) => ({ ...report, verification_state: report.verification_state })), [data]);
  const incidents: MapIncident[] = useMemo(() => data?.incidents ?? [], [data]);
  const current = timeline[timelineIndex];
  const selectedLocality = data?.localities.find((l) => l.id === localityId);
  const activeFilterCount =
    (category !== 'air' ? 1 : 0) +
    (pollutant !== 'aqi' ? 1 : 0) +
    (localityId ? 1 : 0) +
    (sourceId ? 1 : 0) +
    (severity ? 1 : 0) +
    (verification ? 1 : 0) +
    (!includeForecast ? 1 : 0);

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
    setSelectedSourceId(null);
    setAnalysisPoint(null);
    setShowSources(true);
    setShowPlumes(true);
    setShowImpactLinks(true);
    setSourceListExpanded(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="lime" dot>Mumbai boundary</Badge>
            <Badge tone={current.offset === 0 ? 'green' : current.offset > 0 ? 'teal' : 'neutral'}>{current.offset === 0 ? 'CURRENT' : current.offset > 0 ? 'FORECAST' : 'PAST'}</Badge>
            <Badge tone={stationDataMode === 'SIMULATION' ? 'amber' : stationDataMode === 'MIXED' ? 'teal' : 'green'}>
              {stationDataMode === 'SIMULATION' ? 'Station data simulated' : stationDataMode === 'MIXED' ? 'Mixed station sources' : 'Connected station source'}
            </Badge>
            {sourceImpact ? <Badge tone="amber" dot>Factory plume screen active</Badge> : null}
          </div>
          <h2 className="display mt-2 text-[24px] font-bold tracking-[-0.04em]">Live environmental intelligence map</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6f7f74]">
            Measured, predicted, reported and official records stay visually distinct. Simulated factories now cast a wind-aligned plume screen, flag affected monitors and show which sources may be influencing the land around them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="dark" size="sm" onClick={() => setFiltersOpen((v) => !v)}>
            <Filter className="h-3.5 w-3.5" /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
          <Button variant="dark" size="sm" onClick={reset}><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
        </div>
      </div>

      {filtersOpen ? (
        <div className="grid gap-2 rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-3 md:grid-cols-2 xl:grid-cols-6">
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
            <label className="flex items-center gap-2 text-[10px] text-[#5a6a5f]">
              <input type="checkbox" checked={includeForecast} onChange={(e) => setIncludeForecast(e.target.checked)} className="h-3.5 w-3.5 accent-[#5b9e46]" />
              Forecast layer
            </label>
            <label className="flex items-center gap-2 text-[10px] text-[#66766b]" title="No interpolated surface is produced.">
              <input type="checkbox" disabled className="h-3.5 w-3.5" />
              Estimated zones (unavailable)
            </label>
            <span className="ml-auto text-[9px] text-[#66766b]">{selectedLocality ? `${selectedLocality.name} filter active` : 'Greater Mumbai · all localities'}</span>
          </div>
        </div>
      ) : null}

      {sourceImpact ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={() => setSelectedSourceId(worstSource?.id ?? null)}
            className="group flex items-center gap-3 rounded-2xl border border-[#efd3bd] bg-gradient-to-br from-[#fff7ef] to-[#fdfcf7] p-3 text-left transition hover:-translate-y-0.5 hover:border-[#dfb58f] hover:shadow-[0_18px_36px_-32px_rgba(124,45,18,.65)]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#7c2d12] text-white shadow-[0_10px_24px_-14px_rgba(124,45,18,.8)]"><Factory className="h-4 w-4" /></span>
            <div className="min-w-0">
              <DataLabel>Worst source</DataLabel>
              <p className="mt-0.5 truncate text-[12px] font-semibold text-[#3f2b1d]">{worstSource?.name ?? 'None in range'}</p>
              <p className="mt-0.5 text-[9px] text-[#9a7b66]">Rank #{worstSource?.rank ?? '—'} · emission {worstSource?.emissionIndex ?? '—'}/100 · {worstSource?.affectedMonitors ?? 0} monitor(s)</p>
            </div>
          </button>
          <div className="flex items-center gap-3 rounded-2xl border border-[#e6d5c5] bg-white/65 p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fdf1e6] text-[#b45309]"><Wind className="h-4 w-4" /></span>
            <div>
              <DataLabel>Plume wind</DataLabel>
              <p className="mt-0.5 text-[12px] font-semibold text-[#3f2b1d]">{sourceImpact.wind.fromLabel} · {number(sourceImpact.wind.speedKmh)} km/h</p>
              <p className="mt-0.5 text-[9px] text-[#9a7b66]">From {number(sourceImpact.wind.directionDeg, 0)}° · downwind {number((sourceImpact.wind.directionDeg + 180) % 360, 0)}°</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-[#e6d5c5] bg-white/65 p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fdf1e6] text-[#9a3412]"><Radio className="h-4 w-4" /></span>
            <div>
              <DataLabel>Monitors flagged</DataLabel>
              <p className="mt-0.5 text-[12px] font-semibold text-[#3f2b1d]">{sourceImpact.landImpact.affectedStations} <span className="text-[9px] font-normal text-[#9a7b66]">of {data?.stations.length ?? 0} shown</span></p>
              <p className="mt-0.5 text-[9px] text-[#9a7b66]">Downwind screening footprint</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-[#e6d5c5] bg-white/65 p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fdf1e6] text-[#a16207]"><MapPin className="h-4 w-4" /></span>
            <div>
              <DataLabel>Plume area</DataLabel>
              <p className="mt-0.5 text-[12px] font-semibold text-[#3f2b1d]">{sourceImpact.landImpact.impactedAreaKm2} km²</p>
              <p className="mt-0.5 text-[9px] text-[#9a7b66]">Screened footprint · not a measured area</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="relative overflow-hidden rounded-2xl border border-[#dfe6db] bg-[#ffffff]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e7ece3] px-3 py-2">
            <div className="flex items-center gap-2 text-[10px] text-[#5a6a5f]">
              <Clock className="h-3.5 w-3.5 text-[#3f7d2a]" />
              <span className="font-semibold text-[#26362a]">{formatDate(current.date.toISOString())}</span>
              <span className="text-[#66766b]">Asia/Kolkata</span>
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
              incidents={isAuthority() ? incidents : []}
              sources={sourceImpact?.sources ?? []}
              sourceLinks={sourceLinks}
              selectedStationId={selectedStationId}
              selectedSourceId={selectedSourceId}
              focusPoint={analysisPoint}
              onStationSelect={(id) => { setSelectedStationId(id); setSelectedSourceId(null); setAnalysisPoint(null); }}
              onSourceSelect={(id) => { setSelectedStationId(null); setSelectedSourceId(id); setAnalysisPoint(null); }}
              onMapClick={(point) => { setSelectedStationId(null); setSelectedSourceId(null); setAnalysisPoint(point); }}
              onReportSelect={isAuthority() ? (id) => navigate(`/reports/${id}`) : undefined}
              onIncidentSelect={isAuthority() ? (id) => navigate(`/incidents/${id}`) : undefined}
              showSources={showSources}
              showPlumes={showPlumes}
              showImpactLinks={showImpactLinks}
              className="h-[calc(100vh-300px)] min-h-[480px] w-full"
              theme="light"
              showBuildings
              autoFit={false}
              initialZoom={12.2}
              initialPitch={55}
            />
            {sourceImpact ? (
              <div className="absolute left-3 top-14 z-10 flex flex-wrap items-center gap-1.5 rounded-2xl border border-[#e6d5c5]/90 bg-white/80 p-1.5 shadow-[0_18px_36px_-32px_rgba(70,38,15,.5)] backdrop-blur">
                <span className="px-1.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#8a7565]">Layers</span>
                <button
                  type="button"
                  onClick={() => setShowSources((value) => !value)}
                  aria-pressed={showSources}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[8.5px] font-semibold uppercase tracking-[0.06em] transition ${showSources ? 'border-[#c2410c]/30 bg-[#fdf0e7] text-[#9a3412]' : 'border-[#dfe6db] bg-white/60 text-[#7a8a7e]'}`}
                >
                  <Factory className="h-3 w-3" /> Factories
                </button>
                <button
                  type="button"
                  onClick={() => setShowPlumes((value) => !value)}
                  aria-pressed={showPlumes}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[8.5px] font-semibold uppercase tracking-[0.06em] transition ${showPlumes ? 'border-[#b45309]/30 bg-[#fdf5e5] text-[#a16207]' : 'border-[#dfe6db] bg-white/60 text-[#7a8a7e]'}`}
                >
                  <Wind className="h-3 w-3" /> Plumes
                </button>
                <button
                  type="button"
                  onClick={() => setShowImpactLinks((value) => !value)}
                  aria-pressed={showImpactLinks}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[8.5px] font-semibold uppercase tracking-[0.06em] transition ${showImpactLinks ? 'border-[#9a3412]/30 bg-[#fdf0e7] text-[#9a3412]' : 'border-[#dfe6db] bg-white/60 text-[#7a8a7e]'}`}
                >
                  <Link2 className="h-3 w-3" /> Impact links
                </button>
              </div>
            ) : null}
            <div className="pointer-events-none absolute bottom-3 left-3 z-10">
              <div className="pointer-events-auto rounded-xl border border-[#dfe6db] bg-[#f5f8f2]/90 px-3 py-2 text-[9px] backdrop-blur">
                <p className="font-semibold uppercase tracking-[0.1em] text-[#5a6a5f]">Marker legend</p>
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[#5a6a5f]">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#5b9e46]" /> Measured</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[#2f8f84]" /> Predicted</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#b3860f]" /> Citizen report</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[#c94a50]" /> Incident</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#c2410c]" /> Factory source</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-[#c2410c]/20" /> Plume screen</span>
                </div>
                <p className="mt-2 max-w-[210px] border-t border-dashed border-[#dbe5d6] pt-1.5 text-[8px] leading-relaxed text-[#66766b]">
                  3D heights are visual context. Plume footprints are a simulated wind screen, not measured pollution.
                </p>
              </div>
            </div>
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 hidden max-w-[240px] -translate-x-1/2 rounded-xl border border-[#2f8f84]/25 bg-white/90 px-3 py-2 text-[9px] leading-relaxed text-[#37655e] shadow-pill backdrop-blur lg:block">
              <p className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.08em]"><Crosshair className="h-3 w-3" /> Analyse any point</p>
              <p className="mt-1">Click anywhere on the map for the nearest place, evidence, sources and practical guidance.</p>
            </div>
            {loading ? <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#f5f8f2]/40 backdrop-blur-[1px]"><Spinner className="text-[#3f7d2a]" /></div> : null}
          </div>
          <div className="border-t border-[#e7ece3] px-3 py-2">
            <div className="flex items-center justify-between text-[9px] text-[#66766b]">
              <span>{current.label} · {data?.stations.length ?? 0} stations · {data?.reports.length ?? 0} reports · {data?.incidents.length ?? 0} incidents{sourceImpact ? ` · ${sourceImpact.landImpact.affectedStations} plume-flagged` : ''}</span>
              <span>{data?.mode === 'FUTURE' ? 'Forecast values are not confirmed future conditions.' : data?.mode === 'PAST' ? 'Archived observations · ±90 minute match' : 'Latest valid observations · stale stations excluded after 6h'}</span>
            </div>
            <input
              type="range"
              min={0}
              max={timeline.length - 1}
              value={timelineIndex}
              onChange={(e) => { setTimelineIndex(Number(e.target.value)); setPlaying(false); }}
              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#eaf2e4] accent-[#5b9e46]"
              aria-label="Map timeline"
            />
            <div className="mt-1 flex justify-between text-[8px] uppercase tracking-[0.08em] text-[#66766b]">
              {timeline.map((item) => <span key={item.label} className={item.label === current.label ? 'text-[#3f7d2a]' : ''}>{item.label}</span>)}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {data?.warnings.length ? (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-[10px] leading-relaxed text-amber-700/80">
              {data.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
            </div>
          ) : null}
          {sourceImpact ? (
            <div className="overflow-hidden rounded-2xl border border-[#efd3bd] bg-gradient-to-br from-[#fff8f1] via-[#fdfcf8] to-[#f8f5ec]">
              <div className="flex items-center justify-between gap-2 border-b border-[#f0e2d5] px-4 py-3">
                <div>
                  <DataLabel>Worst industrial sources</DataLabel>
                  <p className="mt-0.5 text-[9px] text-[#9a7b66]">Monitor + land screen · simulated facilities</p>
                </div>
                <Badge tone="amber">{windLabel(sourceImpact.wind)}</Badge>
              </div>
              <div className="space-y-1.5 p-2.5">
                {worstSources.slice(0, sourceListExpanded ? 10 : 4).map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => { setSelectedStationId(null); setSelectedSourceId(source.id); }}
                    className="group w-full rounded-xl border border-transparent bg-white/50 p-2.5 text-left transition hover:border-[#e2c6ae] hover:bg-white"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: sourceColor(source.rank) }}>{source.rank}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-semibold text-[#3f2b1d]">{source.name}</p>
                        <p className="truncate text-[8.5px] text-[#9a7b66]">{source.type} · emission {source.emissionIndex}/100 · {source.affectedMonitors} monitor(s)</p>
                      </div>
                      <ChevronRight className="h-3 w-3 shrink-0 text-[#b8a08c] transition group-hover:translate-x-0.5" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f0e2d5]">
                        <div className="h-full rounded-full" style={{ width: `${worstSource && worstSource.impactScore > 0 ? Math.max(4, (source.impactScore / worstSource.impactScore) * 100) : 4}%`, background: sourceColor(source.rank) }} />
                      </div>
                      <span className="text-[8.5px] font-semibold text-[#8a5a3b]">{source.impactScore} impact</span>
                    </div>
                  </button>
                ))}
              </div>
              {highestEmission ? (
                <p className="border-t border-[#f0e2d5] px-4 py-2 text-[8.5px] leading-relaxed text-[#9a7b66]">
                  Largest emission index: <strong className="text-[#8a5a3b]">{highestEmission.name}</strong> · {highestEmission.emissionIndex}/100
                </p>
              ) : null}
              <div className="flex items-center justify-between border-t border-[#f0e2d5] px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setSourceListExpanded((expanded) => !expanded)}
                  className="text-[9px] font-semibold text-[#8a5a3b] transition hover:text-[#7c2d12]"
                >
                  {sourceListExpanded ? 'Show top 4' : `Show all ${worstSources.length}`}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSourceId(worstSource?.id ?? null)}
                  className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#9a3412] transition hover:text-[#7c2d12]"
                >
                  Open worst · #{worstSource?.rank ?? '—'} <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          ) : null}

          {sourceImpact ? (
            <div className="rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-4">
              <div className="flex items-center justify-between">
                <DataLabel>Monitors in the plume screen</DataLabel>
                <Badge tone={affectedAttributions.length ? 'amber' : 'neutral'}>{affectedAttributions.length}</Badge>
              </div>
              <div className="mt-2 space-y-1.5">
                {affectedAttributions.slice(0, 5).map((attribution) => {
                  const tone = impactTone(attribution.impactLevel);
                  return (
                    <button
                      key={attribution.stationId}
                      type="button"
                      onClick={() => { setSelectedSourceId(null); setSelectedStationId(attribution.stationId); }}
                      className="flex w-full items-center gap-2 rounded-xl border border-[#eef1eb] bg-[#f8faf6] p-2 text-left transition hover:border-[#d5e2cf] hover:bg-white"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-semibold text-[#3f5045]">{attribution.stationName.replace(' demo air monitor', '')}</p>
                        <p className="truncate text-[8px] text-[#8a7565]">{attribution.primarySourceName} · {attribution.estimatedSharePct}% share</p>
                      </div>
                      <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[7.5px] font-semibold uppercase tracking-[0.05em]" style={{ color: tone.color, background: tone.background, borderColor: tone.border }}>{attribution.impactLevel}</span>
                    </button>
                  );
                })}
                {affectedAttributions.length === 0 ? <p className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 text-[10px] text-[#66766b]">No monitor passes the screening threshold at this time.</p> : null}
              </div>
            </div>
          ) : null}

          {sourceImpact ? (
            <div className="rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-4">
              <div className="flex items-center justify-between"><DataLabel>City source impact mix</DataLabel><Badge tone="neutral">Screening</Badge></div>
              <Chart height={176} empty={worstSources.every((source) => source.impactScore <= 0)} option={sourceMixOption} />
              <p className="mt-1 text-[8.5px] leading-relaxed text-[#9a7b66]">Share of the screened impact score across the monitors in view: monitor reach, plume footprint and emission index. Not a measured apportionment.</p>
              <button type="button" onClick={() => setSelectedSourceId(worstSource?.id ?? null)} className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-[#9a3412] hover:text-[#7c2d12]">
                Inspect rank #{worstSource?.rank ?? '—'} <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-4">
            <div className="flex items-center justify-between"><DataLabel>Active alerts at selected time</DataLabel><Badge tone="neutral">{data?.alerts.length ?? 0}</Badge></div>
            <div className="mt-2 space-y-2">
              {data?.alerts.slice(0, 5).map((alert) => (
                <button key={alert.id} onClick={() => navigate(`/alerts/${alert.id}`)} className="block w-full rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 text-left hover:border-[#5b9e46]/30">
                  <div className="flex items-center justify-between gap-2"><RiskBadge level={alert.level} /><span className="text-[8px] uppercase text-[#66766b]">{alert.trigger_type}</span></div>
                  <p className="mt-1 text-[11px] font-medium text-[#26362a]">{alert.title}</p>
                  <p className="mt-0.5 text-[9px] text-[#66766b]">{alert.locality_name ?? 'Mumbai'} · {timeAgo(alert.triggered_at)}</p>
                </button>
              ))}
              {data && data.alerts.length === 0 ? <p className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4 text-center text-[10px] text-[#66766b]">No active alerts at this time.</p> : null}
            </div>
          </div>
          <div className="rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-4">
            <DataLabel>Coverage & uncertainty</DataLabel>
            <p className="mt-2 text-[10px] leading-relaxed text-[#6f7f74]">{data?.estimatedZoneNote}</p>
            <div className="mt-3 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 text-[9px] leading-relaxed text-[#66766b]">
              <p><strong className="text-[#5a6a5f]">Boundary:</strong> {data?.boundary.note}</p>
              <p className="mt-1"><strong className="text-[#5a6a5f]">Attribution:</strong> {data?.mapAttribution}</p>
            </div>
          </div>
          {data?.forecastMeta ? (
            <div className="rounded-2xl border border-[#2f8f84]/20 bg-[#2f8f84]/[0.04] p-4">
              <div className="flex items-center justify-between"><DataLabel>Forecast metadata</DataLabel><Badge tone="teal">Baseline</Badge></div>
              <div className="mt-2 space-y-1 text-[10px] text-[#5a6a5f]">
                <p>Method: {String(data.forecastMeta.method ?? '—')}</p>
                <p>Status: {String(data.forecastMeta.status ?? '—')}</p>
                <p>Horizon: {String(data.forecastMeta.horizonHours ?? '—')} h</p>
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-[#66766b]">{String(data.forecastMeta.note ?? '')}</p>
            </div>
          ) : null}
          {isAuthority() ? (
            <div className="rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-4">
              <DataLabel>Nearby reports</DataLabel>
              <div className="mt-2 space-y-2">
                {data?.reports.slice(0, 4).map((report) => (
                  <button key={report.id} onClick={() => navigate(`/reports/${report.id}`)} className="flex w-full items-center justify-between gap-2 text-left text-[10px] text-[#5a6a5f] hover:text-[#142016]">
                    <span>{categoryLabel(report.category)} · {report.incident_type.replace(/_/g, ' ')}</span>
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  </button>
                ))}
                {data && data.reports.length === 0 ? <p className="text-[10px] text-[#66766b]">No reports in this view.</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {sourceImpact ? (
        <div className="grid gap-3 xl:grid-cols-12">
          <Card className="overflow-hidden xl:col-span-7">
            <CardHeader>
              <div>
                <CardTitle>Monitor-by-monitor source mix</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Share of the screened industrial contribution · sources reaching these monitors</p>
              </div>
              <Badge tone="amber">Screening estimate</Badge>
            </CardHeader>
            <div className="px-2 pb-2 pt-3">
              <Chart height={300} empty={affectedAttributions.length === 0} option={monitorMixOption} />
            </div>
            <p className="border-t border-dashed border-[#dbe5d6] px-4 py-2 text-[9px] leading-relaxed text-[#9a7b66]">
              Each bar shows how the screen divides the industrial contribution at a monitor between the factories inside its plume footprint. The remaining share is traffic, dust or other sources outside the simulated catalogue. It is not a measured apportionment.
            </p>
          </Card>

          <Card className="overflow-hidden xl:col-span-5">
            <CardHeader>
              <div>
                <CardTitle>Worst sources in view</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Ranked by screened impact: monitor reach, plume footprint and emission index</p>
              </div>
              <Badge tone="neutral">{worstSources.filter((source) => source.impactScore > 0).length}</Badge>
            </CardHeader>
            <div className="px-2 pb-2 pt-3">
              <Chart height={300} empty={worstSources.every((source) => source.impactScore <= 0)} option={sourceRankingOption} />
            </div>
            <p className="border-t border-dashed border-[#dbe5d6] px-4 py-2 text-[9px] leading-relaxed text-[#9a7b66]">
              A high rank means the source reaches several monitors and localities in the current wind screen, not that a violation has occurred.
            </p>
          </Card>

          <Card className="xl:col-span-12">
            <CardHeader>
              <div>
                <CardTitle>Plume and locality flags</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Places where the wind screen places a factory plume across land and water</p>
              </div>
              <Badge tone="amber">{sourceImpact.landImpact.impactedAreaKm2} km² screened</Badge>
            </CardHeader>
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap gap-1.5">
                {sourceImpact.landImpact.impactedLocalities.map((locality) => (
                  <span key={locality} className="rounded-full border border-[#e6d5c5] bg-[#fdf5ed] px-2.5 py-1 text-[9px] font-medium text-[#8a5a3b]">{locality}</span>
                ))}
                {sourceImpact.landImpact.impactedLocalities.length === 0 ? <span className="text-[10px] text-[#66766b]">No locality passes the screening threshold.</span> : null}
              </div>
              <p className="text-[9px] leading-relaxed text-[#9a7b66]">{sourceImpact.landImpact.note}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#efd3bd] bg-[#fff8f1] px-3 py-2.5">
                <p className="max-w-3xl text-[9px] leading-relaxed text-[#8a5a3b]">{sourceImpact.disclaimer}</p>
                <button type="button" onClick={() => setSelectedSourceId(worstSource?.id ?? null)} className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#9a3412] hover:text-[#7c2d12]">
                  Inspect worst source <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {error ? <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-700">{error}</div> : null}

      <StationDrawer
        stationId={selectedStationId}
        sourceImpact={sourceImpact}
        onClose={() => setSelectedStationId(null)}
        onSourceSelect={(id) => { setSelectedStationId(null); setSelectedSourceId(id); }}
      />
      <SourceSheet
        source={selectedSource}
        wind={sourceImpact?.wind ?? null}
        attributions={sourceAttributions}
        onClose={() => setSelectedSourceId(null)}
        onStationSelect={(id) => { setSelectedSourceId(null); setSelectedStationId(id); }}
      />
      <LocationDrawer
        point={analysisPoint}
        category={category}
        onClose={() => setAnalysisPoint(null)}
        onOpenStation={(stationId) => {
          setAnalysisPoint(null);
          setSelectedSourceId(null);
          setSelectedStationId(stationId);
        }}
      />
    </div>
  );
}
