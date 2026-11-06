import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw } from 'lucide-react';
import { PublicPage, Prose, Callout } from './PublicPage';
import { FreshnessPill } from '../../components/FreshnessPill';
import { PublicBadge, Button, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, timeAgo } from '../../lib/format';

interface StatusPayload {
  generatedAt: string;
  demoMode: boolean;
  overall: 'OK' | 'DEGRADED' | 'OUTAGE';
  weather: {
    status: 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'DEMO';
    provider: string | null;
    dataSourceType: string | null;
    sourceId: string;
    observedAt: string | null;
    fetchedAt: string | null;
    ageSeconds: number | null;
    temperatureC: number | null;
    isLive: boolean;
  } | null;
  air: {
    status: 'LIVE' | 'STALE' | 'UNAVAILABLE';
    sourceId: string | null;
    observedAt: string | null;
    ageSeconds: number | null;
  };
  feeds: Array<{
    id: string;
    name: string;
    provider: string;
    status: string;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    errorMessage: string | null;
    notes: string | null;
  }>;
  watchdog?: {
    checkedAt: string;
    status: 'OK' | 'STALE' | 'UNAVAILABLE';
    message: string;
    observedAt: string | null;
    provider: string | null;
  } | null;
  live: {
    enabled: boolean;
    weatherIntervalSeconds: number;
    aqiIntervalSeconds: number;
    airQualityIntervalSeconds: number;
    simulationIntervalSeconds: number;
    lastCycleAt: string | null;
    lastCycleErrors: string[];
  };
}

function stateTone(status: string): 'lime' | 'soft' | 'outline' {
  if (status === 'OK' || status === 'LIVE' || status === 'CONNECTED') return 'lime';
  if (status === 'DEGRADED' || status === 'STALE' || status === 'FAILED') return 'soft';
  return 'outline';
}

