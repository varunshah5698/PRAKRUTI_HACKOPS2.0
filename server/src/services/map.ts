import { query } from '../db/pool.js';
import { calculateAqi } from './aqi.js';
import { baselineForecast, anomalyScore } from './forecast.js';
import { getStationSeries, getStationSnapshots, getLatestWeather } from './station-data.js';

export interface MapFilters {
  at: string;
  category: string;
  pollutant?: string | null;
  localityId?: string | null;
  sourceId?: string | null;
  severity?: string | null;
  verification?: string | null;
  includeForecast: boolean;
}

const CATEGORY_TYPE: Record<string, string> = {
  air: 'AIR_CAAQMS',
  water: 'WATER_SAMPLING',
  industrial: 'INDUSTRIAL_STACK',
};

export async function getMapTimeline(filters: MapFilters) {
  const at = new Date(filters.at);
  if (!Number.isFinite(at.getTime())) throw new Error('Invalid timeline timestamp');
  const now = new Date();
  const deltaHours = (at.getTime() - now.getTime()) / 3_600_000;
  const mode: 'PAST' | 'CURRENT' | 'FUTURE' = deltaHours < -0.1 ? 'PAST' : deltaHours > 0.1 ? 'FUTURE' : 'CURRENT';
  const category = filters.category || 'air';
  const stationType = CATEGORY_TYPE[category];
  const warnings: string[] = [];

  let stations: Array<Record<string, unknown>> = [];
  let forecastMeta: Record<string, unknown> | null = null;

  if (mode === 'FUTURE') {
    if (category !== 'air') {
      warnings.push(`No future forecast exists for ${category}. Historical and current records only.`);
    } else if (!filters.includeForecast) {
      warnings.push('Forecast layer is hidden.');
    } else {
      const horizon = Math.max(1, Math.min(6, Math.round(deltaHours)));
      const rows = await query<{
        id: string;
        code: string;
        name: string;
        locality_id: string | null;
        locality_name: string | null;
        lat: number;
        lng: number;
        is_simulated: boolean;
        health_status: string;
        observed_at: string;
        value: number;
      }>(
        `SELECT s.id, s.code, s.name, s.locality_id, l.name AS locality_name,
                ST_Y(s.location::geometry)::float8 AS lat, ST_X(s.location::geometry)::float8 AS lng,
                s.is_simulated, s.health_status, o.observed_at, o.value::float8 AS value
         FROM monitoring_stations s
         LEFT JOIN localities l ON l.id=s.locality_id
         LEFT JOIN LATERAL (
           SELECT observed_at, value FROM environmental_observations
           WHERE station_id=s.id AND pollutant_code='pm25' AND quality_state <> 'INVALID'
           ORDER BY observed_at DESC LIMIT 12
         ) o ON true
         WHERE s.station_type='AIR_CAAQMS'
         ORDER BY s.code, o.observed_at ASC`,
        [],
      );
      const grouped = new Map<string, { base: (typeof rows)[number]; history: Array<{ observedAt: string; value: number }> }>();
      for (const row of rows) {
        if (!grouped.has(row.id)) grouped.set(row.id, { base: row, history: [] });
        if (row.observed_at && row.value !== null) {
          grouped.get(row.id)!.history.push({ observedAt: row.observed_at, value: Number(row.value) });
        }
      }
      for (const { base, history } of grouped.values()) {
        const forecast = baselineForecast(history, horizon, now);
        if (!forecast) {
          stations.push({
            id: base.id,
            code: base.code,
            name: base.name,
            localityId: base.locality_id,
            localityName: base.locality_name,
            lat: Number(base.lat),
            lng: Number(base.lng),
            isSimulated: base.is_simulated,
            healthStatus: base.health_status,
            forecast: null,
            forecastUnavailable: true,
          });
          continue;
        }
        const aqi = calculateAqi({ pm25: forecast.predictedValue });
        stations.push({
          id: base.id,
          code: base.code,
          name: base.name,
          localityId: base.locality_id,
          localityName: base.locality_name,
          lat: Number(base.lat),
          lng: Number(base.lng),
          isSimulated: base.is_simulated,
          healthStatus: base.health_status,
          forecast: {
            ...forecast,
            pollutant: 'PM2.5',
            unit: 'µg/m³',
            aqiIndicative: aqi.aqi,
            aqiCategory: aqi.category,
          },
          aqi: aqi.aqi,
          aqiCategory: aqi.category,
          markerKind: 'PREDICTED',
        });
      }
      if (filters.pollutant && filters.pollutant !== 'pm25' && filters.pollutant !== 'aqi') {
        warnings.push('Only PM2.5 persistence-baseline forecasts are available. Other pollutant forecasts are unavailable.');
      }
      forecastMeta = {
        available: true,
        method: 'PERSISTENCE_BASELINE_V1',
        status: 'NOT_A_TRAINED_MODEL',
        horizonHours: horizon,
        targetTime: at.toISOString(),
        note:
          'Persistence baseline with an empirical 80% band. LightGBM models are NOT TRAINED. Forecasts are not confirmed future conditions and are not regulatory determinations.',
      };
      if (!stations.some((s) => s.forecast)) warnings.push('FORECAST UNAVAILABLE for the selected time.');
    }
  } else if (mode === 'PAST') {
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
      station_simulated: boolean;
      pollutant_code: string | null;
      value: number | null;
      unit: string | null;
      observed_at: string | null;
      quality_state: string | null;
      source_id: string | null;
      obs_simulated: boolean | null;
      delta_minutes: number | null;
    }>(
      `SELECT s.id, s.code, s.name, s.provider, s.station_type, s.locality_id, l.name AS locality_name,
              ST_Y(s.location::geometry)::float8 AS lat, ST_X(s.location::geometry)::float8 AS lng,
              s.health_status, s.is_simulated AS station_simulated,
              o.pollutant_code, o.value::float8 AS value, o.unit, o.observed_at, o.quality_state,
              o.source_id, o.is_simulated AS obs_simulated,
              ABS(EXTRACT(EPOCH FROM (o.observed_at - $1::timestamptz)) / 60)::float8 AS delta_minutes
       FROM monitoring_stations s
       LEFT JOIN localities l ON l.id=s.locality_id
       LEFT JOIN LATERAL (
         SELECT DISTINCT ON (pollutant_code) pollutant_code, value, unit, observed_at, quality_state, source_id, is_simulated
         FROM environmental_observations
         WHERE station_id=s.id
           AND observed_at BETWEEN $1::timestamptz - interval '90 minutes' AND $1::timestamptz + interval '90 minutes'
           AND ($2::text IS NULL OR category=$2)
           AND quality_state <> 'INVALID'
         ORDER BY pollutant_code, ABS(EXTRACT(EPOCH FROM (observed_at - $1::timestamptz)))
       ) o ON true
       WHERE ($3::text IS NULL OR s.station_type=$3)
       ORDER BY s.code, o.pollutant_code`,
      [at.toISOString(), category, stationType ?? null],
    );
    const map = new Map<string, Record<string, unknown> & { values: Record<string, unknown> }>();
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
          isSimulated: row.station_simulated,
          values: {},
          latestObservedAt: null,
          sampleDeltaMinutes: null,
          markerKind: 'OBSERVED',
        });
      }
      const station = map.get(row.id)!;
      if (row.pollutant_code && row.value !== null && row.observed_at) {
        (station.values as Record<string, unknown>)[row.pollutant_code] = {
          value: Number(row.value),
          unit: row.unit,
          observedAt: row.observed_at,
          qualityState: row.quality_state,
          sourceId: row.source_id,
          isSimulated: row.obs_simulated,
        };
        station.latestObservedAt = row.observed_at;
        station.sampleDeltaMinutes = row.delta_minutes;
      }
    }
    stations = [...map.values()].map((station) => {
      const values = station.values as Record<string, { value: number }>;
      const numeric: Record<string, number> = {};
      for (const [code, reading] of Object.entries(values)) numeric[code] = reading.value;
      const aqi = station.stationType === 'AIR_CAAQMS' ? calculateAqi(numeric) : null;
      return {
        ...station,
        values,
        aqi: aqi?.aqi ?? null,
        aqiCategory: aqi?.category ?? 'NOT_APPLICABLE',
        isStale: !station.latestObservedAt,
      };
    });
    if (category === 'waste') stations = [];
    if (stations.length && !stations.some((s) => (s.values as Record<string, unknown>)[filters.pollutant ?? 'pm25'])) {
      warnings.push('No archived observation was found within ±90 minutes for the selected time.');
    }
  } else {
    const snapshots = await getStationSnapshots(category === 'waste' ? undefined : category);
    stations = snapshots.map((s) => ({
      ...s,
      markerKind: 'OBSERVED',
    }));
    if (category === 'waste') {
      stations = [];
      warnings.push('No waste monitoring stations exist. Waste is represented by citizen reports and incidents.');
    }
    if (!stations.some((s) => s.latestObservedAt)) warnings.push('No recent observations available for this category.');
  }

  if (filters.localityId) stations = stations.filter((s) => s.localityId === filters.localityId);
  if (filters.sourceId) {
    stations = stations.filter((s) => {
      const values = (s.values ?? {}) as Record<string, { sourceId?: string }>;
      return Object.values(values).some((v) => v?.sourceId === filters.sourceId);
    });
  }
  if (filters.pollutant && filters.pollutant !== 'aqi') {
    stations = stations.filter((s) => {
      if (s.forecast) return filters.pollutant === 'pm25';
      const values = (s.values ?? {}) as Record<string, unknown>;
      return Boolean(values[filters.pollutant!]);
    });
  }
  if (filters.severity) {
    stations = stations.filter((s) => String(s.aqiCategory ?? '').toLowerCase() === filters.severity!.toLowerCase());
  }

  const reportWindowStart = mode === 'PAST' ? new Date(at.getTime() - 48 * 3_600_000) : new Date(Date.now() - 7 * 86_400_000);
  const reports = await query<Record<string, unknown>>(
    `SELECT r.id, r.public_ref, r.category, r.incident_type, r.status, r.verification_state, r.submitted_at,
            r.is_simulated, r.locality_id, l.name AS locality_name,
            ST_Y(r.location::geometry)::float8 AS lat, ST_X(r.location::geometry)::float8 AS lng
     FROM environmental_reports r LEFT JOIN localities l ON l.id=r.locality_id
     WHERE r.submitted_at >= $1 AND r.submitted_at <= $2
       AND ($3::text IS NULL OR r.category=$3)
       AND ($4::uuid IS NULL OR r.locality_id=$4)
       AND ($5::text IS NULL OR r.verification_state=$5)
     ORDER BY r.submitted_at DESC LIMIT 250`,
    [
      reportWindowStart.toISOString(),
      mode === 'PAST' ? at.toISOString() : new Date().toISOString(),
      category,
      filters.localityId ?? null,
      filters.verification ?? null,
    ],
  );

  const incidents = await query<Record<string, unknown>>(
    `SELECT i.id, i.public_ref, i.category, i.title, i.status, i.risk_level, i.detected_at, i.is_simulated,
            i.locality_id, l.name AS locality_name,
            ST_Y(i.location::geometry)::float8 AS lat, ST_X(i.location::geometry)::float8 AS lng
     FROM environmental_incidents i LEFT JOIN localities l ON l.id=i.locality_id
     WHERE i.detected_at <= $1 AND i.simulation_session_id IS NULL AND ($2::text IS NULL OR i.category=$2)
       AND ($3::uuid IS NULL OR i.locality_id=$3)
     ORDER BY i.detected_at DESC LIMIT 100`,
    [mode === 'PAST' ? at.toISOString() : new Date().toISOString(), category, filters.localityId ?? null],
  );

  const alerts = await query<Record<string, unknown>>(
    `SELECT a.id, a.public_ref, a.category, a.level, a.state, a.trigger_type, a.title, a.triggered_at,
            a.is_simulated, a.locality_id, l.name AS locality_name
     FROM environmental_alerts a LEFT JOIN localities l ON l.id=a.locality_id
     WHERE a.triggered_at <= $1 AND a.state NOT IN ('CLOSED') AND a.simulation_session_id IS NULL
       AND ($2::text IS NULL OR a.category=$2)
       AND ($3::uuid IS NULL OR a.locality_id=$3)
     ORDER BY a.triggered_at DESC LIMIT 100`,
    [mode === 'PAST' ? at.toISOString() : new Date().toISOString(), category, filters.localityId ?? null],
  );

  const localities = await query<Record<string, unknown>>(
    `SELECT id, name, lat::float8, lng::float8 FROM localities ORDER BY name`,
  );

  return {
    at: at.toISOString(),
    mode,
    category,
    filters,
    stations,
    reports,
    incidents,
    alerts,
    localities,
    warnings,
    forecastMeta,
    estimatedZones: [],
    estimatedZoneNote:
      'No interpolated pollution surface or risk polygon is drawn. The monitoring network is sparse and station observations in this deployment are simulation-labelled. A point measurement does not establish concentration across a locality.',
    boundary: {
      url: '/geo/mumbai-boundary.geojson',
      source: 'OpenStreetMap via Nominatim (ODbL 1.0)',
      note: 'Greater Mumbai = Mumbai City District + Mumbai Suburban District.',
    },
    mapAttribution: 'OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors (ODbL)',
    generatedAt: new Date().toISOString(),
  };
}

