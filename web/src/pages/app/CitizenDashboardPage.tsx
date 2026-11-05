import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  CloudRain,
  Droplets,
  Mail,
  MapPin,
  RefreshCw,
  Send,
  Thermometer,
  Wind,
} from 'lucide-react';
import { Badge, Button, Card, CardHeader, CardTitle } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

interface WeatherClassification {
  severity: 'NORMAL' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  condition: string;
  measuredValue: number | null;
  unit: string | null;
}

interface DashboardPayload {
  profile: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    onboardingCompleted: boolean;
    weatherNotifications: boolean;
    latitude: number | null;
    longitude: number | null;
    locationLabel: string | null;
    weatherConsentAt: string | null;
  };
  weather: {
    observed_at: string;
    temperature_c: number | null;
    precipitation_mm: number | null;
    wind_speed_kmh: number | null;
    wind_gust_kmh: number | null;
    weather_code: number | null;
    source_id: string;
    classification: WeatherClassification;
  } | null;
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
  provider: {
    emailConfigured: boolean;
    emailProvider: string;
    demoMode: boolean;
    googleConfigured: boolean;
  };
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
  const [enabled, setEnabled] = useState(false);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    try {
      const payload = await api.get<DashboardPayload>('/citizen/dashboard');
      setData(payload);
      setEnabled(payload.profile.weatherNotifications);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePreferences = async () => {
    if (!data?.profile.locationLabel || data.profile.latitude === null || data.profile.longitude === null) {
      navigate('/citizen/onboarding');
      return;
    }
    if (enabled && !consent && !data.profile.weatherConsentAt) {
      setError('Tick the consent box before enabling weather emails.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.put('/citizen/profile', {
        locationLabel: data.profile.locationLabel,
        latitude: data.profile.latitude,
        longitude: data.profile.longitude,
        weatherNotifications: enabled,
        consent: enabled,
      });
      setNotice(enabled ? 'Weather email alerts are enabled for this location.' : 'Weather email alerts are disabled.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save notification preferences.');
    } finally {
      setSaving(false);
    }
  };

  const refreshWeather = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('/citizen/refresh');
      await load();
      setNotice('Live weather refreshed from Open-Meteo.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not refresh weather.');
    } finally {
      setTesting(false);
    }
  };

  const sendTestEmail = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ status: string; recipient?: string; error?: string; demoMode?: boolean }>(
        '/notifications/test-email',
      );
      if (result.status === 'FAILED') {
        setError(result.error ?? 'Gmail rejected the test message.');
      } else {
        setNotice(
          result.demoMode
            ? `DEMO_MODE redirected the test email to ${result.recipient ?? 'the demo recipient'}. Set DEMO_MODE=false for the citizen's verified address.`
            : `Test email accepted by the provider for ${result.recipient ?? data?.profile.email}.`,
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the test email.');
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
  const severity = weather?.classification.severity ?? 'NORMAL';

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
              <MapPin className="h-4 w-4" /> Edit location
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Live weather at your location</CardTitle>
            <Badge className={SEVERITY_STYLE[severity]}>{severity}</Badge>
          </CardHeader>
          <div className="px-5 py-5">
            {weather ? (
              <>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="display text-5xl font-bold leading-none text-ink">
                      {weather.temperature_c === null ? '—' : `${Math.round(weather.temperature_c)}°`}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-ink/60">{weather.classification.condition}</p>
                    <p className="mt-1 text-[11px] text-ink/35">Observed {fmt(weather.observed_at)} · Open-Meteo</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-ink/55">
                    <span className="inline-flex items-center gap-1.5">
                      <Droplets className="h-3.5 w-3.5" /> {weather.precipitation_mm ?? '—'} mm
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Wind className="h-3.5 w-3.5" /> {weather.wind_speed_kmh ?? '—'} km/h
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Thermometer className="h-3.5 w-3.5" /> gust {weather.wind_gust_kmh ?? '—'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <CloudRain className="h-3.5 w-3.5" /> code {weather.weather_code ?? '—'}
                    </span>
                  </div>
                </div>
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
              <p className="text-sm text-ink/45">
                No reading yet. The worker fetches your location within a few minutes, or press “Refresh weather”.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email alerts</CardTitle>
            <Badge className={data.provider.emailConfigured ? 'bg-[#edf5e7] text-[#356b2a]' : 'bg-[#fff0ee] text-[#8a2f2a]'}>
              {data.provider.emailConfigured ? data.provider.emailProvider : 'NOT_CONFIGURED'}
            </Badge>
          </CardHeader>
          <div className="space-y-4 px-5 py-5">
            <label className="flex items-start gap-3 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#4e9b3f]"
              />
              <span>
                <span className="font-semibold text-ink">Weather alerts for {data.profile.locationLabel ?? 'my location'}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink/40">
                  Recipient: {data.profile.email}. The server monitors even after you close the browser.
                </span>
              </span>
            </label>

            {enabled && !data.profile.weatherConsentAt ? (
              <label className="flex items-start gap-3 rounded-xl border border-[#ecd79a] bg-[#fff9e8] px-3 py-2.5 text-[11px] leading-relaxed text-[#7a5a16]">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#4e9b3f]"
                />
                I consent to automated weather alert emails at my verified address.
              </label>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={savePreferences} disabled={saving}>
                {saving ? 'Saving…' : 'Save preference'}
              </Button>
              <Button size="sm" variant="outline" onClick={sendTestEmail} disabled={testing || !data.provider.emailConfigured}>
                <Send className="h-4 w-4" /> Send test email
              </Button>
            </div>

            {data.provider.demoMode ? (
              <p className="flex items-start gap-2 rounded-xl border border-[#ecd79a] bg-[#fff9e8] px-3 py-2.5 text-[11px] leading-relaxed text-[#7a5a16]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                DEMO_MODE is on. Emails are redirected to the configured demo recipient, not the citizen's inbox. Set
                DEMO_MODE=false and real Gmail credentials for production.
              </p>
            ) : null}
            {!data.provider.emailConfigured ? (
              <p className="text-[11px] leading-relaxed text-[#8a2f2a]">
                Gmail SMTP is not configured. Alerts will be recorded as FAILED, never as delivered. Set SMTP_USER and
                SMTP_PASSWORD (Google App Password) and EMAIL_PROVIDER=gmail.
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notification history</CardTitle>
          <span className="text-[10px] uppercase tracking-[0.12em] text-ink/30">Weather only</span>
        </CardHeader>
        <div className="overflow-x-auto px-5 py-4">
          {data.notifications.length === 0 ? (
            <p className="text-sm text-ink/40">No weather alerts sent yet.</p>
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
