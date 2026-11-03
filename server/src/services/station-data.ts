import { query } from '../db/pool.js';
import { calculateAqi } from './aqi.js';

export interface StationValue {
  value: number;
  unit: string;
  observedAt: string;
  qualityState: string;
  sourceId: string;
  isSimulated: boolean;
}

export interface StationSnapshot {
  id: string;
  code: string;
  name: string;
  provider: string;
  stationType: string;
  localityId: string | null;
  localityName: string | null;
  lat: number;
  lng: number;
  healthStatus: string;
  lastSeenAt: string | null;
  isSimulated: boolean;
  values: Record<string, StationValue>;
  aqi: ReturnType<typeof calculateAqi> | null;
  latestObservedAt: string | null;
  isStale: boolean;
}

export async function getStationSnapshots(category?: string): Promise<StationSnapshot[]> {
  const rows = await query<{
    id: string;
    code: string;
    name: string;
    provider: string;
    station_type: string;
    locality_id: string | null;
    locality_name: string | null;
    lat: number;
    lng: number;
    health_status: string;
    last_seen_at: string | null;
    station_simulated: boolean;
    pollutant_code: string | null;
    value: number | null;
    unit: string | null;
    observed_at: string | null;
    quality_state: string | null;
    source_id: string | null;
    obs_simulated: boolean | null;
  }>(
    `SELECT s.id, s.code, s.name, s.provider, s.station_type, s.locality_id, l.name AS locality_name,
            ST_Y(s.location::geometry)::float8 AS lat, ST_X(s.location::geometry)::float8 AS lng,
            s.health_status, s.last_seen_at, s.is_simulated AS station_simulated,
            o.pollutant_code, o.value::float8 AS value, o.unit, o.observed_at, o.quality_state,
            o.source_id, o.is_simulated AS obs_simulated
     FROM monitoring_stations s
     LEFT JOIN localities l ON l.id = s.locality_id
     LEFT JOIN LATERAL (
       SELECT DISTINCT ON (pollutant_code)
         pollutant_code, value, unit, observed_at, quality_state, source_id, is_simulated
       FROM environmental_observations
       WHERE station_id = s.id
         AND observed_at > now() - interval '24 hours'
         AND ($1::text IS NULL OR category = $1)
         AND quality_state <> 'INVALID'
       ORDER BY pollutant_code, observed_at DESC
     ) o ON true
     ORDER BY s.code, o.pollutant_code`,
    [category ?? null],
  );

  const map = new Map<string, StationSnapshot>();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        code: row.code,
        name: row.name,
        provider: row.provider,
        stationType: row.station_type,
        localityId: row.locality_id,
        localityName: row.locality_name,
        lat: Number(row.lat),
        lng: Number(row.lng),
        healthStatus: row.health_status,
        lastSeenAt: row.last_seen_at,
        isSimulated: row.station_simulated,
        values: {},
        aqi: null,
        latestObservedAt: null,
        isStale: false,
      });
    }
    const station = map.get(row.id)!;
    if (row.pollutant_code && row.value !== null && row.unit && row.observed_at) {
      station.values[row.pollutant_code] = {
        value: Number(row.value),
        unit: row.unit,
        observedAt: row.observed_at,
        qualityState: row.quality_state ?? 'UNKNOWN',
        sourceId: row.source_id ?? 'unknown',
        isSimulated: row.obs_simulated ?? false,
      };
      if (!station.latestObservedAt || new Date(row.observed_at) > new Date(station.latestObservedAt)) {
        station.latestObservedAt = row.observed_at;
      }
    }
  }

  for (const station of map.values()) {
    if (station.stationType === 'AIR_CAAQMS') {
      const values: Record<string, number> = {};
      for (const [code, reading] of Object.entries(station.values)) values[code] = reading.value;
      station.aqi = calculateAqi(values);
    }
    station.isStale =
      !station.latestObservedAt || Date.now() - new Date(station.latestObservedAt).getTime() > 6 * 3_600_000;
  }

  const categoryType: Record<string, string> = {
    air: 'AIR_CAAQMS',
    water: 'WATER_SAMPLING',
    industrial: 'INDUSTRIAL_STACK',
  };
  const wanted = category ? categoryType[category] : null;
  return [...map.values()].filter((s) => !wanted || s.stationType === wanted);
}

export async function getStationSeries(stationId: string, pollutant: string, hours = 48) {
  return query<{ observed_at: string; value: number; unit: string; quality_state: string; is_simulated: boolean }>(
    `SELECT observed_at, value::float8 AS value, unit, quality_state, is_simulated
     FROM environmental_observations
     WHERE station_id=$1 AND pollutant_code=$2 AND observed_at > now() - ($3 || ' hours')::interval
       AND quality_state <> 'INVALID'
     ORDER BY observed_at ASC`,
    [stationId, pollutant, String(hours)],
  );
}

export async function getLatestWeather(stationId: string) {
  return query<{
    observed_at: string;
    temperature_c: number | null;
    relative_humidity: number | null;
    wind_speed_kmh: number | null;
    wind_direction_deg: number | null;
    precipitation_mm: number | null;
    is_simulated: boolean;
    source_id: string;
  }>(
    `SELECT observed_at, temperature_c::float8, relative_humidity::float8, wind_speed_kmh::float8,
            wind_direction_deg::float8, precipitation_mm::float8, is_simulated, source_id
     FROM weather_observations
     WHERE station_id=$1 AND kind='OBSERVATION'
     ORDER BY observed_at DESC LIMIT 1`,
    [stationId],
  );
}
