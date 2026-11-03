import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { calculateAqi } from './aqi.js';
import { emitEvent } from '../lib/events.js';
import { markSourceAttempt, markSourceFailure, markSourceSuccess } from './sources.js';
import { ingestDataGovIn, ingestOpenAq } from './ingest.js';

/**
 * Live polling. Upstream providers publish on their own clocks (Open-Meteo
 * current weather has a 900 s interval, CAMS hourly), so polling more often
 * shortens the delay before a new value lands here; it never fabricates one.
 * Every row keeps both clocks: observed_at (upstream validity) and
 * retrieved_at (when we fetched it).
 */

const WEATHER_FIELDS =
  'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,surface_pressure';

interface LiveStation {
  id: string;
  code: string;
  name: string;
  station_type: string;
  locality_id: string | null;
  locality_name: string | null;
  lat: number;
  lng: number;
  is_simulated: boolean;
}

export interface LiveValue {
  value: number;
  unit: string;
  observedAt: string;
  retrievedAt: string;
  sourceId: string;
  isSimulated: boolean;
  qualityState: string;
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
  weather: {
    temperatureC: number | null;
    relativeHumidity: number | null;
    windSpeedKmh: number | null;
    windDirectionDeg: number | null;
    precipitationMm: number | null;
    pressureHpa: number | null;
    observedAt: string | null;
    retrievedAt: string | null;
    sourceId: string | null;
  } | null;
}

function isoUtc(value: unknown): string {
  const time = String(value);
  return time.endsWith('Z') ? time : `${time}Z`;
}

/**
 * pg hands back timestamps as Date objects; String(date) would serialise as a
 * locale-dependent "Tue Nov 03 2026 ..." string. Every timestamp leaving this
 * service is ISO-8601 UTC so the UI can compare it against generatedAt.
 */
function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function liveStations(): Promise<LiveStation[]> {
  return query<LiveStation>(
    `SELECT s.id, s.code, s.name, s.station_type, s.locality_id, l.name AS locality_name,
            ST_Y(s.location::geometry)::float8 AS lat, ST_X(s.location::geometry)::float8 AS lng,
            s.is_simulated
     FROM monitoring_stations s LEFT JOIN localities l ON l.id = s.locality_id
     ORDER BY s.code`,
  );
}

