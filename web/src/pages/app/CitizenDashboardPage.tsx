import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  CloudRain,
  Droplets,
  Mail,
  MapPin,
  RefreshCw,
  Thermometer,
  Wind,
  ExternalLink,
} from 'lucide-react';
import { Badge, Button, Card, CardHeader, CardTitle } from '../../components/ui';
import { FreshnessPill } from '../../components/FreshnessPill';
import { api, ApiError } from '../../lib/api';
import { timeAgo } from '../../lib/format';

interface WeatherClassification {
  severity: 'NORMAL' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  condition: string;
  measuredValue: number | null;
  unit: string | null;
}

interface NewsItem {
  id: string;
  title: string;
  url: string;
  summary: string;
  source: string;
  publishedAt: string | null;
}

interface DashboardPayload {
  profile: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    onboardingCompleted: boolean;
    weatherNotifications: boolean;
    newsNotifications: boolean;
    latitude: number | null;
    longitude: number | null;
    locationLabel: string | null;
    weatherConsentAt: string | null;
    newsConsentAt: string | null;
  };
  weather: {
    observed_at: string | null;
    temperature_c: number | null;
    relative_humidity: number | null;
    precipitation_mm: number | null;
    wind_speed_kmh: number | null;
    wind_gust_kmh: number | null;
    weather_code: number | null;
    source_id: string | null;
    status: 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'DEMO';
    provider: string | null;
    data_source_type: string | null;
    fetched_at: string | null;
    observation_time: string | null;
    forecast_time: string | null;
    is_live: boolean;
    freshness_status: string;
    validation_status: string;
    recommendation: string;
    classification: WeatherClassification | null;
  };
  events: Array<{
    id: string;
    condition: string;
    severity: WeatherClassification['severity'];
    measured_value: number | null;
    unit: string | null;
    starts_at: string;
    last_seen_at: string;
  }>;
  notifications: Array<{
    id: string;
    subject: string;
    status: string;
    sent_at: string | null;
    delivered_at: string | null;
    error: string | null;
    created_at: string;
  }>;
}

const SEVERITY_STYLE: Record<string, string> = {
  NORMAL: 'bg-[#edf5e7] text-[#356b2a] border-[#bfe0ae]',
  MODERATE: 'bg-[#fff7df] text-[#8a5a08] border-[#ecd79a]',
  HIGH: 'bg-[#fff0e4] text-[#9a4a12] border-[#f0c39f]',
  CRITICAL: 'bg-[#fff0ee] text-[#8a2f2a] border-[#e8b7b1]',
};

const STATUS_STYLE: Record<string, string> = {
  SENT: 'bg-[#edf5e7] text-[#356b2a]',
  DELIVERED: 'bg-[#edf5e7] text-[#356b2a]',
  FAILED: 'bg-[#fff0ee] text-[#8a2f2a]',
  SIMULATED: 'bg-[#f4f1e6] text-[#7a6a3a]',
  QUEUED: 'bg-[#eef2f6] text-[#3f5a70]',
};

