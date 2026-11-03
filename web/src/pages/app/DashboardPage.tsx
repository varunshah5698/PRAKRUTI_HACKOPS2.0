import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  BrainCircuit,
  CloudSun,
  Database,
  Droplets,
  Factory,
  Flame,
  Gauge,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Siren,
  Wind,
} from 'lucide-react';
import { Chart, chartAxis, chartGrid, chartTooltip } from '../../components/Chart';
import { MumbaiMap, type MapStation } from '../../components/MumbaiMap';
import { RiskBadge, SourceBadge } from '../../components/Status';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, EmptyState, LoadingBlock, ProgressBar } from '../../components/ui';
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

function KpiCard({
  label,
  value,
  trend,
  window,
  timestamp,
  href,
  note,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: number;
  trend: number | null;
  window: string;
  timestamp: string | null;
  href: string;
  note: string;
  icon: typeof Gauge;
  accent?: boolean;
}) {
  return (
    <Link to={href} className={`group rounded-2xl border p-4 transition ${accent ? 'border-[#b5e36b]/25 bg-[#b5e36b]/[0.055]' : 'border-[#303945] bg-[#181d23]'} hover:border-[#b5e36b]/40`}>
      <div className="flex items-start justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent ? 'bg-[#b5e36b]/15 text-[#c8ef8d]' : 'bg-[#29323d] text-[#a2adba]'}`}>
          <Icon className="h-4 w-4" />
        </div>
        {trend !== null ? (
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${trend > 0 ? 'text-amber-300' : trend < 0 ? 'text-emerald-300' : 'text-[#788493]'}`}>
            {trend > 0 ? <ArrowUpRight className="h-3 w-3" /> : trend < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        ) : (
          <span className="text-[9px] uppercase tracking-[0.08em] text-[#5f6b78]">No baseline</span>
        )}
      </div>
      <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#788493]">{label}</p>
      <p className="display mt-1 text-[30px] font-bold leading-none tracking-[-0.04em] text-[#f3f5f7]">{number(value, 0)}</p>
      <p className="mt-2 text-[10px] text-[#6f7c89]">{window}</p>
      <div className="mt-3 flex items-center justify-between border-t border-[#2b333e] pt-2 text-[9px] text-[#5f6b78]">
        <span>{timestamp ? formatDate(timestamp) : 'No timestamp'}</span>
        <ArrowRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
      </div>
      <p className="mt-2 line-clamp-2 text-[9px] leading-relaxed text-[#5f6b78]">{note}</p>
    </Link>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('air');
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  const load = (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    api
      .get<DashboardData>('/dashboard/summary')
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load dashboard'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
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
        color: AQI_COLORS[s.aqiCategory] ?? '#788493',
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

  if (loading) return <LoadingBlock className="min-h-[70vh]" label="Loading environmental command centre" />;
  if (error || !data) {
    return (
      <EmptyState
        title="Dashboard unavailable"
        description={error ?? 'The dashboard could not be loaded.'}
        icon={<AlertTriangle className="h-6 w-6" />}
        action={<Button variant="lime" onClick={() => load()}><RefreshCw className="h-4 w-4" /> Retry</Button>}
      />
    );
  }

  const selected = data.categories.find((c) => c.category === selectedCategory) ?? data.categories[0];
  const airAlerts = data.alerts.filter((a) => a.category === 'air');
  const maxAqi = data.mapStations.length ? Math.max(...data.mapStations.map((s) => s.aqi ?? 0)) : null;
  const dominant = maxAqi !== null ? data.mapStations.find((s) => s.aqi === maxAqi) : undefined;
  const pm25Series = data.charts.pm25Series;

  const categoryAlerts = data.alerts.filter((a) => a.category === selectedCategory);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={data.dataMode.stationObservations === 'SIMULATION' ? 'amber' : data.dataMode.stationObservations === 'MIXED' ? 'teal' : 'green'} dot>
              {data.dataMode.stationObservations === 'SIMULATION' ? 'Simulation data' : data.dataMode.stationObservations === 'MIXED' ? 'Mixed station sources' : 'Connected station source'}
            </Badge>
            <Badge tone="neutral">Weather live</Badge>
            <Badge tone="amber">{data.integrations?.ml === 'TRAINED' ? 'ML active' : 'ML not trained'}</Badge>
          </div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em] text-[#f3f5f7]">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {user?.name?.split(' ')[1] ?? 'operator'}.</h2>
          <p className="mt-1 text-xs text-[#788493]">
            Last observation {formatDate(data.latestUpdate)} · Updated {timeAgo(data.generatedAt)} · Every category uses its own evidence method.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="dark" size="sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Link to="/map"><Button variant="lime" size="sm">Open map <ArrowUpRight className="h-3.5 w-3.5" /></Button></Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active monitoring stations"
          value={data.kpis.activeStations.value}
          trend={data.kpis.activeStations.trendPct}
          window={data.kpis.activeStations.window}
          timestamp={data.kpis.activeStations.dataTimestamp}
          href={data.kpis.activeStations.href}
          note={data.kpis.activeStations.note}
          icon={Gauge}
        />
        <KpiCard
          label="Locations under watch"
          value={data.kpis.locationsUnderWatch.value}
          trend={data.kpis.locationsUnderWatch.trendPct}
          window={data.kpis.locationsUnderWatch.window}
          timestamp={data.kpis.locationsUnderWatch.dataTimestamp}
          href={data.kpis.locationsUnderWatch.href}
          note={data.kpis.locationsUnderWatch.note}
          icon={MapPin}
        />
        <KpiCard
          label="Predictive warnings"
          value={data.kpis.predictiveWarnings.value}
          trend={data.kpis.predictiveWarnings.trendPct}
          window={data.kpis.predictiveWarnings.window}
          timestamp={data.kpis.predictiveWarnings.dataTimestamp}
          href={data.kpis.predictiveWarnings.href}
          note={data.kpis.predictiveWarnings.note}
          icon={BrainCircuit}
        />
        <KpiCard
          label="Critical incidents"
          value={data.kpis.criticalIncidents.value}
          trend={data.kpis.criticalIncidents.trendPct}
          window={data.kpis.criticalIncidents.window}
          timestamp={data.kpis.criticalIncidents.dataTimestamp}
          href={data.kpis.criticalIncidents.href}
          note={data.kpis.criticalIncidents.note}
          icon={Siren}
          accent
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {data.categories.map((category) => {
          const Icon = CATEGORY_ICONS[category.category] ?? Wind;
          const isAir = category.category === 'air';
          const active = selectedCategory === category.category;
          return (
            <button
              key={category.category}
              onClick={() => setSelectedCategory(category.category)}
              className={`group relative h-full overflow-hidden rounded-2xl border p-4 text-left transition ${isAir || category.category === 'industrial' ? 'lg:col-span-2 lg:row-span-1' : ''} ${active ? 'border-[#b5e36b]/45 bg-[#b5e36b]/[0.045]' : 'border-[#303945] bg-[#181d23] hover:border-[#46515e]'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${isAir ? 'bg-[#b5e36b] text-[#111310]' : 'bg-[#29323d] text-[#c5d0db]'}`}><Icon className="h-4 w-4" /></span>
                  <div>
                    <p className="text-sm font-semibold text-[#f3f5f7]">{category.label}</p>
                    <p className="mt-0.5 text-[10px] text-[#6f7c89]">{isAir ? 'Primary predictive category' : 'Evidence-bound category'}</p>
                  </div>
                </div>
                <RiskBadge level={category.status} />
              </div>
              <div className={`mt-4 grid gap-3 ${isAir ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
                <div><DataLabel>Monitoring</DataLabel><p className="mt-1 text-lg font-semibold">{category.monitoringStations > 0 ? `${category.monitoringStations} stations` : 'No stations'}</p></div>
                <div><DataLabel>Active alerts</DataLabel><p className="mt-1 text-lg font-semibold">{category.activeAlerts}</p></div>
                <div><DataLabel>Critical</DataLabel><p className={`mt-1 text-lg font-semibold ${category.criticalAlerts > 0 ? 'text-red-300' : ''}`}>{category.criticalAlerts}</p></div>
                <div><DataLabel>Reports · 7d</DataLabel><p className="mt-1 text-lg font-semibold">{category.reports7d}</p></div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#2b333e] pt-2.5 text-[10px] text-[#6f7c89]">
                <span>{category.coverageNote ?? `${category.observations24h} observations in 24h · latest ${formatDate(category.latestUpdate)}`}</span>
                <span className="inline-flex items-center gap-1 font-semibold text-[#b5e36b]">Select <ArrowRight className="h-3 w-3" /></span>
              </div>
              {isAir ? <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full border border-[#b5e36b]/10" /> : null}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.85fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <div>
              <CardTitle>Mumbai monitoring network</CardTitle>
              <p className="mt-1 text-[10px] text-[#6f7c89]">3D buildings use OpenMapTiles render heights · demo stations · OpenFreeMap tiles</p>
            </div>
            <Link to="/map" className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#b5e36b]">Full map</Link>
          </CardHeader>
          <MumbaiMap
            stations={stations}
            onStationSelect={(id) => navigate(`/map?station=${id}`)}
            className="h-[330px] w-full"
            compact
            theme="dark"
            autoFit={false}
            initialZoom={12.35}
            initialPitch={46}
            overlayLabel={data.dataMode.stationObservations === 'SIMULATION' ? 'Demo stations' : data.dataMode.stationObservations === 'MIXED' ? 'Live + demo' : 'Live stations'}
          />
          <div className="grid grid-cols-2 gap-2 border-t border-[#2b333e] p-3 sm:grid-cols-4">
            <div className="rounded-xl bg-[#101317] p-3">
              <DataLabel>Highest indicative AQI</DataLabel>
              <p className="mt-1 text-lg font-semibold" style={{ color: AQI_COLORS[dominant?.aqiCategory ?? 'INSUFFICIENT DATA'] }}>{maxAqi ?? '—'}</p>
              <p className="text-[9px] text-[#6f7c89]">{dominant?.name.replace(' demo air monitor', '') ?? 'No station'}</p>
            </div>
            <div className="rounded-xl bg-[#101317] p-3">
              <DataLabel>Dominant pollutant</DataLabel>
              <p className="mt-1 text-lg font-semibold">{dominant?.pm25 && dominant.pm25 > 60 ? 'PM2.5' : 'PM10'}</p>
              <p className="text-[9px] text-[#6f7c89]">Indicative sub-index</p>
            </div>
            <div className="rounded-xl bg-[#101317] p-3">
              <DataLabel>Station data</DataLabel>
              <p className={`mt-1 text-lg font-semibold ${data.dataMode.stationObservations === 'SIMULATION' ? 'text-amber-300' : 'text-emerald-300'}`}>
                {data.dataMode.stationObservations === 'SIMULATION' ? 'Simulated' : data.dataMode.stationObservations === 'MIXED' ? 'Mixed' : 'Connected'}
              </p>
              <p className="text-[9px] text-[#6f7c89]">{data.dataMode.stationObservations === 'SIMULATION' ? 'Not CPCB readings' : 'Per-station source labels'}</p>
            </div>
            <div className="rounded-xl bg-[#101317] p-3">
              <DataLabel>Forecast</DataLabel>
              <p className="mt-1 text-lg font-semibold text-amber-300">Baseline</p>
              <p className="text-[9px] text-[#6f7c89]">LightGBM not trained</p>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active alerts</CardTitle>
              <Link to="/alerts" className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#b5e36b]">All</Link>
            </CardHeader>
            <div className="divide-y divide-[#252d37]">
              {data.alerts.slice(0, 5).map((alert) => (
                <Link key={alert.id} to={`/alerts/${alert.id}`} className="block px-4 py-3 transition hover:bg-[#1d242c]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <RiskBadge level={alert.level} />
                        <span className="text-[9px] uppercase tracking-[0.08em] text-[#6f7c89]">{alert.trigger_type}</span>
                      </div>
                      <p className="mt-1.5 truncate text-xs font-semibold text-[#e8edf2]">{alert.title}</p>
                      <p className="mt-0.5 truncate text-[10px] text-[#788493]">{alert.locality_name ?? 'Mumbai'} · {timeAgo(alert.triggered_at)}</p>
                    </div>
                    {alert.is_simulated ? <span className="shrink-0 text-[8px] uppercase tracking-[0.08em] text-amber-300/70">Sim</span> : null}
                  </div>
                </Link>
              ))}
              {data.alerts.length === 0 ? <EmptyState title="No active alerts" description="No alert currently meets configured criteria." /> : null}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Weather context</CardTitle>
              <Badge tone="green" dot>Live</Badge>
            </CardHeader>
            <div className="p-4">
              {data.weather ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div><DataLabel>Temperature</DataLabel><p className="mt-1 text-2xl font-semibold">{number(data.weather.temperature_c)}°C</p></div>
                    <div><DataLabel>Humidity</DataLabel><p className="mt-1 text-2xl font-semibold">{number(data.weather.relative_humidity, 0)}%</p></div>
                    <div><DataLabel>Wind</DataLabel><p className="mt-1 text-sm font-semibold">{number(data.weather.wind_speed_kmh)} km/h</p></div>
                    <div><DataLabel>Direction</DataLabel><p className="mt-1 text-sm font-semibold">{number(data.weather.wind_direction_deg, 0)}°</p></div>
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-[#6f7c89]">{data.weather.note} · {formatDate(data.weather.observed_at)}</p>
                </>
              ) : (
                <p className="text-xs text-[#788493]">Weather unavailable.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>City PM2.5 · last 48 hours</CardTitle>
              <p className="mt-1 text-[10px] text-[#6f7c89]">Hourly mean of demo stations · µg/m³ · missing periods not filled</p>
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
                yAxis: { type: 'value', name: 'µg/m³', nameTextStyle: { color: '#788493', fontSize: 10 }, ...chartAxis },
                series: [
                  {
                    name: 'PM2.5',
                    type: 'line',
                    smooth: 0.35,
                    symbol: 'none',
                    data: pm25Series.map((p) => p.value),
                    lineStyle: { color: '#b5e36b', width: 2 },
                    areaStyle: { color: 'rgba(181,227,107,0.1)' },
                    markLine: {
                      silent: true,
                      symbol: 'none',
                      lineStyle: { color: '#dc555b', type: 'dashed', width: 1, opacity: 0.6 },
                      label: { color: '#dc555b', fontSize: 9, formatter: '24h NAAQS 60' },
                      data: [{ yAxis: 60 }],
                    },
                  },
                ],
              }}
            />
          </div>
          <div className="border-t border-[#2b333e] px-4 py-2 text-[9px] leading-relaxed text-[#6f7c89]">
            {data.aqiMethod.caveat}
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>AQI distribution</CardTitle>
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
                    data: data.charts.aqiDistribution.map((b) => ({ value: b.count, itemStyle: { color: AQI_COLORS[b.bucket] ?? '#788493', borderRadius: [4, 4, 0, 0] } })),
                    barWidth: '52%',
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
            <div><CardTitle>Pollutant comparison</CardTitle><p className="mt-1 text-[10px] text-[#6f7c89]">Latest station mean vs NAAQS screening reference · units differ</p></div>
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
                  { name: 'Latest mean', type: 'bar', data: data.charts.pollutantComparison.map((p) => p.value), itemStyle: { color: '#56c1b3', borderRadius: [4, 4, 0, 0] }, barWidth: '38%' },
                  { name: 'Reference', type: 'bar', data: data.charts.pollutantComparison.map((p) => p.threshold), itemStyle: { color: '#46515e', borderRadius: [4, 4, 0, 0] }, barWidth: '38%' },
                ],
                legend: { textStyle: { color: '#788493', fontSize: 10 }, top: 0 },
              }}
            />
          </div>
          <p className="border-t border-[#2b333e] px-4 py-2 text-[9px] leading-relaxed text-[#6f7c89]">
            CO (mg/m³) is excluded from this shared µg/m³ axis; see latest readings. A bar comparison is not a compliance determination. 24h/8h averaging periods are required.
          </p>
        </Card>
        <Card>
          <CardHeader>
            <div><CardTitle>Station comparison</CardTitle><p className="mt-1 text-[10px] text-[#6f7c89]">Indicative AQI and PM2.5 by demo station</p></div>
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
                    data: data.charts.stationComparison.map((s) => ({ value: s.aqi, itemStyle: { color: s.aqi && s.aqi > 200 ? '#dc555b' : s.aqi && s.aqi > 100 ? '#d2b04c' : '#32a879', borderRadius: [0, 4, 4, 0] } })),
                    barWidth: '55%',
                  },
                ],
              }}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Recent citizen reports</CardTitle><Link to="/reports" className="text-[10px] font-semibold text-[#b5e36b]">All</Link></CardHeader>
          <div className="divide-y divide-[#252d37]">
            {data.reports.slice(0, 5).map((report) => (
              <Link key={report.id} to={`/reports/${report.id}`} className="block px-4 py-3 hover:bg-[#1d242c]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#788493]">{categoryLabel(report.category)}</span>
                  <Badge tone={report.verification_state === 'VERIFIED' ? 'green' : 'neutral'}>{report.verification_state}</Badge>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-[#e8edf2]">{report.incident_type.replace(/_/g, ' ')}</p>
                <p className="mt-0.5 text-[10px] text-[#6f7c89]">{report.locality_name ?? 'Mumbai'} · {timeAgo(report.submitted_at)}</p>
              </Link>
            ))}
            {data.reports.length === 0 ? <EmptyState title="No reports" description="No citizen reports have been submitted." /> : null}
          </div>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent incidents</CardTitle><Link to="/incidents" className="text-[10px] font-semibold text-[#b5e36b]">All</Link></CardHeader>
          <div className="divide-y divide-[#252d37]">
            {data.incidents.slice(0, 5).map((incident) => (
              <Link key={incident.id} to={`/incidents/${incident.id}`} className="block px-4 py-3 hover:bg-[#1d242c]">
                <div className="flex items-center justify-between gap-2">
                  <RiskBadge level={incident.risk_level} />
                  <span className="text-[9px] uppercase tracking-[0.08em] text-[#6f7c89]">{incident.status.replace(/_/g, ' ')}</span>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-[#e8edf2]">{incident.title}</p>
                <p className="mt-0.5 text-[10px] text-[#6f7c89]">{incident.locality_name ?? 'Mumbai'} · {timeAgo(incident.detected_at)}</p>
              </Link>
            ))}
            {data.incidents.length === 0 ? <EmptyState title="No incidents" description="No open incidents." /> : null}
          </div>
        </Card>
        <Card>
          <CardHeader><CardTitle>Source health</CardTitle><Link to="/data-sources" className="text-[10px] font-semibold text-[#b5e36b]">Registry</Link></CardHeader>
          <div className="divide-y divide-[#252d37]">
            {data.sources.filter((s) => ['cpcb-caaqms', 'open-meteo-weather', 'open-meteo-cams', 'river-ai', 'ml-service', 'demo-network'].includes(s.id)).map((source) => (
              <div key={source.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] font-medium text-[#dbe2e9]">{source.name}</p>
                  <SourceBadge status={source.status} />
                </div>
                <p className="mt-0.5 text-[9px] text-[#5f6b78]">{source.lastSuccessAt ? `Last success ${formatDate(source.lastSuccessAt)}` : source.notes?.slice(0, 80)}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Latest readings</CardTitle><Badge tone="amber">Demo</Badge></CardHeader>
          <div className="scrollbar-thin max-h-[300px] overflow-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-[#181d23] text-[9px] uppercase tracking-[0.1em] text-[#6f7c89]">
                <tr><th className="px-4 py-2">Station</th><th className="px-4 py-2">Pollutant</th><th className="px-4 py-2">Value</th><th className="px-4 py-2">Observed</th><th className="px-4 py-2">Source</th></tr>
              </thead>
              <tbody className="divide-y divide-[#252d37]">
                {data.latestReadings.slice(0, 18).map((reading, index) => (
                  <tr key={`${reading.station_name}-${reading.pollutant_code}-${index}`} className="text-[#a2adba]">
                    <td className="px-4 py-2">{reading.station_name.replace(' demo air monitor', '')}</td>
                    <td className="px-4 py-2 font-medium text-[#dbe2e9]">{reading.pollutant_code.toUpperCase()}</td>
                    <td className="px-4 py-2">{number(reading.value)} <span className="text-[#6f7c89]">{reading.unit}</span></td>
                    <td className="px-4 py-2">{formatDate(reading.observed_at)}</td>
                    <td className="px-4 py-2"><span className="text-[9px] text-amber-300/80">{reading.is_simulated ? 'SIMULATION' : reading.source_id}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader><CardTitle>Category focus · {CATEGORY_LABELS[selected.category] ?? selected.category}</CardTitle></CardHeader>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <DataLabel>Category status</DataLabel>
                <div className="mt-2"><RiskBadge level={selected.status} /></div>
              </div>
              <div className="text-right">
                <DataLabel>Active alerts</DataLabel>
                <p className="mt-1 text-2xl font-semibold">{selected.activeAlerts}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-[10px] text-[#788493]"><span>Critical</span><span>{selected.criticalAlerts}</span></div>
              <ProgressBar value={selected.activeAlerts ? (selected.criticalAlerts / selected.activeAlerts) * 100 : 0} tone="#dc555b" />
              <div className="flex items-center justify-between text-[10px] text-[#788493]"><span>Reports in 7 days</span><span>{selected.reports7d}</span></div>
              <ProgressBar value={Math.min(100, selected.reports7d * 12)} tone="#b5e36b" />
            </div>
            <div className="mt-4 space-y-2">
              {categoryAlerts.slice(0, 3).map((alert) => (
                <Link key={alert.id} to={`/alerts/${alert.id}`} className="block rounded-lg border border-[#303945] bg-[#101317] px-3 py-2 hover:border-[#b5e36b]/30">
                  <div className="flex items-center justify-between gap-2"><RiskBadge level={alert.level} /><span className="text-[8px] uppercase text-[#6f7c89]">{alert.trigger_type}</span></div>
                  <p className="mt-1 truncate text-[10px] text-[#dbe2e9]">{alert.title}</p>
                </Link>
              ))}
              {categoryAlerts.length === 0 ? <p className="rounded-lg border border-[#303945] bg-[#101317] px-3 py-4 text-center text-[10px] text-[#6f7c89]">No active alerts in this category.</p> : null}
            </div>
            <p className="mt-4 text-[9px] leading-relaxed text-[#5f6b78]">{selected.coverageNote ?? 'Category-specific evidence and thresholds are used. Air scoring is never applied to water, waste or industrial records.'}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
