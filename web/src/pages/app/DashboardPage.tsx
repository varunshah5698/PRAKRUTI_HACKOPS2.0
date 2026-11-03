import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  CloudRain,
  CloudSun,
  Database,
  Droplets,
  Factory,
  Flame,
  Gauge,
  MapPin,
  RefreshCw,
  Siren,
  Sun,
  Thermometer,
  Waves,
  Wind,
} from 'lucide-react';
import { Chart, chartAxis, chartGrid, chartTooltip } from '../../components/Chart';
import { MumbaiMap, type MapStation } from '../../components/MumbaiMap';
import { RiskBadge, SourceBadge } from '../../components/Status';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, EmptyState, LoadingBlock } from '../../components/ui';
import { api } from '../../lib/api';
import { AQI_COLORS, CATEGORY_LABELS, RISK_COLORS, categoryLabel, formatDate, number, timeAgo } from '../../lib/format';
import { useAuth } from '../../store/auth';

interface DashboardData {
  generatedAt: string;
  demoMode: boolean;
  dataMode: Record<string, string>;
  kpis: Record<string, { value: number; previous: number | null; trendPct: number | null; window: string; dataTimestamp: string | null; href: string; note: string }>;
  categories: Array<{
    category: string;
    label: string;
    status: string;
    monitoringStations: number;
    activeAlerts: number;
    criticalAlerts: number;
    reports7d: number;
    observations24h: number;
    latestUpdate: string | null;
    latestAlert: string | null;
    coverageNote: string | null;
  }>;
  mapStations: Array<{
    id: string;
    name: string;
    locality: string;
    lat: number;
    lng: number;
    aqi: number | null;
    aqiCategory: string;
    pm25: number | null;
    pm10: number | null;
    isSimulated: boolean;
    isStale: boolean;
    healthStatus: string;
    latestObservedAt: string | null;
  }>;
  alerts: Array<{ id: string; public_ref: string; category: string; level: string; state: string; trigger_type: string; title: string; summary: string; triggered_at: string; station_name: string | null; locality_name: string | null; is_simulated: boolean }>;
  reports: Array<{ id: string; public_ref: string; category: string; incident_type: string; status: string; verification_state: string; submitted_at: string; locality_name: string | null; is_simulated: boolean }>;
  incidents: Array<{ id: string; public_ref: string; category: string; title: string; status: string; risk_level: string; detected_at: string; locality_name: string | null; is_simulated: boolean }>;
  sources: Array<{ id: string; name: string; status: string; lastSuccessAt?: string; notes?: string; isSimulated?: boolean }>;
  weather: { observed_at: string; temperature_c: number; relative_humidity: number; wind_speed_kmh: number; wind_direction_deg: number; precipitation_mm: number; is_simulated: boolean; note: string } | null;
  cams: Array<{ localityName: string; pm25: number | null; pm10: number | null; observedAt: string }>;
  latestReadings: Array<{ station_name: string; pollutant_code: string; value: number; unit: string; observed_at: string; is_simulated: boolean; source_id: string }>;
  charts: {
    aqiDistribution: Array<{ bucket: string; count: number }>;
    pm25Series: Array<{ bucket: string; value: number; samples: number; is_simulated: boolean }>;
    pm10Series: Array<{ bucket: string; value: number; samples: number; is_simulated: boolean }>;
    pollutantComparison: Array<{ pollutant: string; value: number; unit: string; threshold: number | null; thresholdUnit: string | null; averaging: string | null; stations: number; note: string }>;
    stationComparison: Array<{ station: string; aqi: number | null; pm25: number | null; pm10: number | null }>;
    dailyTrend: Array<{ day: string; value: number; samples: number }>;
    incidentCategories: Array<{ category: string; count: number }>;
    alertStates: Array<{ state: string; count: number }>;
    wind: Array<{ station_name: string; wind_speed_kmh: number; wind_direction_deg: number; observed_at: string; is_simulated: boolean }>;
  };
  latestUpdate: string | null;
  aqiMethod: { method: string; caveat: string };
  integrations: Record<string, string>;
}

const CATEGORY_ICONS: Record<string, typeof Wind> = { air: Wind, water: Droplets, waste: Flame, industrial: Factory };

const SOURCE_ORDER = ['cpcb-caaqms', 'open-meteo-weather', 'open-meteo-cams', 'river-ai', 'ml-service', 'demo-network'];

function waveLabel(bucket: string): string {
  const hour = Number(bucket.slice(11, 13));
  if (!Number.isFinite(hour)) return bucket;
  return `${((hour + 11) % 12) + 1} ${hour < 12 ? 'AM' : 'PM'}`;
}

function weatherCondition(weather: DashboardData['weather']): string {
  if (!weather) return 'Weather unavailable';
  if (weather.precipitation_mm > 0.2) return 'Rain in the area';
  if (weather.temperature_c >= 32 && weather.relative_humidity < 55) return 'Hot and dry';
  if (weather.relative_humidity >= 70) return 'Humid and still';
  return 'Clear skies over the city';
}