function fmt(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

export function CitizenDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    try {
      const payload = await api.get<DashboardPayload>('/citizen/dashboard');
      setData(payload);
      if (!payload.profile.onboardingCompleted || payload.profile.latitude === null || payload.profile.longitude === null) {
        navigate('/citizen/onboarding', { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the citizen dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void api
      .get<{ items: NewsItem[] }>('/news')
      .then((result) => setNews(result.items.slice(0, 5)))
      .catch(() => setNews([]));
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5 * 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshWeather = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('/citizen/refresh');
      await load();
      setNotice('Weather refresh requested. The status below reflects the provider response.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not refresh weather.');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-ink/45">Loading citizen dashboard…</div>;
  }
  if (!data) {
    return <div className="p-8 text-sm text-[#8a2f2a]">{error ?? 'Citizen dashboard unavailable.'}</div>;
  }

  const weather = data.weather;
  const severity = weather?.classification?.severity ?? 'NORMAL';
  const hasReading = Boolean(weather?.classification);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/35">Citizen portal</p>
          <h1 className="display mt-1 text-2xl font-bold text-ink">Hello, {data.profile.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink/45">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              {data.profile.email}
              {data.profile.emailVerified ? (
                <span className="inline-flex items-center gap-1 text-[#356b2a]">
                  <CheckCircle2 className="h-3.5 w-3.5" /> verified
                </span>
              ) : null}
            </span>
            {data.profile.locationLabel ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> {data.profile.locationLabel}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refreshWeather} disabled={testing}>
            <RefreshCw className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} /> Refresh weather
          </Button>
          <Link to="/citizen/onboarding">
            <Button variant="subtle" size="sm">
              <MapPin className="h-4 w-4" /> Edit location & alerts
            </Button>
          </Link>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#e8b7b1] bg-[#fff4f2] px-3.5 py-2.5 text-[12px] text-[#8a2f2a]">{error}</p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-[#bfe0ae] bg-[#f2faec] px-3.5 py-2.5 text-[12px] text-[#356b2a]">{notice}</p>
      ) : null}

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Weather at your location</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={SEVERITY_STYLE[severity]}>{severity}</Badge>
              <FreshnessPill
                status={weather?.status ?? 'UNAVAILABLE'}
                observedAt={weather?.observation_time ?? weather?.observed_at}
                provider={weather?.provider}
                sourceId={weather?.source_id}
              />
            </div>
          </CardHeader>
          <div className="px-5 py-5">
            {weather && hasReading ? (
              <>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="display text-5xl font-bold leading-none text-ink">
                      {weather.temperature_c === null ? '—' : `${Math.round(weather.temperature_c)}°`}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-ink/60">{weather.classification?.condition}</p>
                    <p className="mt-1 text-[11px] text-ink/35">
                      {weather.provider ?? 'Unknown provider'} ·{' '}
                      {weather.data_source_type === 'HOURLY_FORECAST' ? 'hourly forecast' : 'current conditions'} ·{' '}
                      {weather.data_source_type === 'HOURLY_FORECAST' ? 'valid' : 'observed'}{' '}
                      {fmt(weather.observation_time ?? weather.observed_at)} · fetched {fmt(weather.fetched_at)}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-ink/55">
                    <span className="inline-flex items-center gap-1.5">
                      <Droplets className="h-3.5 w-3.5" /> {weather.relative_humidity ?? '—'}% RH
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <CloudRain className="h-3.5 w-3.5" /> {weather.precipitation_mm ?? '—'} mm
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Wind className="h-3.5 w-3.5" /> {weather.wind_speed_kmh ?? '—'} km/h
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Thermometer className="h-3.5 w-3.5" /> gust {weather.wind_gust_kmh ?? '—'}
                    </span>
                  </div>
                </div>
                <p className="mt-4 rounded-xl border border-[#dbe5d6] bg-[#f7faf3] px-3.5 py-2.5 text-[11px] leading-relaxed text-ink/60">
                  <span className="font-semibold text-ink/75">Safety recommendation · </span>
                  {weather.recommendation}
                </p>
                {weather.status !== 'LIVE' ? (
                  <p className="mt-3 text-[11px] leading-relaxed text-[#8a5a08]">
                    This reading is {weather.status.toLowerCase()}. Its original timestamp is shown above; no newer
                    verified provider response was available.
                  </p>
                ) : null}
                {data.events.length > 0 ? (
                  <div className="mt-4 space-y-1.5 border-t border-dashed border-[#dbe5d6] pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/35">Recent events</p>
                    {data.events.map((event) => (
                      <p key={event.id} className="text-[11px] text-ink/55">
                        <span className={`mr-1.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${SEVERITY_STYLE[event.severity]}`}>
                          {event.severity}
                        </span>
                        {event.condition} · {event.measured_value ?? '—'} {event.unit ?? ''} · {fmt(event.last_seen_at)}
                      </p>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-[#8a2f2a]">No verified live weather is available for this location.</p>
                <p className="text-[11px] leading-relaxed text-ink/45">
                  The worker will retry the configured providers on its next cycle. No value is substituted when the
                  provider cannot be validated.
                </p>
                <Button size="sm" variant="outline" onClick={refreshWeather} disabled={testing}>
                  <RefreshCw className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} /> Retry now
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest environmental news</CardTitle>
          <Link to="/news" className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/40 hover:text-ink/70">
            Open newsroom
          </Link>
        </CardHeader>
        <div className="divide-y divide-[#eef2ea] px-5 py-2">
          {news.length === 0 ? (
            <p className="py-4 text-sm text-ink/40">News feeds are temporarily unavailable.</p>
          ) : (
            news.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-start justify-between gap-4 py-3 transition-colors hover:text-[#356b2a]"
              >
                <span>
                  <span className="block text-sm font-semibold leading-snug text-ink/80">{item.title}</span>
                  <span className="mt-1 block text-[10px] uppercase tracking-[0.1em] text-ink/35">
                    {item.source}
                    {item.publishedAt ? ` · ${timeAgo(item.publishedAt)}` : ''}
                  </span>
                </span>
                <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-ink/25" />
              </a>
            ))
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification history</CardTitle>
          <span className="text-[10px] uppercase tracking-[0.12em] text-ink/30">Weather & critical news</span>
        </CardHeader>
        <div className="overflow-x-auto px-5 py-4">
          {data.notifications.length === 0 ? (
            <p className="text-sm text-ink/40">No weather or critical-news alerts sent yet.</p>
          ) : (
            <table className="w-full min-w-[560px] text-left text-[11px]">
              <thead className="text-[9px] uppercase tracking-[0.12em] text-ink/30">
                <tr>
                  <th className="pb-2 font-semibold">Subject</th>
                  <th className="pb-2 font-semibold">Status</th>
                  <th className="pb-2 font-semibold">Sent</th>
                  <th className="pb-2 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2ea] text-ink/60">
                {data.notifications.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-3 font-medium text-ink/75">{row.subject}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${STATUS_STYLE[row.status] ?? 'bg-[#f2f2f2] text-ink/50'}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{fmt(row.sent_at ?? row.created_at)}</td>
                    <td className="py-2 text-[10px] text-ink/40">{row.error ?? (row.delivered_at ? `Delivered ${fmt(row.delivered_at)}` : 'Awaiting delivery webhook')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
