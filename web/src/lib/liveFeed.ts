import { useEffect, useState } from 'react';
import { api, API_ORIGIN } from './api';

export interface LiveValue {
  value: number;
  unit: string;
  observedAt: string;
  retrievedAt: string;
  sourceId: string;
  isSimulated: boolean;
  qualityState: string;
}

export interface LiveWeather {
  temperatureC: number | null;
  relativeHumidity: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  precipitationMm: number | null;
  pressureHpa: number | null;
  observedAt: string | null;
  retrievedAt: string | null;
  sourceId: string | null;
}

export interface LiveReading {
  stationId: string;
  code: string;
  name: string;
  stationType: string;
  localityName: string | null;
  lat: number;
  lng: number;
  isSimulated: boolean;
  values: Record<string, LiveValue>;
  aqi: { aqi: number | null; category: string; dominantPollutant: string | null } | null;
  latestObservedAt: string | null;
  latestRetrievedAt: string | null;
  weather: LiveWeather | null;
}

export interface LiveStatus {
  enabled: boolean;
  weatherIntervalSeconds: number;
  aqiIntervalSeconds: number;
  airQualityIntervalSeconds: number;
  simulationIntervalSeconds: number;
  upstreamWeatherIntervalSeconds: number;
  airQuality: {
    configured: boolean;
    dataGovIn: boolean;
    openAq: boolean;
    note: string;
  };
  lastCycleAt: string | null;
}

interface LiveState {
  generatedAt: string | null;
  readings: Record<string, LiveReading>;
  status: LiveStatus | null;
  transport: 'stream' | 'poll' | 'idle';
}

const EMPTY: LiveState = { generatedAt: null, readings: {}, status: null, transport: 'idle' };

let state: LiveState = EMPTY;
const listeners = new Set<() => void>();
let stream: EventSource | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function notify() {
  for (const listener of listeners) listener();
}

function patch(next: Partial<LiveState>) {
  state = { ...state, ...next };
  notify();
}

function indexByStation(readings: LiveReading[]) {
  const map: Record<string, LiveReading> = {};
  for (const reading of readings) map[reading.stationId] = reading;
  return map;
}

async function fetchSnapshot() {
  const data = await api.get<{ generatedAt: string; readings: LiveReading[]; status: LiveStatus }>('/live/');
  patch({
    generatedAt: data.generatedAt,
    readings: indexByStation(data.readings),
    status: data.status,
    transport: 'poll',
  });
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    fetchSnapshot().catch(() => patch({ transport: 'poll' }));
  }, 30_000);
}

function openStream() {
  if (stream) return;
  try {
    stream = new EventSource(`${API_ORIGIN}/api/v1/events`, { withCredentials: true });
  } catch {
    startPolling();
    return;
  }
  stream.addEventListener('live', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        at: string;
        demoMode: boolean;
        stations: LiveReading[];
      };
      patch({ generatedAt: payload.at, readings: indexByStation(payload.stations), transport: 'stream' });
    } catch {
      // Ignore malformed frames; the next poll restores state.
    }
  });
  stream.addEventListener('live_error', () => startPolling());
  stream.onerror = () => {
    // EventSource retries by itself; polling keeps the panel usable meanwhile.
    startPolling();
  };
}

export function ensureLiveFeed() {
  if (state.transport !== 'idle' && stream) return;
  openStream();
  fetchSnapshot().catch(() => undefined);
}

export function useLiveFeed(): LiveState {
  const [snapshot, setSnapshot] = useState(state);
  useEffect(() => {
    const listener = () => setSnapshot(state);
    listeners.add(listener);
    ensureLiveFeed();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return snapshot;
}

export function useLiveStation(stationId?: string | null): LiveReading | undefined {
  const { readings } = useLiveFeed();
  return stationId ? readings[stationId] : undefined;
}

/** Ticking clock for per-second age display. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function ageSeconds(value?: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.round((now - parsed) / 1000));
}

/**
 * Estimate between the two most recent readings, capped at the latest real one.
 * Returns null when there is nothing to interpolate, so callers show the raw
 * reading instead of a fabricated value.
 */
export function interpolate(values: Array<{ observedAt: string; value: number }>, at = Date.now()) {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
  const previous = sorted[sorted.length - 2];
  const latest = sorted[sorted.length - 1];
  const start = new Date(previous.observedAt).getTime();
  const end = new Date(latest.observedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const clamped = Math.min(at, end);
  if (clamped <= start) return null;
  const ratio = (clamped - start) / (end - start);
  return {
    value: previous.value + (latest.value - previous.value) * ratio,
    capped: at >= end,
    spanSeconds: Math.round((end - start) / 1000),
  };
}