export async function getStationDetail(stationId: string) {
  const snapshots = await getStationSnapshots();
  const station = snapshots.find((s) => s.id === stationId);
  if (!station) return null;
  const pollutants = Object.keys(station.values);
  const primary = station.stationType === 'AIR_CAAQMS' ? 'pm25' : station.stationType === 'WATER_SAMPLING' ? 'do' : 'stack_pm';
  const series = await getStationSeries(stationId, primary, 48);
  const weather = await getLatestWeather(stationId);
  const forecasts = [];
  if (station.stationType === 'AIR_CAAQMS') {
    for (const horizon of [1, 3, 6]) {
      const forecast = baselineForecast(
        series.map((s) => ({ observedAt: s.observed_at, value: Number(s.value) })),
        horizon,
      );
      if (forecast) forecasts.push({ ...forecast, pollutant: 'PM2.5', unit: 'µg/m³' });
    }
  }
  const anomaly = anomalyScore(series.map((s) => ({ observedAt: s.observed_at, value: Number(s.value) })));

  const nearbyStations = await query<Record<string, unknown>>(
    `SELECT s.id, s.code, s.name, s.station_type, s.health_status,
            ST_Distance(s.location, (SELECT location FROM monitoring_stations WHERE id=$1))::float8 AS distance_m,
            (SELECT value::float8 FROM environmental_observations o WHERE o.station_id=s.id AND o.pollutant_code='pm25'
              ORDER BY observed_at DESC LIMIT 1) AS latest_pm25,
            (SELECT observed_at FROM environmental_observations o WHERE o.station_id=s.id
              ORDER BY observed_at DESC LIMIT 1) AS latest_observed_at
     FROM monitoring_stations s
     WHERE s.id <> $1 AND ST_DWithin(s.location, (SELECT location FROM monitoring_stations WHERE id=$1), 6000)
     ORDER BY distance_m LIMIT 6`,
    [stationId],
  );

  const nearbyReports = await query<Record<string, unknown>>(
    `SELECT r.id, r.public_ref, r.category, r.incident_type, r.status, r.verification_state, r.submitted_at,
            ST_Distance(r.location, (SELECT location FROM monitoring_stations WHERE id=$1))::float8 AS distance_m
     FROM environmental_reports r
     WHERE ST_DWithin(r.location, (SELECT location FROM monitoring_stations WHERE id=$1), 3000)
     ORDER BY r.submitted_at DESC LIMIT 8`,
    [stationId],
  );

  const alerts = await query<Record<string, unknown>>(
    `SELECT id, public_ref, category, level, state, trigger_type, title, summary, triggered_at, is_simulated
     FROM environmental_alerts WHERE (station_id=$1 OR (entity_type='station' AND entity_id=$1))
       AND simulation_session_id IS NULL
     ORDER BY triggered_at DESC LIMIT 8`,
    [stationId],
  );

  const risk = await query<Record<string, unknown>>(
    `SELECT id, risk_score::float8, risk_level, confidence_score::float8, confidence_level, alert_state,
            method, supporting_evidence, missing_inputs, calculated_at, ruleset_version, is_simulated
     FROM risk_assessments WHERE entity_type='station' AND entity_id=$1 AND is_simulated = false
     ORDER BY calculated_at DESC LIMIT 1`,
    [stationId],
  );

  const seriesAll = await query<Record<string, unknown>>(
    `SELECT pollutant_code, observed_at, value::float8 AS value, unit, quality_state, is_simulated
     FROM environmental_observations WHERE station_id=$1 AND observed_at > now() - interval '48 hours'
     ORDER BY observed_at ASC`,
    [stationId],
  );

  return {
    station,
    pollutants,
    series,
    seriesAll,
    weather: weather[0] ?? null,
    forecasts,
    anomaly,
    nearbyStations,
    nearbyReports,
    alerts,
    risk: risk[0] ?? null,
    forecastStatus: {
      trainedModel: 'NOT_TRAINED',
      availableMethod: 'PERSISTENCE_BASELINE_V1',
      note:
        'No LightGBM model is trained because no verified Mumbai historical training extract has been supplied. Forecasts shown are a labelled persistence baseline, not ML output.',
      shap: 'UNAVAILABLE — no trained model',
    },
    dataQuality: {
      stationHealth: station.healthStatus,
      latestObservedAt: station.latestObservedAt,
      isStale: station.isStale,
      simulated: station.isSimulated,
      note: station.isSimulated ? 'SIMULATION DATA — not a CPCB station record.' : 'Source record.',
    },
  };
}