/** One batched request for every station instead of one request per station. */
export async function pollLiveWeather(): Promise<{ records: number; message?: string }> {
  const sourceId = 'open-meteo-weather';
  const stations = await liveStations();
  if (stations.length === 0) return { records: 0, message: 'No stations available.' };
  await markSourceAttempt(sourceId);
  let records = 0;
  try {
    for (const group of chunk(stations, 50)) {
      const url = new URL(`${env.OPEN_METEO_BASE_URL}/v1/forecast`);
      url.searchParams.set('latitude', group.map((s) => s.lat).join(','));
      url.searchParams.set('longitude', group.map((s) => s.lng).join(','));
      url.searchParams.set('current', WEATHER_FIELDS);
      url.searchParams.set('timezone', 'UTC');
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Open-Meteo weather ${response.status}`);
      const payload = await response.json();
      const results: Array<{ current?: Record<string, number | string> }> = Array.isArray(payload) ? payload : [payload];
      for (let index = 0; index < group.length; index += 1) {
        const station = group[index];
        const current = results[index]?.current;
        if (!current?.time) continue;
        const observedAt = isoUtc(current.time);
        await query(
          `INSERT INTO weather_observations
             (station_id, locality_id, location, observed_at, retrieved_at, kind, temperature_c,
              relative_humidity, wind_speed_kmh, wind_direction_deg, precipitation_mm, pressure_hpa,
              source_id, is_simulated, raw)
           VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,now(),'OBSERVATION',$6,$7,$8,$9,$10,$11,$12,false,$13::jsonb)
           ON CONFLICT (station_id, observed_at, kind, source_id) DO UPDATE SET
             retrieved_at=now(), temperature_c=EXCLUDED.temperature_c,
             relative_humidity=EXCLUDED.relative_humidity, wind_speed_kmh=EXCLUDED.wind_speed_kmh,
             wind_direction_deg=EXCLUDED.wind_direction_deg, precipitation_mm=EXCLUDED.precipitation_mm,
             pressure_hpa=EXCLUDED.pressure_hpa, raw=EXCLUDED.raw`,
          [
            station.id,
            station.locality_id,
            station.lng,
            station.lat,
            observedAt,
            current.temperature_2m ?? null,
            current.relative_humidity_2m ?? null,
            current.wind_speed_10m ?? null,
            current.wind_direction_10m ?? null,
            current.precipitation ?? null,
            current.surface_pressure ?? null,
            sourceId,
            JSON.stringify(current),
          ],
        );
        records += 1;
      }
    }
    await markSourceSuccess(sourceId, records);
    return { records };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live weather poll failed';
    await markSourceFailure(sourceId, message);
    return { records, message };
  }
}

/** CAMS modelled PM context for localities that host an air station. */
export async function pollLiveAqi(): Promise<{ records: number; message?: string }> {
  const sourceId = 'open-meteo-cams';
  const localities = await query<{ id: string; name: string; lat: number; lng: number }>(
    `SELECT DISTINCT l.id, l.name, l.lat::float8, l.lng::float8
     FROM localities l JOIN monitoring_stations s ON s.locality_id = l.id
     WHERE s.station_type = 'AIR_CAAQMS' ORDER BY l.name`,
  );
  if (localities.length === 0) return { records: 0, message: 'No air stations with localities.' };
  await markSourceAttempt(sourceId);
  let records = 0;
  try {
    for (const group of chunk(localities, 50)) {
      const url = new URL(`${env.OPEN_METEO_AIR_QUALITY_BASE_URL}/v1/air-quality`);
      url.searchParams.set('latitude', group.map((l) => l.lat).join(','));
      url.searchParams.set('longitude', group.map((l) => l.lng).join(','));
      url.searchParams.set('current', 'pm2_5,pm10');
      url.searchParams.set('timezone', 'UTC');
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Open-Meteo air quality ${response.status}`);
      const payload = await response.json();
      const results: Array<{ current?: { time?: string; pm2_5?: number; pm10?: number } }> = Array.isArray(payload)
        ? payload
        : [payload];
      for (let index = 0; index < group.length; index += 1) {
        const locality = group[index];
        const current = results[index]?.current;
        if (!current?.time) continue;
        const observedAt = isoUtc(current.time);
        for (const [code, value] of [
          ['pm25', current.pm2_5],
          ['pm10', current.pm10],
        ] as const) {
          if (value === undefined || value === null) continue;
          await query(
            `INSERT INTO environmental_observations
               (station_id, locality_id, category, pollutant_code, value, unit, observed_at, retrieved_at,
                quality_state, is_simulated, source_id, source_record_id, location, raw)
             VALUES (NULL,$1,'air',$2,$3,'µg/m³',$4,now(),'MODELLED',false,$5,$6,
               ST_SetSRID(ST_MakePoint($7,$8),4326)::geography,$9::jsonb)
             ON CONFLICT (source_id, source_record_id) WHERE source_record_id IS NOT NULL
               DO UPDATE SET retrieved_at=now(), value=EXCLUDED.value, raw=EXCLUDED.raw`,
            [
              locality.id,
              code,
              value,
              observedAt,
              sourceId,
              `cams:${locality.id}:${code}:${current.time}`,
              locality.lng,
              locality.lat,
              JSON.stringify({ model: 'CAMS via Open-Meteo', locality: locality.name, current }),
            ],
          );
          records += 1;
        }
      }
    }
    await markSourceSuccess(sourceId, records);
    return { records };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live CAMS poll failed';
    await markSourceFailure(sourceId, message);
    return { records, message };
  }
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulated stations emit a labelled reading every tick so the demo network
 * behaves like a real one. Values follow a mean-reverting walk around the
 * station's own 24 h profile; nothing here is a regulatory measurement.
 */
