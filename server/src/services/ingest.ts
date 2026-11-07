import { env } from '../config/env.js';
import { one, query } from '../db/pool.js';
import { isWithinMumbai } from './geo.js';
import { markSourceAttempt, markSourceFailure, markSourceSuccess } from './sources.js';
import { fetchWithRetry } from '../lib/fetch-retry.js';

interface IngestResult {
  records: number;
  message?: string;
}

async function startJob(sourceId: string): Promise<string | null> {
  await markSourceAttempt(sourceId);
  const row = await one<{ id: string }>(
    `INSERT INTO ingestion_jobs (source_id, status) VALUES ($1,'RUNNING') RETURNING id`,
    [sourceId],
  );
  return row?.id ?? null;
}

async function finishJob(jobId: string | null, status: 'SUCCESS' | 'FAILED' | 'SKIPPED', records: number, error?: string) {
  if (!jobId) return;
  await query(
    `UPDATE ingestion_jobs SET status=$2, records=$3, error=$4, finished_at=now() WHERE id=$1`,
    [jobId, status, records, error?.slice(0, 500) ?? null],
  );
}

function isoUtc(value: string): string {
  return value.endsWith('Z') ? value : `${value}Z`;
}

export async function ingestOpenMeteoWeather(): Promise<IngestResult> {
  const sourceId = 'open-meteo-weather';
  const jobId = await startJob(sourceId);
  let records = 0;
  try {
    const stations = await query<{
      id: string;
      locality_id: string | null;
      lat: number;
      lng: number;
    }>(
      `SELECT id, locality_id, ST_Y(location::geometry)::float8 AS lat, ST_X(location::geometry)::float8 AS lng
       FROM monitoring_stations ORDER BY code`,
    );
    if (stations.length === 0) {
      await finishJob(jobId, 'SKIPPED', 0, 'No stations available.');
      return { records: 0 };
    }
    for (const station of stations) {
      const url = new URL(`${env.OPEN_METEO_BASE_URL}/v1/forecast`);
      url.searchParams.set('latitude', String(station.lat));
      url.searchParams.set('longitude', String(station.lng));
      url.searchParams.set(
        'current',
        'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,surface_pressure',
      );
      url.searchParams.set(
        'hourly',
        'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m',
      );
      url.searchParams.set('forecast_days', '2');
      url.searchParams.set('timezone', 'UTC');
      const response = await fetchWithRetry(url, { timeoutMs: 20_000 });
      if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
      const data = (await response.json()) as {
        current?: Record<string, number | string>;
        hourly?: Record<string, Array<number | string>>;
      };
      if (!data.current?.time) continue;
      const current = data.current;
      await query(
        `INSERT INTO weather_observations
           (station_id, locality_id, location, observed_at, kind, temperature_c, relative_humidity,
            wind_speed_kmh, wind_direction_deg, precipitation_mm, pressure_hpa, source_id, raw)
         VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,'OBSERVATION',$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         ON CONFLICT (station_id, observed_at, kind, source_id) DO UPDATE SET
           temperature_c=EXCLUDED.temperature_c, relative_humidity=EXCLUDED.relative_humidity,
           wind_speed_kmh=EXCLUDED.wind_speed_kmh, wind_direction_deg=EXCLUDED.wind_direction_deg,
           precipitation_mm=EXCLUDED.precipitation_mm, pressure_hpa=EXCLUDED.pressure_hpa, raw=EXCLUDED.raw`,
        [
          station.id,
          station.locality_id,
          station.lng,
          station.lat,
          isoUtc(String(current.time)),
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

      const hourly = data.hourly;
      if (hourly?.time) {
        const now = Date.now();
        const indices = hourly.time
          .map((t, index) => ({ t: isoUtc(String(t)), index }))
          .filter(({ t }) => {
            const ts = new Date(t).getTime();
            return ts > now && ts <= now + 18 * 3_600_000;
          })
          .slice(0, 18);
        for (const { t, index } of indices) {
          await query(
            `INSERT INTO weather_observations
               (station_id, locality_id, location, observed_at, kind, temperature_c, relative_humidity,
                wind_speed_kmh, wind_direction_deg, precipitation_mm, source_id, raw)
             VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,'FORECAST',$6,$7,$8,$9,$10,$11,$12::jsonb)
             ON CONFLICT (station_id, observed_at, kind, source_id) DO UPDATE SET
               temperature_c=EXCLUDED.temperature_c, relative_humidity=EXCLUDED.relative_humidity,
               wind_speed_kmh=EXCLUDED.wind_speed_kmh, wind_direction_deg=EXCLUDED.wind_direction_deg,
               precipitation_mm=EXCLUDED.precipitation_mm, raw=EXCLUDED.raw`,
            [
              station.id,
              station.locality_id,
              station.lng,
              station.lat,
              t,
              hourly.temperature_2m?.[index] ?? null,
              hourly.relative_humidity_2m?.[index] ?? null,
              hourly.wind_speed_10m?.[index] ?? null,
              hourly.wind_direction_10m?.[index] ?? null,
              hourly.precipitation?.[index] ?? null,
              sourceId,
              JSON.stringify({ temperature_2m: hourly.temperature_2m?.[index] }),
            ],
          );
          records += 1;
        }
      }
    }
    await markSourceSuccess(sourceId, records);
    await finishJob(jobId, 'SUCCESS', records);
    return { records };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Weather ingestion failed';
    await markSourceFailure(sourceId, message);
    await finishJob(jobId, 'FAILED', records, message);
    return { records, message };
  }
}

export async function ingestOpenMeteoCams(): Promise<IngestResult> {
  const sourceId = 'open-meteo-cams';
  const jobId = await startJob(sourceId);
  let records = 0;
  try {
    const localities = await query<{ id: string; name: string; lat: number; lng: number }>(
      `SELECT DISTINCT l.id, l.name, l.lat::float8, l.lng::float8
       FROM localities l
       JOIN monitoring_stations s ON s.locality_id = l.id
       WHERE s.station_type = 'AIR_CAAQMS'
       ORDER BY l.name`,
    );
    for (const locality of localities) {
      const url = new URL(`${env.OPEN_METEO_AIR_QUALITY_BASE_URL}/v1/air-quality`);
      url.searchParams.set('latitude', String(locality.lat));
      url.searchParams.set('longitude', String(locality.lng));
      url.searchParams.set('current', 'pm2_5,pm10');
      url.searchParams.set('timezone', 'UTC');
      const response = await fetchWithRetry(url, { timeoutMs: 20_000 });
      if (!response.ok) throw new Error(`Open-Meteo air quality ${response.status}`);
      const data = (await response.json()) as {
        current?: { time?: string; pm2_5?: number; pm10?: number };
      };
      if (!data.current?.time) continue;
      for (const [code, value] of [
        ['pm25', data.current.pm2_5],
        ['pm10', data.current.pm10],
      ] as const) {
        if (value === undefined || value === null) continue;
        await query(
          `INSERT INTO environmental_observations
             (station_id, locality_id, category, pollutant_code, value, unit, observed_at, retrieved_at,
              quality_state, is_simulated, source_id, source_record_id, location, raw)
           VALUES (NULL,$1,'air',$2,$3,'µg/m³',$4,now(),'MODELLED',false,$5,$6,
             ST_SetSRID(ST_MakePoint($7,$8),4326)::geography,$9::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            locality.id,
            code,
            value,
            isoUtc(String(data.current.time)),
            sourceId,
            `cams:${locality.id}:${code}:${data.current.time}`,
            locality.lng,
            locality.lat,
            JSON.stringify({ model: 'CAMS via Open-Meteo', locality: locality.name, current: data.current }),
          ],
        );
        records += 1;
      }
    }
    await markSourceSuccess(sourceId, records);
    await finishJob(jobId, 'SUCCESS', records);
    return { records };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CAMS ingestion failed';
    await markSourceFailure(sourceId, message);
    await finishJob(jobId, 'FAILED', records, message);
    return { records, message };
  }
}

function normalisePollutantUnit(code: string, value: number, rawUnit: string): { value: number; unit: string } | null {
  const unit = rawUnit.replace('µg/m3', 'µg/m³').replace('ug/m3', 'µg/m³').replace('mg/m3', 'mg/m³').trim();
  if (code === 'co') {
    if (unit === 'mg/m³') return { value, unit };
    if (unit === 'µg/m³') return { value: value / 1000, unit: 'mg/m³' };
    return null;
  }
  if (unit === 'µg/m³') return { value, unit };
  if (unit === 'mg/m³') return { value: value * 1000, unit: 'µg/m³' };
  return null;
}

const POLLUTANT_MAP: Record<string, string> = {
  'PM2.5': 'pm25',
  PM25: 'pm25',
  PM10: 'pm10',
  NO2: 'no2',
  SO2: 'so2',
  CO: 'co',
  O3: 'o3',
  OZONE: 'o3',
  NH3: 'nh3',
};

/**
 * data.gov.in publishes `DD-MM-YYYY HH:mm:ss` in IST. Passing that string to
 * Date.parse reads it as MM-DD-YYYY, so parse it explicitly.
 */
function parseDataGovInTimestamp(raw: unknown): Date | null {
  const value = String(raw ?? '').trim();
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  const parsed = match
    ? new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6] ?? '00'}+05:30`)
    : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** Map one data.gov.in CPCB record to the fields the database expects. */
export function parseDataGovInRecord(record: Record<string, unknown>): {
  stationName: string;
  lat: number;
  lng: number;
  pollutant: string;
  value: number;
  unit: string;
  observedAt: Date;
} | null {
  const lat = Number(record.latitude);
  const lng = Number(record.longitude);
  if (!isWithinMumbai(lat, lng)) return null;
  const pollutant = POLLUTANT_MAP[String(record.pollutant_id ?? '').toUpperCase()];
  if (!pollutant) return null;
  const rawReading = String(record.avg_value ?? record.pollutant_avg ?? '').trim();
  if (!rawReading || rawReading.toUpperCase() === 'NA') return null;
  const rawValue = Number(rawReading);
  if (!Number.isFinite(rawValue)) return null;
  // The current resource omits the unit; CPCB reports CO in mg/m³ and the
  // remaining pollutants in µg/m³. An explicit unit still wins if present.
  const rawUnit = String(record.pollutant_unit ?? '').trim();
  const unit = rawUnit && rawUnit.toUpperCase() !== 'NA' ? rawUnit : pollutant === 'co' ? 'mg/m³' : 'µg/m³';
  const normalised = normalisePollutantUnit(pollutant, rawValue, unit);
  if (!normalised) return null;
  const observedAt = parseDataGovInTimestamp(record.last_update);
  if (!observedAt) return null;
  return {
    stationName: String(record.station ?? 'Unknown CPCB station'),
    lat,
    lng,
    pollutant,
    value: normalised.value,
    unit: normalised.unit,
    observedAt,
  };
}

/**
 * data.gov.in CPCB adapter. Runs only when both an API key and a verified
 * resource ID are configured. The field names below follow the commonly
 * published CPCB city air-quality resource; records are validated before use.
 * No CPCB endpoint is invented and nothing is fetched without credentials.
 */
export async function ingestDataGovIn(): Promise<IngestResult> {
  const sourceId = 'data-gov-in-air';
  if (!env.DATA_GOV_IN_API_KEY || !env.DATA_GOV_IN_AIR_RESOURCE_ID) {
    return { records: 0, message: 'NOT_CONFIGURED: DATA_GOV_IN_API_KEY / resource ID missing.' };
  }
  const jobId = await startJob(sourceId);
  let records = 0;
  try {
    const url = new URL(`https://api.data.gov.in/resource/${env.DATA_GOV_IN_AIR_RESOURCE_ID}`);
    url.searchParams.set('api-key', env.DATA_GOV_IN_API_KEY);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('filters[city]', 'Mumbai');
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`data.gov.in ${response.status}`);
    const data = (await response.json()) as { records?: Array<Record<string, unknown>> };
    for (const record of data.records ?? []) {
      const parsed = parseDataGovInRecord(record);
      if (!parsed) continue;
      const { stationName, lat, lng, pollutant, value, unit, observedAt } = parsed;
      const code = `DATA_GOV_IN:${stationName}`;
      const station = await one<{ id: string }>(
        `INSERT INTO monitoring_stations (code, name, provider, station_type, location, is_simulated, metadata)
         VALUES ($1,$2,'CPCB via data.gov.in','AIR_CAAQMS',
           ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,false,$5::jsonb)
         ON CONFLICT (code) DO UPDATE SET location=EXCLUDED.location, metadata=EXCLUDED.metadata
         RETURNING id`,
        [code, stationName, lng, lat, JSON.stringify({ sourceStationName: stationName, importedFrom: 'data.gov.in' })],
      );
      if (!station) continue;
      await query(
        `UPDATE monitoring_stations s SET
           locality_id=(SELECT l.id FROM localities l ORDER BY l.location <-> s.location LIMIT 1),
           health_status='ONLINE', last_seen_at=GREATEST(COALESCE(s.last_seen_at, $2::timestamptz), $2::timestamptz)
         WHERE s.id=$1`,
        [station.id, observedAt.toISOString()],
      );
      await query(
        `INSERT INTO environmental_observations
           (station_id, category, pollutant_code, value, unit, observed_at, retrieved_at, quality_state,
            is_simulated, source_id, source_record_id, location, raw)
         VALUES ($1,'air',$2,$3,$4,$5,now(),'VALID',false,$6,$7,
           ST_SetSRID(ST_MakePoint($8,$9),4326)::geography,$10::jsonb)
         ON CONFLICT (station_id, pollutant_code, observed_at, source_id) DO NOTHING`,
        [
          station.id,
          pollutant,
          value,
          unit,
          observedAt.toISOString(),
          sourceId,
          String(record.id ?? `${stationName}:${pollutant}:${observedAt.toISOString()}`),
          lng,
          lat,
          JSON.stringify(record),
        ],
      );
      records += 1;
    }
    await markSourceSuccess(sourceId, records);
    // The public CPCB card describes this same feed; keep its status honest.
    await markSourceSuccess('cpcb-caaqms', records);
    await finishJob(jobId, 'SUCCESS', records);
    return { records };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'data.gov.in ingestion failed';
    await markSourceFailure(sourceId, message);
    await markSourceFailure('cpcb-caaqms', message);
    await finishJob(jobId, 'FAILED', records, message);
    return { records, message };
  }
}

/**
 * OpenAQ v3 adapter. Requires OPENAQ_API_KEY. Only records whose coordinates
 * fall inside the validated Mumbai boundary are stored.
 */
const OPENAQ_FRESHNESS_HOURS = 24;

export async function ingestOpenAq(): Promise<IngestResult> {
  const sourceId = 'openaq';
  if (!env.OPENAQ_API_KEY) return { records: 0, message: 'NOT_CONFIGURED: OPENAQ_API_KEY missing.' };
  const jobId = await startJob(sourceId);
  let records = 0;
  try {
    const locationsUrl = new URL('https://api.openaq.org/v3/locations');
    locationsUrl.searchParams.set('coordinates', '19.076,72.8777');
    locationsUrl.searchParams.set('radius', '25000');
    locationsUrl.searchParams.set('limit', '50');
    const locationsResponse = await fetch(locationsUrl, {
      headers: { 'X-API-Key': env.OPENAQ_API_KEY },
      signal: AbortSignal.timeout(30_000),
    });
    if (!locationsResponse.ok) throw new Error(`OpenAQ locations ${locationsResponse.status}`);
    const locations = (await locationsResponse.json()) as {
      results?: Array<{
        id: number;
        name: string;
        coordinates?: { latitude: number; longitude: number };
        country?: { code: string };
        sensors?: Array<{ id: number; parameter?: { name?: string; units?: string } }>;
      }>;
    };
    for (const location of (locations.results ?? []).slice(0, 15)) {
      const lat = location.coordinates?.latitude;
      const lng = location.coordinates?.longitude;
      if (!lat || !lng || !isWithinMumbai(lat, lng)) continue;
      // OpenAQ /latest returns sensor IDs only, so resolve parameter and unit
      // from the sensors embedded in the locations response.
      const sensors = new Map(
        (location.sensors ?? []).map((sensor) => [
          sensor.id,
          {
            name: String(sensor.parameter?.name ?? '').toUpperCase(),
            unit: String(sensor.parameter?.units ?? ''),
          },
        ]),
      );
      // OpenAQ keeps a last-ever reading for decommissioned sensors, so an
      // unbounded /latest returns rows years old. Ask for the window we can
      // actually treat as live and re-check it after the round trip.
      const freshnessFloor = new Date(Date.now() - OPENAQ_FRESHNESS_HOURS * 3_600_000);
      const latestUrl = new URL(`https://api.openaq.org/v3/locations/${location.id}/latest`);
      latestUrl.searchParams.set('datetime_min', freshnessFloor.toISOString().replace(/\.\d{3}Z$/, 'Z'));
      latestUrl.searchParams.set('limit', '100');
      const latestResponse = await fetch(latestUrl, {
        headers: { 'X-API-Key': env.OPENAQ_API_KEY },
        signal: AbortSignal.timeout(30_000),
      });
      if (!latestResponse.ok) continue;
      const latest = (await latestResponse.json()) as {
        results?: Array<{ sensorsId?: number; value?: number; datetime?: { utc?: string } }>;
      };
      const station = await one<{ id: string }>(
        `INSERT INTO monitoring_stations (code, name, provider, station_type, location, is_simulated, metadata)
         VALUES ($1,$2,'OpenAQ','AIR_CAAQMS',ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,false,$5::jsonb)
         ON CONFLICT (code) DO UPDATE SET location=EXCLUDED.location
         RETURNING id`,
        [`OPENAQ-${location.id}`, location.name, lng, lat, JSON.stringify({ openaqLocationId: location.id })],
      );
      if (!station) continue;
      const latestObserved = (latest.results ?? [])
        .map((result) => (result.datetime?.utc ? new Date(result.datetime.utc) : null))
        .filter((date): date is Date => date !== null && Number.isFinite(date.getTime()))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      await query(
        `UPDATE monitoring_stations s SET
           locality_id=(SELECT l.id FROM localities l ORDER BY l.location <-> s.location LIMIT 1),
           health_status=$2, last_seen_at=$3
         WHERE s.id=$1`,
        [
          station.id,
          latestObserved && Date.now() - latestObserved.getTime() <= 6 * 3_600_000 ? 'ONLINE' : 'DEGRADED',
          latestObserved?.toISOString() ?? null,
        ],
      );
      for (const result of latest.results ?? []) {
        const sensor = result.sensorsId != null ? sensors.get(result.sensorsId) : undefined;
        const code = sensor ? POLLUTANT_MAP[sensor.name] : undefined;
        if (!sensor || !code || result.value === undefined || !result.datetime?.utc) continue;
        const observedAt = new Date(result.datetime.utc);
        if (!Number.isFinite(observedAt.getTime()) || observedAt < freshnessFloor) continue;
        const normalised = normalisePollutantUnit(code, result.value, sensor.unit);
        if (!normalised) continue;
        await query(
          `INSERT INTO environmental_observations
             (station_id, category, pollutant_code, value, unit, observed_at, retrieved_at, quality_state,
              is_simulated, source_id, source_record_id, location, raw)
           VALUES ($1,'air',$2,$3,$4,$5,now(),'VALID',false,$6,$7,
             ST_SetSRID(ST_MakePoint($8,$9),4326)::geography,$10::jsonb)
           ON CONFLICT (station_id, pollutant_code, observed_at, source_id) DO NOTHING`,
          [
            station.id,
            code,
            normalised.value,
            normalised.unit,
            result.datetime.utc,
            sourceId,
            `openaq:${location.id}:${code}:${result.datetime.utc}`,
            lng,
            lat,
            JSON.stringify(result),
          ],
        );
        records += 1;
      }
      // The live /latest endpoint returns one reading per sensor. The model
      // needs 25 consecutive hourly PM2.5 values, so backfill from the raw
      // sub-hourly measurements and aggregate to UTC hourly means, matching
      // the training pipeline. /hours can lag by a few hours and leave gaps.
      const pm25Sensor = (location.sensors ?? [])
        .filter((sensor) => POLLUTANT_MAP[String(sensor.parameter?.name ?? '').toUpperCase()] === 'pm25')
        // Locations can expose a legacy and a current PM2.5 sensor. Prefer the
        // newer sensor ID; the legacy one often has no recent hourly data.
        .sort((a, b) => b.id - a.id)[0];
      if (pm25Sensor) {
        const historyCount = await one<{ count: number }>(
          `SELECT COUNT(DISTINCT date_trunc('hour', observed_at))::int AS count
           FROM environmental_observations
           WHERE station_id=$1 AND pollutant_code='pm25' AND source_id=$2
             AND observed_at > now() - interval '26 hours'`,
          [station.id, sourceId],
        );
        if ((historyCount?.count ?? 0) < 25) {
          const measurementsUrl = new URL(`https://api.openaq.org/v3/sensors/${pm25Sensor.id}/measurements`);
          measurementsUrl.searchParams.set(
            'datetime_from',
            new Date(Date.now() - 72 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
          );
          measurementsUrl.searchParams.set('datetime_to', new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
          measurementsUrl.searchParams.set('limit', '1000');
          // OpenAQ allows 60 requests/minute. Keep the historical backfill
          // below that even when several stations need it in one cycle.
          await new Promise((resolve) => setTimeout(resolve, 1_100));
          const measurementsResponse = await fetch(measurementsUrl, {
            headers: { 'X-API-Key': env.OPENAQ_API_KEY },
            signal: AbortSignal.timeout(30_000),
          });
          if (measurementsResponse.ok) {
            const measurements = (await measurementsResponse.json()) as {
              results?: Array<{
                value?: number;
                parameter?: { units?: string };
                period?: { datetimeFrom?: { utc?: string } };
              }>;
            };
            const hourly = new Map<number, { sum: number; count: number; unit: string; sample: unknown }>();
            for (const result of measurements.results ?? []) {
              const timestamp = result.period?.datetimeFrom?.utc ? new Date(result.period.datetimeFrom.utc) : null;
              if (!timestamp || !Number.isFinite(timestamp.getTime()) || result.value === undefined) continue;
              const normalised = normalisePollutantUnit('pm25', Number(result.value), String(result.parameter?.units ?? ''));
              if (!normalised) continue;
              const hour = Math.floor(timestamp.getTime() / 3_600_000) * 3_600_000;
              const bucket = hourly.get(hour) ?? { sum: 0, count: 0, unit: normalised.unit, sample: result };
              bucket.sum += normalised.value;
              bucket.count += 1;
              hourly.set(hour, bucket);
            }
            for (const [hour, bucket] of hourly) {
              const observedAt = new Date(hour).toISOString();
              await query(
                `INSERT INTO environmental_observations
                   (station_id, category, pollutant_code, value, unit, observed_at, retrieved_at, quality_state,
                    is_simulated, source_id, source_record_id, location, raw)
                 VALUES ($1,'air','pm25',$2,$3,$4,now(),'VALID',false,$5,$6,
                   ST_SetSRID(ST_MakePoint($7,$8),4326)::geography,$9::jsonb)
                 ON CONFLICT (station_id, pollutant_code, observed_at, source_id) DO NOTHING`,
                [
                  station.id,
                  bucket.sum / bucket.count,
                  bucket.unit,
                  observedAt,
                  sourceId,
                  `openaq-hourly:${location.id}:pm25:${observedAt}`,
                  lng,
                  lat,
                  JSON.stringify({ hourlyMean: bucket.sum / bucket.count, samples: bucket.count, sample: bucket.sample }),
                ],
              );
              records += 1;
            }
          }
        }
      }
    }
    await markSourceSuccess(sourceId, records);
    await finishJob(jobId, 'SUCCESS', records);
    return { records };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenAQ ingestion failed';
    await markSourceFailure(sourceId, message);
    await finishJob(jobId, 'FAILED', records, message);
    return { records, message };
  }
}

export async function runAllIngestion(): Promise<Record<string, IngestResult>> {
  const weather = await ingestOpenMeteoWeather();
  const cams = await ingestOpenMeteoCams();
  const dataGov = await ingestDataGovIn();
  const openAq = await ingestOpenAq();
  return { weather, cams, dataGov, openAq };
}