function ageLabel(seconds: number | null): string {
  if (seconds === null) return 'no timestamp';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

export function StatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      setLoading(true);
      api.get<StatusPayload>('/public/status')
        .then((payload) => {
          if (!active) return;
          setData(payload);
          setError(null);
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : 'Status unavailable');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    load();
    const reloadIfVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = window.setInterval(reloadIfVisible, 60_000);
    document.addEventListener('visibilitychange', reloadIfVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', reloadIfVisible);
    };
  }, []);

  return (
    <PublicPage kicker="Live data status" title="What is live, what is stale, what is unavailable.">
      <Prose>
        <p>
          This page is the public health check for the environmental feeds behind प्रकृति. It reports the stored
          observation time, not the time this page was loaded. A provider can be reachable while its latest observation
          is still older than the display window.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {data ? (
            <PublicBadge tone={stateTone(data.overall)}>
              {data.overall === 'OK' ? 'All critical feeds live' : data.overall === 'DEGRADED' ? 'Degraded — fallback or stale feed' : 'Outage — no live environmental reading'}
            </PublicBadge>
          ) : null}
          <span className="text-[11px] text-ink/40">
            {data ? `Checked ${timeAgo(data.generatedAt)} · refreshes every minute` : 'Waiting for status…'}
          </span>
        </div>
      </Prose>

      {loading && !data ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-ink/50"><Spinner /> Loading live status…</div>
      ) : error && !data ? (
        <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          {error}
          <Button variant="outline" size="sm" className="ml-3" onClick={() => window.location.reload()}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : data ? (
        <>
          {error ? (
            <div className="mt-6 flex items-center gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}. Showing the last loaded status.
            </div>
          ) : null}

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/40">Weather</span>
                <Activity className="h-4 w-4 text-[#4e9b3f]" />
              </div>
              {data.weather ? (
                <>
                  <div className="mt-3"><FreshnessPill status={data.weather.status} observedAt={data.weather.observedAt} provider={data.weather.provider} sourceId={data.weather.sourceId} /></div>
                  <p className="mt-3 text-[12px] leading-relaxed text-ink/55">
                    {data.weather.provider ?? data.weather.sourceId} · {data.weather.dataSourceType === 'HOURLY_FORECAST' ? 'hourly forecast' : 'current conditions'}
                    {data.weather.temperatureC !== null ? ` · ${Math.round(data.weather.temperatureC)}°C` : ''}
                  </p>
                  <p className="mt-1 text-[11px] text-ink/40">Observed {data.weather.observedAt ? formatDate(data.weather.observedAt) : '—'}</p>
                </>
              ) : (
                <p className="mt-3 text-[12px] text-[#8a2f2a]">No weather observation is stored.</p>
              )}
            </div>

            <div className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/40">Air quality</span>
                <Database className="h-4 w-4 text-[#2f8f84]" />
              </div>
              <div className="mt-3">
                <PublicBadge tone={stateTone(data.air.status)}>{data.air.status}</PublicBadge>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink/55">
                {data.air.sourceId ?? 'No source'} · latest reading {ageLabel(data.air.ageSeconds)}
              </p>
              <p className="mt-1 text-[11px] text-ink/40">{data.air.observedAt ? formatDate(data.air.observedAt) : 'No timestamp'}</p>
            </div>

            <div className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/40">Watchdog</span>
                <Clock3 className="h-4 w-4 text-[#b3860f]" />
              </div>
              <div className="mt-3">
                <PublicBadge tone={stateTone(data.watchdog?.status ?? 'STALE')}>
                  {data.watchdog?.status ?? 'CHECKING'}
                </PublicBadge>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink/55">
                {data.watchdog?.message ?? 'The server watchdog has not reported yet.'}
              </p>
              <p className="mt-1 text-[11px] text-ink/40">
                {data.watchdog ? `Checked ${timeAgo(data.watchdog.checkedAt)}` : 'Checks every five minutes'}
              </p>
            </div>
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-ink/12 bg-white">
            <div className="hidden grid-cols-[1.4fr_0.7fr_1fr_1.5fr] gap-4 border-b border-ink/10 bg-[#f3f4ed] px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/45 md:grid">
              <span>Feed</span><span>Status</span><span>Last success</span><span>Detail</span>
            </div>
            {data.feeds.map((feed) => (
              <div key={feed.id} className="grid gap-3 border-b border-ink/8 px-5 py-4 last:border-0 md:grid-cols-[1.4fr_0.7fr_1fr_1.5fr] md:gap-4">
                <div>
                  <p className="text-sm font-semibold text-ink">{feed.name}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-ink/40">{feed.provider}</p>
                </div>
                <div><PublicBadge tone={stateTone(feed.status)}>{feed.status.replace(/_/g, ' ')}</PublicBadge></div>
                <p className="text-[11px] text-ink/50">{feed.lastSuccessAt ? formatDate(feed.lastSuccessAt) : '—'}</p>
                <div className="text-[11px] leading-relaxed text-ink/55">
                  {feed.errorMessage ? <p className="text-red-700">{feed.errorMessage}</p> : <p>{feed.notes ?? 'No recent error.'}</p>}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/40">
                <CheckCircle2 className="h-4 w-4 text-[#4e9b3f]" /> Live worker
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink/55">
                Last cycle {data.live.lastCycleAt ? timeAgo(data.live.lastCycleAt) : 'not recorded'} · weather every {data.live.weatherIntervalSeconds}s · CAMS every {data.live.aqiIntervalSeconds}s
              </p>
              {data.live.lastCycleErrors.length ? <p className="mt-2 text-[11px] text-[#8a5a08]">{data.live.lastCycleErrors.join(' · ')}</p> : <p className="mt-2 text-[11px] text-ink/40">No recorded cycle errors.</p>}
            </div>
            <div className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/40">
                <Database className="h-4 w-4 text-[#2d7c94]" /> What this means
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink/55">
                A stale feed keeps its original observation timestamp and is never relabelled as current. Weather can fall
                back from Open-Meteo to MET Norway's hourly forecast; that is shown as a forecast, not an observation.
              </p>
              <a href="/data-sources" className="mt-2 inline-block text-[11px] underline underline-offset-2">Data sources and attribution</a>
            </div>
          </div>

          <Callout title="Status is evidence, not a guarantee" tone="amber">
            A provider can be unavailable without this page going down. If a reading is stale, the app keeps the last
            verified value, marks its age, and never invents a replacement. {data.demoMode ? 'This deployment is running in demo mode; synthetic station records stay labelled.' : 'Synthetic station records remain labelled separately from real feeds.'}
          </Callout>
        </>
      ) : null}
    </PublicPage>
  );
}