export async function tickSimulatedStations(): Promise<{ records: number; message?: string }> {
  if (!env.DEMO_MODE) return { records: 0 };
  const sourceId = 'demo-network';
  const previous = await query<{
    station_id: string;
    station_code: string;
    category: string;
    pollutant_code: string;
    value: number;
    unit: string;
    locality_id: string | null;
    lat: number;
    lng: number;
    baseline: number | null;
  }>(
    `SELECT station_id, station_code, category, pollutant_code, value, unit, locality_id, lat, lng, baseline
     FROM (
       SELECT o.station_id, s.code AS station_code, o.category, o.pollutant_code,
              o.value::float8 AS value, o.unit, s.locality_id,
              ST_Y(s.location::geometry)::float8 AS lat, ST_X(s.location::geometry)::float8 AS lng,
              AVG(o.value::float8) OVER (PARTITION BY o.station_id, o.pollutant_code) AS baseline,
              ROW_NUMBER() OVER (
                PARTITION BY o.station_id, o.pollutant_code ORDER BY o.observed_at DESC
              ) AS latest
       FROM environmental_observations o JOIN monitoring_stations s ON s.id = o.station_id
       WHERE s.is_simulated = true AND o.source_id = 'demo-network' AND o.quality_state <> 'INVALID'
         AND o.observed_at > now() - interval '24 hours'
     ) ranked
     WHERE latest = 1
     ORDER BY station_code, pollutant_code`,
  );
  if (previous.length === 0) return { records: 0, message: 'No simulated stations to tick.' };

  await markSourceAttempt(sourceId);
  const observedAt = new Date();
  observedAt.setSeconds(0, 0);
  const minuteIndex = Math.floor(observedAt.getTime() / 60_000);
  let records = 0;
  try {
    for (const row of previous) {
      const digits = Number(row.station_code.replace(/\D/g, '')) || 1;
      const random = mulberry32(digits * 7919 + minuteIndex * 104729 + row.pollutant_code.length * 31);
      const drift = (random() - 0.5) * 2;
      // Mean reversion keeps the walk around the station's own 24 h profile
      // instead of wandering to physically implausible values.
      const baseline = Number(row.baseline) || row.value;
      const pull = 0.12 * (baseline - row.value);
      const spread = Math.max(baseline * 0.012, 0.004);
      const next = Math.max(0.01, Number((row.value + pull + drift * spread).toFixed(2)));
      await query(
        `INSERT INTO environmental_observations
           (station_id, locality_id, category, pollutant_code, value, unit, observed_at, retrieved_at,
            quality_state, is_simulated, source_id, source_record_id, location)
         VALUES ($1,$2,$10,$3,$4,$5,$6,now(),'VALID',true,'demo-network',$7,
           ST_SetSRID(ST_MakePoint($8,$9),4326)::geography)
         ON CONFLICT (station_id, pollutant_code, observed_at, source_id) DO UPDATE SET
           value=EXCLUDED.value, retrieved_at=now()`,
        [
          row.station_id,
          row.locality_id,
          row.pollutant_code,
          next,
          row.unit,
          observedAt.toISOString(),
          `${row.station_code}:${row.pollutant_code}:${observedAt.toISOString()}`,
          row.lng,
          row.lat,
          row.category,
        ],
      );
      records += 1;
    }
    await query(
      `UPDATE monitoring_stations SET last_seen_at=$2, health_status='ONLINE'
       WHERE id IN (SELECT DISTINCT station_id FROM environmental_observations WHERE observed_at=$1 AND source_id='demo-network')`,
      [observedAt.toISOString(), observedAt.toISOString()],
    );
    await markSourceSuccess(sourceId, records);
    return { records };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Simulation tick failed';
    await markSourceFailure(sourceId, message);
    return { records, message };
  }
}

/** True when at least one credentialed real-world air-quality feed is available. */
export function airQualityConfigured(): boolean {
  return Boolean(
    (env.DATA_GOV_IN_API_KEY && env.DATA_GOV_IN_AIR_RESOURCE_ID) || env.OPENAQ_API_KEY,
  );
}

/**
 * Real-world air quality: CPCB CAAQMS via data.gov.in, plus OpenAQ. Each
 * adapter returns NOT_CONFIGURED without its credentials and validates records
 * against the Mumbai boundary before storing, so this never invents a reading.
 */
export async function pollLiveAirQuality(): Promise<{ records: number; message?: string }> {
  const [dataGov, openAq] = await Promise.all([ingestDataGovIn(), ingestOpenAq()]);
  const message = [dataGov.message, openAq.message].filter(Boolean).join(' · ') || undefined;
  return { records: dataGov.records + openAq.records, message };
}