function KpiCell({
  label,
  kpi,
  icon: Icon,
}: {
  label: string;
  kpi: { value: number; trendPct: number | null; window: string; note: string; href: string };
  icon: typeof Gauge;
}) {
  return (
    <Link to={kpi.href} title={kpi.note} className="group flex flex-col p-4 transition hover:bg-white/45">
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-[#edf5e8] text-[#4d7d40]">
          <Icon className="h-4 w-4" />
        </span>
        {kpi.trendPct !== null ? (
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${kpi.trendPct > 0 ? 'text-amber-600' : kpi.trendPct < 0 ? 'text-emerald-600' : 'text-[#66766b]'}`}>
            {kpi.trendPct > 0 ? <ArrowUpRight className="h-3 w-3" /> : kpi.trendPct < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
            {kpi.trendPct > 0 ? '+' : ''}{kpi.trendPct}%
          </span>
        ) : null}
      </div>
      <p className="display mt-3 text-[28px] font-bold leading-none tracking-[-0.04em] text-[#142016]">{number(kpi.value, 0)}</p>
      <p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#66766b]">{label}</p>
      <p className="mt-1 line-clamp-1 text-[9px] text-[#66766b]">{kpi.window}</p>
    </Link>
  );
}

function ConditionCell({
  label,
  value,
  unit,
  note,
  icon: Icon,
  className = '',
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  icon: typeof Wind;
  className?: string;
}) {
  return (
    <div className={`p-3.5 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#66766b]">{label}</p>
        <Icon className="h-4 w-4 text-[#8aa083]" />
      </div>
      <p className="display mt-2 text-[24px] font-bold leading-none tracking-[-0.03em] text-[#142016]">
        {value}
        {unit ? <span className="ml-1 text-[10px] font-medium tracking-normal text-[#66766b]">{unit}</span> : null}
      </p>
      {note ? <p className="mt-1.5 text-[9px] text-[#66766b]">{note}</p> : null}
    </div>
  );
}

function SegmentedBar({ ratio }: { ratio: number }) {
  const width = Math.max(4, Math.min(100, ratio * 100));
  const gradient =
    ratio >= 1
      ? 'linear-gradient(90deg,#b6d99f 0%,#e0c94d 40%,#e08a4c 68%,#cf5a5f 100%)'
      : ratio >= 0.7
        ? 'linear-gradient(90deg,#a8d88d 0%,#d5d457 60%,#e4b34d 100%)'
        : 'linear-gradient(90deg,#9ed184 0%,#c6dc6a 100%)';
  return (
    <div className="relative h-[7px] w-full overflow-hidden rounded-full bg-[#e9f0e5]">
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${width}%`, background: gradient }} />
      <div
        className="absolute inset-0 opacity-80"
        style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 7px, rgba(255,255,255,.8) 7px 8px)' }}
      />
    </div>
  );
}

function Skyline() {
  const buildings = [
    [2, 62, 14], [17, 42, 10], [28, 72, 16], [45, 34, 9], [55, 52, 12], [68, 80, 15],
    [84, 46, 11], [96, 66, 17], [114, 38, 9], [124, 58, 13], [138, 44, 10], [149, 76, 15],
    [165, 54, 11], [177, 36, 8], [186, 64, 14], [201, 48, 10], [212, 70, 13], [226, 40, 9],
    [236, 58, 12], [249, 78, 15], [265, 46, 10], [276, 60, 13], [290, 42, 9], [300, 68, 14],
  ];
  return (
    <div className="relative h-full min-h-[94px] overflow-hidden">
      <svg viewBox="0 0 320 96" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="skyline-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="58%" stopColor="#f4f9ef" stopOpacity="0.94" />
            <stop offset="100%" stopColor="#bed4b5" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {buildings.map(([x, h, w], index) => (
          <g key={index}>
            <rect x={x} y={96 - h} width={w} height={h} rx="1.5" fill="url(#skyline-fade)" />
            {[...Array(Math.max(1, Math.floor(h / 15)))].map((_, row) => (
              <rect key={row} x={x + 3} y={96 - h + 6 + row * 13} width={Math.max(2, w - 6)} height="2.5" rx="1" fill="#ffffff" opacity="0.64" />
            ))}
          </g>
        ))}
        <rect x="0" y="94" width="320" height="2" fill="#9fb995" opacity="0.4" />
      </svg>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${36 - ((value - min) / range) * 29}`).join(' ');
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-3 h-[86px] w-full" aria-hidden>
      <defs>
        <linearGradient id="pm-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7fbe62" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#7fbe62" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${points} 100,40`} fill="url(#pm-spark)" />
      <polyline points={points} fill="none" stroke="#4e9b3f" strokeWidth="1.7" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function AqiGauge({ value, category }: { value: number | null; category?: string }) {
  const safeValue = value ?? 0;
  const pct = Math.max(0, Math.min(1, safeValue / 300));
  const angle = Math.PI * (1 - pct);
  const markerX = 100 + 76 * Math.cos(angle);
  const markerY = 100 - 76 * Math.sin(angle);
  const color = AQI_COLORS[category ?? 'INSUFFICIENT DATA'] ?? '#728176';
  return (
    <svg viewBox="0 0 200 118" className="w-full max-w-[250px]" role="img" aria-label={`Indicative AQI ${value ?? 'not available'}`}>
      <defs>
        <linearGradient id="aqi-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#7fbe62" />
          <stop offset="38%" stopColor="#d9d15b" />
          <stop offset="68%" stopColor="#e0964b" />
          <stop offset="100%" stopColor="#cf5a5f" />
        </linearGradient>
      </defs>
      <path d="M 24 100 A 76 76 0 0 1 176 100" fill="none" stroke="#e8eee4" strokeWidth="11" strokeLinecap="round" />
      <path
        d="M 24 100 A 76 76 0 0 1 176 100"
        fill="none"
        stroke="url(#aqi-arc)"
        strokeWidth="11"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={`${pct} 1`}
      />
      <circle cx={markerX} cy={markerY} r="6.5" fill="#ffffff" stroke={color} strokeWidth="3.5" />
      <text x="100" y="82" textAnchor="middle" fontFamily="Space Grotesk Variable, Inter, sans-serif" fontSize="30" fontWeight="700" fill="#142016">
        {value ?? '—'}
      </text>
      <text x="100" y="98" textAnchor="middle" fontFamily="Inter Variable, sans-serif" fontSize="9" fontWeight="600" fill={color}>
        {(category ?? 'No data').toUpperCase()}
      </text>
      <text x="24" y="114" textAnchor="middle" fontSize="8" fill="#66766b">0</text>
      <text x="176" y="114" textAnchor="middle" fontSize="8" fill="#66766b">300+</text>
    </svg>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('air');
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const { user, isAuthority } = useAuth();
  const navigate = useNavigate();

  const load = (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    setRetrying(false);
    api
      .get<DashboardData>('/dashboard/summary', { onRetry: () => setRetrying(true) })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load dashboard'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
        setRetrying(false);
      });
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 60_000);
    const events = new EventSource('/api/v1/events', { withCredentials: true });
    const onAlert = () => load(true);
    events.addEventListener('alert', onAlert);
    return () => {
      clearInterval(interval);
      events.removeEventListener('alert', onAlert);
      events.close();
    };
  }, []);

  const stations: MapStation[] = useMemo(
    () =>
      (data?.mapStations ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        locality: s.locality,
        lat: s.lat,
        lng: s.lng,
        color: AQI_COLORS[s.aqiCategory] ?? '#728176',
        valueLabel: s.aqi !== null ? `AQI ${s.aqi} · ${s.pm25 ?? '—'} µg/m³ PM2.5` : 'No recent value',
        markerKind: 'OBSERVED',
        isSimulated: s.isSimulated,
        isStale: s.isStale,
        aqi: s.aqi,
        aqiCategory: s.aqiCategory,
        latestObservedAt: s.latestObservedAt,
        healthStatus: s.healthStatus,
      })),
    [data],
  );

  if (loading) {
    return (
      <LoadingBlock
        className="min-h-[70vh]"
        label={retrying ? 'Server restarting · retrying connection' : 'Loading environmental command centre'}
      />
    );
  }
  if (error || !data) {
    return (
      <EmptyState
        title="Dashboard unavailable"
        description={error ?? 'The dashboard could not be loaded.'}
        icon={<AlertTriangle className="h-6 w-6" />}
        action={<Button variant="default" onClick={() => load()}><RefreshCw className="h-4 w-4" /> Retry</Button>}
      />
    );
  }

  const selected = data.categories.find((c) => c.category === selectedCategory) ?? data.categories[0];
  const maxAqi = data.mapStations.length ? Math.max(...data.mapStations.map((s) => s.aqi ?? 0)) : null;
  const dominant = maxAqi !== null ? data.mapStations.find((s) => s.aqi === maxAqi) : undefined;
  const pm25Series = data.charts.pm25Series;
  const latestPm = pm25Series.at(-1)?.value ?? null;
  const previousPm = pm25Series.at(-2)?.value ?? null;
  const pmDelta = latestPm !== null && previousPm !== null ? latestPm - previousPm : null;
  const pmValues = pm25Series.map((p) => p.value);
  const pmAverage = pmValues.length ? pmValues.reduce((sum, value) => sum + value, 0) / pmValues.length : null;
  const pmPeak = pmValues.length ? Math.max(...pmValues) : null;
  const pollutantRows = ['PM25', 'PM10', 'NO2', 'O3'].flatMap((code) => {
    const found = data.charts.pollutantComparison.find((p) => p.pollutant === code);
    return found ? [found] : [];
  });
  const dailyTrend = data.charts.dailyTrend;
  const dayMax = dailyTrend.length ? Math.max(...dailyTrend.map((d) => d.value)) : 0;
  const dayAverage = dailyTrend.length ? dailyTrend.reduce((sum, d) => sum + d.value, 0) / dailyTrend.length : null;
  const daySamples = dailyTrend.reduce((sum, d) => sum + d.samples, 0);
  const staleStations = Number(data.dataMode.staleStationsExcluded ?? 0);
  const mlActive = data.dataMode.forecasts === 'LIGHTGBM_TRAINED_AVAILABLE';
  const sources = data.sources
    .filter((s) => SOURCE_ORDER.includes(s.id))
    .sort((a, b) => SOURCE_ORDER.indexOf(a.id) - SOURCE_ORDER.indexOf(b.id));
  const weather = data.weather;
  const temperature = weather ? number(weather.temperature_c) : '—';
  const WeatherIcon = weather && weather.precipitation_mm > 0.2 ? CloudRain : weather && weather.relative_humidity >= 70 ? CloudSun : Sun;

  return (
    <div className="space-y-4">
      {retrying ? (
        <div className="flex items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-50/85 px-4 py-2.5 text-[10px] font-medium text-amber-800">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Server is restarting. Retrying your request — the last loaded data remains visible.
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass-pill flex items-center gap-2 rounded-full px-3.5 py-2 text-[11px] font-semibold text-[#3f5045]">
            <MapPin className="h-3.5 w-3.5 text-[#4e9b3f]" />
            Mumbai, Maharashtra
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Badge tone={data.dataMode.stationObservations === 'SIMULATION' ? 'amber' : data.dataMode.stationObservations === 'MIXED' ? 'teal' : 'green'} dot>
              {data.dataMode.stationObservations === 'SIMULATION' ? 'Simulation data' : data.dataMode.stationObservations === 'MIXED' ? 'Mixed sources' : 'Connected source'}
            </Badge>
            <Badge tone="neutral">Weather live</Badge>
            <Badge tone="amber">{mlActive ? 'ML active' : 'ML baseline'}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Link to="/map">
            <Button variant="default" size="sm">Open map <ArrowUpRight className="h-3.5 w-3.5" /></Button>
          </Link>
        </div>
      </div>

      <div className="max-w-3xl">
        <h1 className="display text-[28px] font-bold leading-[1.05] tracking-[-0.045em] text-[#142016] sm:text-[34px]">
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {user?.name?.split(' ')[1] ?? 'operator'}.
        </h1>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#66766b]">
          Last observation {formatDate(data.latestUpdate)} · Updated {timeAgo(data.generatedAt)}. Every category uses its own evidence method.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <Card className="relative overflow-hidden border-white/80 lg:col-span-1 xl:col-span-3">
          <div className="absolute inset-0 bg-gradient-to-b from-[#f0f8ff]/80 via-[#f8fcf3]/40 to-[#e8f2df]/70" />
          <div className="relative flex h-full flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-semibold tracking-[-0.01em] text-[#142016]">Mumbai now</p>
                <p className="mt-0.5 text-[10px] text-[#66766b]">Live weather · Open-Meteo</p>
              </div>
              <span className="flex items-center gap-1 rounded-full border border-white/80 bg-white/65 px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#3f7d2a]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#5da341]" /> Live
              </span>
            </div>
            <div className="mt-5 flex items-start justify-between">
              <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-[#fff6d7] text-[#d6a51b] shadow-[0_18px_40px_-24px_rgba(178,138,26,.65)]">
                <WeatherIcon className="h-8 w-8" strokeWidth={1.5} />
              </span>
              <div className="text-right">
                <p className="display text-[52px] font-bold leading-none tracking-[-0.06em] text-[#142016]">
                  {temperature}
                  <span className="ml-0.5 align-top text-[20px] font-semibold tracking-normal text-[#3f5045]">°C</span>
                </p>
              </div>
            </div>
            <p className="mt-3 text-[12px] font-medium text-[#3f5045]">{weatherCondition(weather)}</p>
            <p className="mt-1 text-[9px] leading-relaxed text-[#66766b]">
              {weather ? `${number(weather.wind_direction_deg, 0)}° wind · ${formatDate(weather.observed_at)}` : 'No current weather observation.'}
            </p>
            <div className="mt-3 min-h-[94px] flex-1">
              <Skyline />
            </div>
            <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
              <div className="rounded-2xl border border-white/75 bg-white/55 p-2.5">
                <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#66766b]">
                  <CloudRain className="h-3.5 w-3.5 text-[#5f8fb4]" /> Rain
                </div>
                <p className="display mt-1.5 text-lg font-bold text-[#142016]">{weather ? number(weather.precipitation_mm, 1) : '—'}<span className="ml-1 text-[9px] font-medium text-[#66766b]">mm</span></p>
              </div>
              <div className="rounded-2xl border border-white/75 bg-white/55 p-2.5">
                <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#66766b]">
                  <Wind className="h-3.5 w-3.5 text-[#5f8f79]" /> Wind
                </div>
                <p className="display mt-1.5 text-lg font-bold text-[#142016]">{weather ? number(weather.wind_speed_kmh) : '—'}<span className="ml-1 text-[9px] font-medium text-[#66766b]">km/h</span></p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden lg:col-span-1 xl:col-span-5">
          <CardHeader>
            <div>
              <CardTitle>Particulate trend</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Hourly city mean PM2.5 over the last 48 hours</p>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-white/60 text-[#66766b]">
              <Waves className="h-4 w-4" />
            </span>
          </CardHeader>
          <div className="p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <DataLabel>Latest hourly mean</DataLabel>
                <p className="display mt-1 text-[32px] font-bold leading-none tracking-[-0.04em] text-[#142016]">
                  {latestPm !== null ? number(latestPm, 0) : '—'}
                  <span className="ml-1.5 text-[10px] font-medium tracking-normal text-[#66766b]">µg/m³</span>
                </p>
              </div>
              <div className="text-right">
                <p className={`inline-flex items-center gap-1 text-[10px] font-semibold ${pmDelta === null ? 'text-[#66766b]' : pmDelta > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {pmDelta !== null && pmDelta > 0 ? <ArrowUpRight className="h-3 w-3" /> : pmDelta !== null && pmDelta < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                  {pmDelta !== null ? `${pmDelta > 0 ? '+' : ''}${number(pmDelta, 1)} vs previous hour` : 'No previous hour'}
                </p>
                <p className="mt-1 text-[9px] text-[#66766b]">48h average {pmAverage !== null ? number(pmAverage, 0) : '—'} · peak {pmPeak !== null ? number(pmPeak, 0) : '—'}</p>
              </div>
            </div>

            <div className="hide-scrollbar -mx-1 mt-5 flex gap-1.5 overflow-x-auto pb-1">
              {pm25Series.slice(-18).map((point, index, shown) => {
                const active = index === shown.length - 1;
                return (
                  <div key={point.bucket} className={`flex min-w-[53px] flex-col items-center gap-2 rounded-[18px] px-1.5 py-2.5 ${active ? 'bg-[#eaf9d8]' : 'bg-transparent'}`}>
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-[10px] font-semibold ${
                        active ? 'bg-[#4e9b3f] text-white shadow-[0_12px_24px_-12px_rgba(52,110,41,.8)]' : 'border border-white/80 bg-white/70 text-[#3f5045]'
                      }`}
                    >
                      {number(point.value, 0)}
                    </span>
                    <span className={`text-[8px] font-semibold ${active ? 'text-[#3f7d2a]' : 'text-[#66766b]'}`}>{waveLabel(point.bucket)}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 border-t border-dashed border-[#dbe5d6] pt-2">
              <div className="flex items-center justify-between">
                <DataLabel>48 hour shape</DataLabel>
                <span className="text-[8px] uppercase tracking-[0.1em] text-[#66766b]">Hourly mean</span>
              </div>
              <Sparkline values={pm25Series.slice(-24).map((point) => point.value)} />
            </div>

            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[#dbe5d6] pt-3">
              <span className="text-[9px] text-[#66766b]">24h NAAQS screening reference 60 µg/m³ · missing periods not filled</span>
              {isAuthority() ? (
                <Link to="/intelligence/predictions" className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a] hover:text-[#2f5f20]">
                  Open predictions <ArrowRight className="h-3 w-3" />
                </Link>
              ) : null}
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2 xl:col-span-4">
          <CardHeader>
            <div>
              <CardTitle>Current conditions</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Weather and pollutant snapshot</p>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-white/60 text-[#66766b]">
              <ActivityIcon />
            </span>
          </CardHeader>
          <div className="p-4">
            <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-dashed border-[#d4e0cf] bg-white/30">
              <ConditionCell label="Rainfall" value={weather ? number(weather.precipitation_mm, 1) : '—'} unit="mm" icon={CloudRain} className="border-b border-r border-dashed border-[#d4e0cf]" />
              <ConditionCell label="Temperature" value={temperature} unit="°C" icon={Thermometer} className="border-b border-dashed border-[#d4e0cf]" />
              <ConditionCell label="Humidity" value={weather ? number(weather.relative_humidity, 0) : '—'} unit="%" icon={Waves} className="border-r border-dashed border-[#d4e0cf]" />
              <ConditionCell label="Wind" value={weather ? number(weather.wind_speed_kmh) : '—'} unit="km/h" icon={Wind} />
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <DataLabel>Pollutant snapshot</DataLabel>
                <span className="text-[8px] uppercase tracking-[0.1em] text-[#66766b]">Latest city mean</span>
              </div>
              {pollutantRows.map((pollutant) => {
                const ratio = pollutant.threshold ? pollutant.value / pollutant.threshold : 0.35;
                return (
                  <div key={pollutant.pollutant}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-[#34463a]">{pollutant.pollutant.replace('PM25', 'PM2.5')}</span>
                      <span className="text-[10px] text-[#5d6e63]">
                        {number(pollutant.value)} <span className="text-[8px] text-[#66766b]">{pollutant.unit}</span>
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <SegmentedBar ratio={ratio} />
                    </div>
                  </div>
                );
              })}
              {pollutantRows.length === 0 ? <p className="text-[10px] text-[#66766b]">No comparable pollutant values available.</p> : null}
            </div>
          </div>
        </Card>
      </div>

      <Card className={`grid grid-cols-2 divide-x divide-dashed divide-[#dbe5d6] overflow-hidden ${isAuthority() ? 'sm:grid-cols-4' : 'sm:grid-cols-2'}`}>
        <KpiCell label="Monitoring stations" kpi={data.kpis.activeStations} icon={Gauge} />
        <KpiCell label="Locations under watch" kpi={data.kpis.locationsUnderWatch} icon={MapPin} />
        {isAuthority() ? <KpiCell label="Predictive warnings" kpi={data.kpis.predictiveWarnings} icon={BrainCircuit} /> : null}
        {isAuthority() ? <KpiCell label="Critical incidents" kpi={data.kpis.criticalIncidents} icon={Siren} /> : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        <Card className="flex flex-col md:col-span-1 xl:col-span-5">
          <CardHeader>
            <div>
              <CardTitle>Daily outlook</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Daily mean PM2.5 · available days</p>
            </div>
            <Badge tone="neutral">Demo series</Badge>
          </CardHeader>
          <div className="flex flex-1 flex-col p-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <DataLabel>Week average</DataLabel>
                <p className="display mt-1 text-[28px] font-bold leading-none tracking-[-0.04em] text-[#142016]">
                  {dayAverage !== null ? number(dayAverage, 0) : '—'}
                  <span className="ml-1.5 text-[10px] font-medium tracking-normal text-[#66766b]">µg/m³</span>
                </p>
              </div>
              <p className="text-[9px] text-[#66766b]">Peak {dayMax ? number(dayMax, 0) : '—'} · NAAQS 60</p>
            </div>
            <div className="mt-5 space-y-3.5">
              {dailyTrend.map((day) => {
                const width = dayMax ? Math.max(6, (day.value / dayMax) * 100) : 6;
                return (
                  <div key={day.day} className="flex items-center gap-3">
                    <span className="w-11 shrink-0 text-[10px] font-medium text-[#5d6e63]">{day.day}</span>
                    <div className="relative h-[7px] flex-1 overflow-hidden rounded-full bg-[#eaf0e6]">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${width}%`, background: 'linear-gradient(90deg,#a8d98c 0%,#d4d45a 62%,#e2a74d 100%)' }}
                      />
                      <div className="absolute inset-0" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 9px, rgba(255,255,255,.75) 9px 10px)' }} />
                    </div>
                    <span className="w-8 shrink-0 text-right text-[10px] font-semibold text-[#34463a]">{number(day.value, 0)}</span>
                  </div>
                );
              })}
              {dailyTrend.length === 0 ? <p className="text-[10px] text-[#66766b]">No daily series available.</p> : null}
            </div>
            <p className="mt-4 border-t border-dashed border-[#dbe5d6] pt-3 text-[9px] leading-relaxed text-[#66766b]">Indicative city mean, not a forecast.</p>
            <div className="mt-auto grid grid-cols-3 gap-2 pt-4">
              <div><DataLabel>Days</DataLabel><p className="mt-1 text-[13px] font-semibold text-[#34463a]">{dailyTrend.length}</p></div>
              <div><DataLabel>Samples</DataLabel><p className="mt-1 text-[13px] font-semibold text-[#34463a]">{daySamples}</p></div>
              <div><DataLabel>Peak</DataLabel><p className="mt-1 text-[13px] font-semibold text-[#34463a]">{number(dayMax, 0)}</p></div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col md:col-span-1 xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>City air quality</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Highest indicative AQI</p>
            </div>
          </CardHeader>
          <div className="flex flex-1 flex-col items-center px-4 pb-5 pt-4">
            <AqiGauge value={maxAqi} category={dominant?.aqiCategory} />
            <div className="mt-1 w-full rounded-2xl border border-white/80 bg-white/55 px-3 py-2.5 text-center">
              <p className="text-[10px] font-semibold text-[#34463a]">{dominant?.name.replace(' demo air monitor', '') ?? 'No station reporting'}</p>
              <p className="mt-0.5 text-[9px] text-[#66766b]">{dominant?.pm25 ? `PM2.5 ${number(dominant.pm25)} µg/m³ · ${timeAgo(dominant.latestObservedAt)}` : 'No current station value'}</p>
            </div>
            <Link to="/map" className="mt-3 inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a] hover:text-[#2f5f20]">
              View stations <ArrowUpRight className="h-3 w-3" />
            </Link>
            <div className="mt-auto grid w-full grid-cols-3 gap-2 border-t border-dashed border-[#dbe5d6] pt-3">
              <div><DataLabel>Stations</DataLabel><p className="mt-1 text-[13px] font-semibold text-[#34463a]">{data.kpis.activeStations.value}</p></div>
              <div><DataLabel>Dominant</DataLabel><p className="mt-1 text-[13px] font-semibold text-[#34463a]">{dominant?.pm25 && dominant.pm25 > 60 ? 'PM2.5' : 'PM10'}</p></div>
              <div><DataLabel>Stale</DataLabel><p className="mt-1 text-[13px] font-semibold text-[#34463a]">{staleStations}</p></div>
            </div>
          </div>
        </Card>

        <Card className="md:col-span-2 xl:col-span-4">
          <CardHeader>
            <div>
              <CardTitle>Active alerts</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">{data.alerts.length} open · highest first</p>
            </div>
            <Link to="/alerts" className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a] hover:text-[#2f5f20]">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <div className="divide-y divide-dashed divide-[#e7ece3]">
            {data.alerts.slice(0, 4).map((alert) => (
              <Link key={alert.id} to={`/alerts/${alert.id}`} className="group flex items-start gap-2.5 px-4 py-3 transition hover:bg-white/45">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: RISK_COLORS[alert.level.toUpperCase()] ?? '#728176' }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <RiskBadge level={alert.level} />
                    <span className="text-[8px] uppercase tracking-[0.08em] text-[#66766b]">{alert.trigger_type.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-1.5 truncate text-[11px] font-semibold text-[#223328]">{alert.title}</p>
                  <p className="mt-0.5 truncate text-[9px] text-[#66766b]">{alert.locality_name ?? 'Mumbai'} · {timeAgo(alert.triggered_at)}</p>
                </div>
                {alert.is_simulated ? <span className="mt-0.5 text-[8px] uppercase tracking-[0.08em] text-amber-600">Sim</span> : null}
              </Link>
            ))}
            {data.alerts.length === 0 ? <EmptyState title="No active alerts" description="No alert currently meets configured criteria." /> : null}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>Category watch</CardTitle>
            <p className="mt-1 text-[10px] text-[#66766b]">Evidence-bound categories · select one to inspect</p>
          </div>
          <Link to="/alerts" className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a] hover:text-[#2f5f20]">
            All alerts <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.categories.map((category) => {
            const Icon = CATEGORY_ICONS[category.category] ?? Wind;
            const active = selectedCategory === category.category;
            return (
              <button
                key={category.category}
                onClick={() => setSelectedCategory(category.category)}
                className={`rounded-[20px] border p-3.5 text-left transition ${
                  active ? 'border-[#b3df7c] bg-[#effbe2] shadow-[0_12px_30px_-24px_rgba(52,110,41,.6)]' : 'border-white/80 bg-white/45 hover:border-[#d5e2cf] hover:bg-white/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full ${active ? 'bg-[#4e9b3f] text-white' : 'bg-[#edf4e9] text-[#4d7d40]'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <RiskBadge level={category.status} />
                </div>
                <p className="mt-3 text-[12px] font-semibold text-[#223328]">{category.label}</p>
                <div className="mt-2 flex items-center justify-between text-[9px] text-[#66766b]">
                  <span>Stations</span><span className="font-semibold text-[#34463a]">{category.monitoringStations}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[9px] text-[#66766b]">
                  <span>Alerts · critical</span><span className="font-semibold text-[#34463a]">{category.activeAlerts} · {category.criticalAlerts}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[9px] text-[#66766b]">
                  <span>Reports · 7d</span><span className="font-semibold text-[#34463a]">{category.reports7d}</span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[#dbe5d6] px-4 py-3">
          <p className="text-[9px] leading-relaxed text-[#66766b]">
            {selected?.coverageNote ?? 'Category-specific evidence and thresholds are used. Air scoring is never applied to water, waste or industrial records.'}
          </p>
          <Link to="/alerts" className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a] hover:text-[#2f5f20]">
            {CATEGORY_LABELS[selected?.category ?? 'air'] ?? 'Category'} alerts <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="overflow-hidden xl:col-span-7">
          <CardHeader>
            <div>
              <CardTitle>Mumbai monitoring network</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">3D buildings use OpenMapTiles render heights · demo stations</p>
            </div>
            <Link to="/map" className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a] hover:text-[#2f5f20]">
              Full map <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <MumbaiMap
            stations={stations}
            onStationSelect={(id) => navigate(`/map?station=${id}`)}
            className="h-[320px] w-full"
            compact
            theme="light"
            autoFit={false}
            initialZoom={12.35}
            initialPitch={46}
          />
          <div className="grid grid-cols-2 gap-2 border-t border-dashed border-[#dbe5d6] p-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/80 bg-white/45 p-3">
              <DataLabel>Highest AQI</DataLabel>
              <p className="mt-1 text-lg font-semibold" style={{ color: AQI_COLORS[dominant?.aqiCategory ?? 'INSUFFICIENT DATA'] }}>{maxAqi ?? '—'}</p>
              <p className="text-[9px] text-[#66766b]">{dominant?.name.replace(' demo air monitor', '') ?? 'No station'}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/45 p-3">
              <DataLabel>Dominant pollutant</DataLabel>
              <p className="mt-1 text-lg font-semibold text-[#223328]">{dominant?.pm25 && dominant.pm25 > 60 ? 'PM2.5' : 'PM10'}</p>
              <p className="text-[9px] text-[#66766b]">Indicative sub-index</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/45 p-3">
              <DataLabel>Station data</DataLabel>
              <p className={`mt-1 text-lg font-semibold ${data.dataMode.stationObservations === 'SIMULATION' ? 'text-amber-600' : 'text-emerald-600'}`}>
                {data.dataMode.stationObservations === 'SIMULATION' ? 'Simulated' : data.dataMode.stationObservations === 'MIXED' ? 'Mixed' : 'Connected'}
              </p>
              <p className="text-[9px] text-[#66766b]">{data.dataMode.stationObservations === 'SIMULATION' ? 'Not CPCB readings' : 'Per-station labels'}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/45 p-3">
              <DataLabel>Forecast</DataLabel>
              <p className="mt-1 text-lg font-semibold text-amber-600">{mlActive ? 'Trained' : 'Baseline'}</p>
              <p className="text-[9px] text-[#66766b]">{mlActive ? 'OpenAQ stations with history' : 'Persistence fallback'}</p>
            </div>
          </div>
        </Card>

        <Card className="xl:col-span-5">
          <CardHeader>
            <div>
              <CardTitle>Source health</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Connected services and evidence registry</p>
            </div>
            <Link to="/data-sources" className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a] hover:text-[#2f5f20]">
              Registry <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <div className="divide-y divide-dashed divide-[#e7ece3]">
            {sources.map((source) => (
              <div key={source.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium text-[#223328]">{source.name}</p>
                  <p className="mt-0.5 truncate text-[9px] text-[#66766b]">{source.lastSuccessAt ? `Last success ${formatDate(source.lastSuccessAt)}` : source.notes?.slice(0, 80) ?? 'Status not reported'}</p>
                </div>
                <SourceBadge status={source.status} />
              </div>
            ))}
            {sources.length === 0 ? <p className="px-4 py-6 text-center text-[10px] text-[#66766b]">No registered sources.</p> : null}
          </div>
          <div className="border-t border-dashed border-[#dbe5d6] px-4 py-3">
            <p className="flex items-center gap-1.5 text-[9px] leading-relaxed text-[#66766b]">
              <Database className="h-3 w-3 shrink-0" /> Demo station readings stay labelled. Weather and CAMS remain contextual, not station evidence.
            </p>
          </div>
        </Card>
      </div>

      {isAuthority() ? (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent citizen reports</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Evidence submitted by the public</p>
            </div>
            <Link to="/reports" className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a] hover:text-[#2f5f20]">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <div className="divide-y divide-dashed divide-[#e7ece3]">
            {data.reports.slice(0, 5).map((report) => (
              <Link key={report.id} to={`/reports/${report.id}`} className="block px-4 py-3 transition hover:bg-white/45">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#66766b]">{categoryLabel(report.category)}</span>
                  <Badge tone={report.verification_state === 'VERIFIED' ? 'green' : 'neutral'}>{report.verification_state}</Badge>
                </div>
                <p className="mt-1 truncate text-[11px] font-medium text-[#223328]">{report.incident_type.replace(/_/g, ' ')}</p>
                <p className="mt-0.5 text-[9px] text-[#66766b]">{report.locality_name ?? 'Mumbai'} · {timeAgo(report.submitted_at)}</p>
              </Link>
            ))}
            {data.reports.length === 0 ? <EmptyState title="No reports" description="No citizen reports have been submitted." /> : null}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent incidents</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Open and recently updated cases</p>
            </div>
            <Link to="/incidents" className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a] hover:text-[#2f5f20]">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <div className="divide-y divide-dashed divide-[#e7ece3]">
            {data.incidents.slice(0, 5).map((incident) => (
              <Link key={incident.id} to={`/incidents/${incident.id}`} className="block px-4 py-3 transition hover:bg-white/45">
                <div className="flex items-center justify-between gap-2">
                  <RiskBadge level={incident.risk_level} />
                  <span className="text-[8px] uppercase tracking-[0.08em] text-[#66766b]">{incident.status.replace(/_/g, ' ')}</span>
                </div>
                <p className="mt-1 truncate text-[11px] font-medium text-[#223328]">{incident.title}</p>
                <p className="mt-0.5 text-[9px] text-[#66766b]">{incident.locality_name ?? 'Mumbai'} · {timeAgo(incident.detected_at)}</p>
              </Link>
            ))}
            {data.incidents.length === 0 ? <EmptyState title="No incidents" description="No open incidents." /> : null}
          </div>
        </Card>
      </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHeader>
            <div>
              <CardTitle>City PM2.5 · last 48 hours</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Hourly mean of demo stations · µg/m³ · missing periods not filled</p>
            </div>
            <Badge tone="amber">Simulation</Badge>
          </CardHeader>
          <div className="px-2 pb-2 pt-3">
            <Chart
              height={280}
              empty={pm25Series.length === 0}
              option={{
                grid: { ...chartGrid, top: 30 },
                tooltip: chartTooltip,
                xAxis: { type: 'category', data: pm25Series.map((p) => p.bucket.slice(5)), ...chartAxis, axisLabel: { ...chartAxis.axisLabel, interval: 5 } },
                yAxis: { type: 'value', name: 'µg/m³', nameTextStyle: { color: '#5f7065', fontSize: 10 }, ...chartAxis },
                series: [
                  {
                    name: 'PM2.5',
                    type: 'line',
                    smooth: 0.35,
                    symbol: 'none',
                    data: pm25Series.map((p) => p.value),
                    lineStyle: { color: '#4e9b3f', width: 2 },
                    areaStyle: {
                      color: {
                        type: 'linear',
                        x: 0,
                        y: 0,
                        x2: 0,
                        y2: 1,
                        colorStops: [
                          { offset: 0, color: 'rgba(78,155,63,0.22)' },
                          { offset: 1, color: 'rgba(78,155,63,0.01)' },
                        ],
                      },
                    },
                    markLine: {
                      silent: true,
                      symbol: 'none',
                      lineStyle: { color: '#c94a50', type: 'dashed', width: 1, opacity: 0.6 },
                      label: { color: '#c94a50', fontSize: 9, formatter: 'NAAQS 60', position: 'insideStartTop' },
                      data: [{ yAxis: 60 }],
                    },
                  },
                ],
              }}
            />
          </div>
          <div className="border-t border-dashed border-[#dbe5d6] px-4 py-2 text-[9px] leading-relaxed text-[#66766b]">
            {data.aqiMethod.caveat}
          </div>
        </Card>

        <Card className="xl:col-span-5">
          <CardHeader>
            <div>
              <CardTitle>AQI distribution</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Stations by indicative category</p>
            </div>
            <Badge tone="neutral">Indicative</Badge>
          </CardHeader>
          <div className="px-2 pb-3 pt-3">
            <Chart
              height={280}
              empty={data.charts.aqiDistribution.every((b) => b.count === 0)}
              option={{
                grid: { ...chartGrid, left: 10 },
                tooltip: chartTooltip,
                xAxis: { type: 'category', data: data.charts.aqiDistribution.map((b) => b.bucket), ...chartAxis, axisLabel: { ...chartAxis.axisLabel, interval: 0, rotate: 20, fontSize: 9 } },
                yAxis: { type: 'value', ...chartAxis, minInterval: 1 },
                series: [
                  {
                    type: 'bar',
                    data: data.charts.aqiDistribution.map((b) => ({ value: b.count, itemStyle: { color: AQI_COLORS[b.bucket] ?? '#728176', borderRadius: [8, 8, 8, 8] } })),
                    barWidth: '46%',
                  },
                ],
              }}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Pollutant comparison</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Latest station mean vs NAAQS screening reference · units differ</p>
            </div>
          </CardHeader>
          <div className="px-2 pb-3">
            <Chart
              height={250}
              empty={data.charts.pollutantComparison.length === 0}
              option={{
                grid: { ...chartGrid, left: 10 },
                tooltip: chartTooltip,
                xAxis: { type: 'category', data: data.charts.pollutantComparison.map((p) => p.pollutant), ...chartAxis },
                yAxis: { type: 'value', ...chartAxis },
                series: [
                  { name: 'Latest mean', type: 'bar', data: data.charts.pollutantComparison.map((p) => p.value), itemStyle: { color: '#2f8f84', borderRadius: [8, 8, 0, 0] }, barWidth: '34%' },
                  { name: 'Reference', type: 'bar', data: data.charts.pollutantComparison.map((p) => p.threshold), itemStyle: { color: '#cdd9c9', borderRadius: [8, 8, 0, 0] }, barWidth: '34%' },
                ],
                legend: { textStyle: { color: '#5f7065', fontSize: 10 }, top: 0 },
              }}
            />
          </div>
          <p className="border-t border-dashed border-[#dbe5d6] px-4 py-2 text-[9px] leading-relaxed text-[#66766b]">
            CO (mg/m³) is excluded from this shared µg/m³ axis; see latest readings. A bar comparison is not a compliance determination. Averaging periods matter.
          </p>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Station comparison</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Indicative AQI and PM2.5 by demo station</p>
            </div>
          </CardHeader>
          <div className="px-2 pb-3">
            <Chart
              height={280}
              empty={data.charts.stationComparison.length === 0}
              option={{
                grid: { ...chartGrid, left: 10, right: 34 },
                tooltip: chartTooltip,
                xAxis: { type: 'value', ...chartAxis },
                yAxis: { type: 'category', data: data.charts.stationComparison.map((s) => s.station), ...chartAxis, axisLabel: { ...chartAxis.axisLabel, fontSize: 9 } },
                series: [
                  {
                    name: 'AQI',
                    type: 'bar',
                    data: data.charts.stationComparison.map((s) => ({
                      value: s.aqi,
                      itemStyle: {
                        color: s.aqi && s.aqi > 200 ? '#c94a50' : s.aqi && s.aqi > 100 ? '#b3860f' : '#2f8f66',
                        borderRadius: [0, 8, 8, 0],
                      },
                    })),
                    barWidth: '50%',
                  },
                ],
              }}
            />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Latest readings</CardTitle>
            <p className="mt-1 text-[10px] text-[#66766b]">Newest station values across pollutants</p>
          </div>
          <Badge tone="amber">Demo</Badge>
        </CardHeader>
        <div className="scrollbar-thin max-h-[320px] overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-[#f7faf4]/95 text-[9px] uppercase tracking-[0.1em] text-[#66766b] backdrop-blur">
              <tr><th className="px-4 py-2.5">Station</th><th className="px-4 py-2.5">Pollutant</th><th className="px-4 py-2.5">Value</th><th className="px-4 py-2.5">Observed</th><th className="px-4 py-2.5">Source</th></tr>
            </thead>
            <tbody className="divide-y divide-dashed divide-[#e7ece3]">
              {data.latestReadings.slice(0, 18).map((reading, index) => (
                <tr key={`${reading.station_name}-${reading.pollutant_code}-${index}`} className="text-[#5a6a5f] transition hover:bg-white/45">
                  <td className="px-4 py-2.5">{reading.station_name.replace(' demo air monitor', '')}</td>
                  <td className="px-4 py-2.5 font-medium text-[#223328]">{reading.pollutant_code.toUpperCase()}</td>
                  <td className="px-4 py-2.5">{number(reading.value)} <span className="text-[#66766b]">{reading.unit}</span></td>
                  <td className="px-4 py-2.5">{formatDate(reading.observed_at)}</td>
                  <td className="px-4 py-2.5"><span className={`text-[9px] ${reading.is_simulated ? 'text-amber-600' : 'text-emerald-600'}`}>{reading.is_simulated ? 'SIMULATION' : reading.source_id}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  );
}
