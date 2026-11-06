import { env } from '../config/env.js';
import { one } from '../db/pool.js';
import { recordFailure, recordSuccess } from './telemetry.js';
import { weatherIntegrity } from './weather-status.js';

const CHECK_INTERVAL_MS = 5 * 60_000;
const ALERT_COOLDOWN_MS = 30 * 60_000;

export interface WeatherWatchdogState {
  checkedAt: string;
  status: 'OK' | 'STALE' | 'UNAVAILABLE';
  message: string;
  observedAt: string | null;
  provider: string | null;
  sourceId: string | null;
  ageSeconds: number | null;
}

let lastState: WeatherWatchdogState | null = null;
let lastAlertAt = 0;
let lastFailureRecordedAt = 0;
let timer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;

async function postWebhook(state: WeatherWatchdogState): Promise<void> {
  if (!env.OPS_ALERT_WEBHOOK_URL) return;
  try {
    const response = await fetch(env.OPS_ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `[PRAKRUTI] ${state.message}`,
        ...state,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook failed';
    await recordFailure('watchdog:webhook', message);
    console.error('[weather-watchdog] alert webhook failed:', message);
  }
}

async function runCheck(): Promise<void> {
  try {
    const row = await one<{
      observed_at: string;
      retrieved_at: string;
      source_id: string;
      temperature_c: number | null;
      relative_humidity: number | null;
      wind_speed_kmh: number | null;
      precipitation_mm: number | null;
      latitude: number;
      longitude: number;
    }>(
      `SELECT observed_at, retrieved_at, source_id, temperature_c::float8 AS temperature_c,
              relative_humidity::float8 AS relative_humidity, wind_speed_kmh::float8 AS wind_speed_kmh,
              precipitation_mm::float8 AS precipitation_mm,
              ST_Y(location::geometry)::float8 AS latitude, ST_X(location::geometry)::float8 AS longitude
       FROM weather_observations
       WHERE kind='OBSERVATION' AND is_simulated=false
       ORDER BY observed_at DESC LIMIT 1`,
    );

    if (!row) {
      const state: WeatherWatchdogState = {
        checkedAt: new Date().toISOString(),
        status: 'UNAVAILABLE',
        message: 'No real weather observation is stored.',
        observedAt: null,
        provider: null,
        sourceId: null,
        ageSeconds: null,
      };
      await recordStale(state);
      return;
    }

    const check = weatherIntegrity({
      observedAt: row.observed_at,
      fetchedAt: row.retrieved_at,
      sourceId: row.source_id,
      isSimulated: false,
      demoMode: env.DEMO_MODE,
      latitude: row.latitude,
      longitude: row.longitude,
      temperatureC: row.temperature_c,
      relativeHumidity: row.relative_humidity,
      precipitationMm: row.precipitation_mm,
      windSpeedKmh: row.wind_speed_kmh,
    });
    const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(row.observed_at)) / 1000));
    const state: WeatherWatchdogState = {
      checkedAt: new Date().toISOString(),
      status: check.status === 'LIVE' ? 'OK' : check.status === 'STALE' ? 'STALE' : 'UNAVAILABLE',
      message:
        check.status === 'LIVE'
          ? `Weather is live from ${check.provider ?? row.source_id}.`
          : `Weather is ${check.status.toLowerCase()} from ${check.provider ?? row.source_id}; last observation ${new Date(row.observed_at).toISOString()}.`,
      observedAt: check.observationTime,
      provider: check.provider,
      sourceId: row.source_id,
      ageSeconds,
    };

    if (state.status === 'OK') {
      if (lastState?.status !== 'OK') await recordSuccess('watchdog:weather', state);
      lastState = state;
      return;
    }

    await recordStale(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Weather watchdog failed';
    const state: WeatherWatchdogState = {
      checkedAt: new Date().toISOString(),
      status: 'UNAVAILABLE',
      message,
      observedAt: null,
      provider: null,
      sourceId: null,
      ageSeconds: null,
    };
    lastState = state;
    console.error('[weather-watchdog]', message);
  }
}

async function recordStale(state: WeatherWatchdogState): Promise<void> {
  const now = Date.now();
  if (lastState?.status !== state.status || now - lastFailureRecordedAt > ALERT_COOLDOWN_MS) {
    lastFailureRecordedAt = now;
    await recordFailure('watchdog:weather', state.message, state);
    console.error('[weather-watchdog]', state.message);
  }
  if (now - lastAlertAt > ALERT_COOLDOWN_MS) {
    lastAlertAt = now;
    await postWebhook(state);
  }
  lastState = state;
}

export function getWeatherWatchdogState(): WeatherWatchdogState | null {
  return lastState;
}

export function startWeatherWatchdog(): void {
  if (timer) return;
  // Let the first live cycle finish before judging freshness; otherwise every
  // restart on a sleeping host would alert on the pre-restart stale row.
  initialTimer = setTimeout(() => void runCheck(), 60_000);
  initialTimer.unref();
  timer = setInterval(() => void runCheck(), CHECK_INTERVAL_MS);
  timer.unref();
}

export function stopWeatherWatchdog(): void {
  if (initialTimer) clearTimeout(initialTimer);
  if (timer) clearInterval(timer);
  initialTimer = null;
  timer = null;
}