/** Latest reading per station with both freshness clocks, for the live UI. */
export async function getLiveSnapshot(stationId?: string): Promise<LiveReading[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT s.id, s.code, s.name, s.station_type, s.is_simulated, l.name AS locality_name,
            ST_Y(s.location::geometry)::float8 AS lat, ST_X(s.location::geometry)::float8 AS lng,
            o.pollutant_code, o.value::float8 AS value, o.unit, o.observed_at, o.retrieved_at,
            o.source_id, o.is_simulated AS obs_simulated, o.quality_state
     FROM monitoring_stations s
     LEFT JOIN localities l ON l.id = s.locality_id
     LEFT JOIN LATERAL (
       SELECT DISTINCT ON (pollutant_code) pollutant_code, value, unit, observed_at, retrieved_at,
              source_id, is_simulated, quality_state
       FROM environmental_observations
       WHERE station_id = s.id AND observed_at > now() - interval '6 hours'
         AND quality_state <> 'INVALID' AND ($1::uuid IS NULL OR s.id = $1)
       ORDER BY pollutant_code, observed_at DESC
     ) o ON true
     ORDER BY s.code, o.pollutant_code`,
    [stationId ?? null],
  );

  const weather = await query<Record<string, unknown>>(
    `SELECT DISTINCT ON (w.station_id) w.station_id, w.temperature_c::float8 AS temperature_c,
            w.relative_humidity::float8 AS relative_humidity, w.wind_speed_kmh::float8 AS wind_speed_kmh,
            w.wind_direction_deg::float8 AS wind_direction_deg, w.precipitation_mm::float8 AS precipitation_mm,
            w.pressure_hpa::float8 AS pressure_hpa, w.observed_at, w.retrieved_at, w.source_id
     FROM weather_observations w
     WHERE w.kind='OBSERVATION' AND w.observed_at > now() - interval '3 days'
       AND ($1::uuid IS NULL OR w.station_id = $1)
     ORDER BY w.station_id, w.observed_at DESC`,
    [stationId ?? null],
  );
  const weatherByStation = new Map(weather.map((w) => [String(w.station_id), w]));

  const map = new Map<string, LiveReading>();
  for (const row of rows) {
    const id = String(row.id);
    if (!map.has(id)) {
      map.set(id, {
        stationId: id,
        code: String(row.code),
        name: String(row.name),
        stationType: String(row.station_type),
        localityName: row.locality_name ? String(row.locality_name) : null,
        lat: Number(row.lat),
        lng: Number(row.lng),
        isSimulated: Boolean(row.is_simulated),
        values: {},
        aqi: null,
        latestObservedAt: null,
        latestRetrievedAt: null,
        weather: null,
      });
    }
    const station = map.get(id)!;
    if (row.pollutant_code && row.value !== null && row.observed_at) {
      const value: LiveValue = {
        value: Number(row.value),
        unit: String(row.unit ?? ''),
        observedAt: toIso(row.observed_at),
        retrievedAt: toIso(row.retrieved_at ?? row.observed_at),
        sourceId: String(row.source_id ?? 'unknown'),
        isSimulated: Boolean(row.obs_simulated),
        qualityState: String(row.quality_state ?? 'VALID'),
      };
      station.values[String(row.pollutant_code)] = value;
      if (!station.latestObservedAt || new Date(value.observedAt) > new Date(station.latestObservedAt)) {
        station.latestObservedAt = value.observedAt;
      }
      if (!station.latestRetrievedAt || new Date(value.retrievedAt) > new Date(station.latestRetrievedAt)) {
        station.latestRetrievedAt = value.retrievedAt;
      }
    }
  }

  for (const station of map.values()) {
    if (station.stationType === 'AIR_CAAQMS') {
      const values: Record<string, number> = {};
      for (const [code, reading] of Object.entries(station.values)) values[code] = reading.value;
      const result = calculateAqi(values);
      station.aqi = { aqi: result.aqi, category: result.category, dominantPollutant: result.dominantPollutant };
    }
    const w = weatherByStation.get(station.stationId);
    if (w) {
      station.weather = {
        temperatureC: w.temperature_c === null ? null : Number(w.temperature_c),
        relativeHumidity: w.relative_humidity === null ? null : Number(w.relative_humidity),
        windSpeedKmh: w.wind_speed_kmh === null ? null : Number(w.wind_speed_kmh),
        windDirectionDeg: w.wind_direction_deg === null ? null : Number(w.wind_direction_deg),
        precipitationMm: w.precipitation_mm === null ? null : Number(w.precipitation_mm),
        pressureHpa: w.pressure_hpa === null ? null : Number(w.pressure_hpa),
        observedAt: w.observed_at ? toIso(w.observed_at) : null,
        retrievedAt: w.retrieved_at ? toIso(w.retrieved_at) : null,
        sourceId: w.source_id ? String(w.source_id) : null,
      };
    }
  }

  return [...map.values()];
}

/** Minute-resolution series for one station, used by the drawer live chart. */
export async function getLiveSeries(stationId: string, minutes = 60) {
  return query<{ pollutant_code: string; observed_at: string; value: number; unit: string }>(
    `SELECT pollutant_code, observed_at, value::float8 AS value, unit
     FROM environmental_observations
     WHERE station_id=$1 AND observed_at > now() - ($2 || ' minutes')::interval AND quality_state <> 'INVALID'
     ORDER BY observed_at ASC`,
    [stationId, String(minutes)],
  );
}

interface LiveCycleState {
  at: string | null;
  weather: number;
  aqi: number;
  airQuality: number;
  simulated: number;
  errors: string[];
}

const state: LiveCycleState = { at: null, weather: 0, aqi: 0, airQuality: 0, simulated: 0, errors: [] };
const timers: NodeJS.Timeout[] = [];

async function broadcast() {
  state.at = new Date().toISOString();
  const readings = await getLiveSnapshot();
  emitEvent('live', { at: state.at, demoMode: env.DEMO_MODE, stations: readings });
}

const inFlight = new Set<string>();

async function runTask(
  name: 'weather' | 'aqi' | 'airQuality' | 'simulated',
  task: () => Promise<{ records: number; message?: string }>,
) {
  if (inFlight.has(name)) return;
  inFlight.add(name);
  try {
    const result = await task();
    state[name] = result.records;
    state.errors = result.message ? [result.message] : [];
    if (result.message) console.warn(`[live:${name}]`, result.message);
    if (result.records > 0) await broadcast();
  } catch (error) {
    const message = error instanceof Error ? error.message : `${name} failed`;
    console.error(`[live:${name}]`, message);
    emitEvent('live_error', { at: new Date().toISOString(), source: name, message });
  } finally {
    inFlight.delete(name);
  }
}

/** One cycle on demand (used by the authority refresh button and tests). */
export async function runLiveCycle() {
  const weather = await pollLiveWeather();
  const aqi = await pollLiveAqi();
  const airQuality = airQualityConfigured() ? await pollLiveAirQuality() : { records: 0 };
  const simulated = await tickSimulatedStations();
  await broadcast();
  return { weather, aqi, airQuality, simulated, at: state.at };
}

export function startLiveScheduler(): void {
  if (!env.LIVE_ENABLED || timers.length > 0) return;
  const withAirQuality = airQualityConfigured();
  void (async () => {
    await runTask('weather', pollLiveWeather);
    await runTask('aqi', pollLiveAqi);
    if (withAirQuality) await runTask('airQuality', pollLiveAirQuality);
    if (env.DEMO_MODE) await runTask('simulated', tickSimulatedStations);
  })();
  timers.push(
    setInterval(() => void runTask('weather', pollLiveWeather), env.LIVE_WEATHER_INTERVAL_SECONDS * 1000),
    setInterval(() => void runTask('aqi', pollLiveAqi), env.LIVE_AQI_INTERVAL_SECONDS * 1000),
  );
  if (withAirQuality) {
    timers.push(
      setInterval(
        () => void runTask('airQuality', pollLiveAirQuality),
        env.LIVE_AIR_QUALITY_INTERVAL_SECONDS * 1000,
      ),
    );
  }
  if (env.DEMO_MODE) {
    timers.push(
      setInterval(() => void runTask('simulated', tickSimulatedStations), env.LIVE_SIMULATION_INTERVAL_SECONDS * 1000),
    );
  }
  timers.forEach((timer) => timer.unref());
}

export function stopLiveScheduler(): void {
  while (timers.length > 0) clearInterval(timers.pop());
}

export function liveStatus() {
  return {
    enabled: env.LIVE_ENABLED,
    weatherIntervalSeconds: env.LIVE_WEATHER_INTERVAL_SECONDS,
    aqiIntervalSeconds: env.LIVE_AQI_INTERVAL_SECONDS,
    airQualityIntervalSeconds: env.LIVE_AIR_QUALITY_INTERVAL_SECONDS,
    simulationIntervalSeconds: env.LIVE_SIMULATION_INTERVAL_SECONDS,
    upstreamWeatherIntervalSeconds: 900,
    airQuality: {
      configured: airQualityConfigured(),
      dataGovIn: Boolean(env.DATA_GOV_IN_API_KEY && env.DATA_GOV_IN_AIR_RESOURCE_ID),
      openAq: Boolean(env.OPENAQ_API_KEY),
      note: airQualityConfigured()
        ? 'Real-world station records are ingested on the air-quality interval.'
        : 'No credentialed CPCB/OpenAQ feed is configured, so station records are simulation-labelled only. Set DATA_GOV_IN_API_KEY or OPENAQ_API_KEY to enable live ingestion.',
    },
    note:
      'Polling runs on the intervals above. Upstream values only change when the provider publishes them, so a poll can return the same reading as the previous one.',
    lastCycleAt: state.at,
    lastCycleRecords: {
      weather: state.weather,
      aqi: state.aqi,
      airQuality: state.airQuality,
      simulated: state.simulated,
    },
    lastCycleErrors: state.errors,
  };
}
