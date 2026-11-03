import { one, query } from '../db/pool.js';
import type { RiskAssessmentResult } from '../types.js';
import { baselineForecast } from './forecast.js';
import {
  assessAir,
  assessIndustrial,
  assessWater,
  assessWaste,
  type LatestReading,
} from './risk-engine.js';

interface StationRow {
  id: string;
  code: string;
  name: string;
  provider: string;
  station_type: string;
  health_status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
  last_seen_at: string | null;
  is_simulated: boolean;
  locality_id: string | null;
  locality_name: string | null;
  lat: number;
  lng: number;
}

async function getStation(stationId: string): Promise<StationRow | null> {
  return one<StationRow>(
    `SELECT s.id, s.code, s.name, s.provider, s.station_type, s.health_status, s.last_seen_at,
            s.is_simulated, s.locality_id, l.name AS locality_name,
            ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng
     FROM monitoring_stations s
     LEFT JOIN localities l ON l.id = s.locality_id
     WHERE s.id = $1`,
    [stationId],
  );
}

async function latestReadings(stationId: string, category: string): Promise<Record<string, LatestReading>> {
  const rows = await query<{
    pollutant_code: string;
    value: number;
    unit: string;
    observed_at: string;
    quality_state: string;
    source_id: string;
    is_simulated: boolean;
  }>(
    `SELECT DISTINCT ON (pollutant_code)
       pollutant_code, value::float8 AS value, unit, observed_at, quality_state, source_id, is_simulated
     FROM environmental_observations
     WHERE station_id = $1 AND category = $2
       AND observed_at > now() - interval '24 hours'
       AND quality_state <> 'INVALID'
     ORDER BY pollutant_code, observed_at DESC`,
    [stationId, category],
  );
  const map: Record<string, LatestReading> = {};
  for (const row of rows) {
    map[row.pollutant_code] = {
      value: Number(row.value),
      unit: row.unit,
      observedAt: row.observed_at,
      qualityState: row.quality_state,
      sourceId: row.source_id,
      isSimulated: row.is_simulated,
    };
  }
  return map;
}

async function pm25History(stationId: string): Promise<Array<{ observedAt: string; value: number }>> {
  const rows = await query<{ observed_at: string; value: number }>(
    `SELECT observed_at, value::float8 AS value
     FROM environmental_observations
     WHERE station_id = $1 AND pollutant_code = 'pm25'
       AND observed_at > now() - interval '24 hours' AND quality_state <> 'INVALID'
     ORDER BY observed_at ASC`,
    [stationId],
  );
  return rows.map((r) => ({ observedAt: r.observed_at, value: Number(r.value) }));
}

async function latestWeather(stationId: string) {
  return one<{
    wind_speed_kmh: number | null;
    wind_direction_deg: number | null;
    temperature_c: number | null;
    relative_humidity: number | null;
    observed_at: string;
  }>(
    `SELECT wind_speed_kmh::float8, wind_direction_deg::float8, temperature_c::float8,
            relative_humidity::float8, observed_at
     FROM weather_observations
     WHERE station_id = $1 AND kind = 'OBSERVATION'
     ORDER BY observed_at DESC LIMIT 1`,
    [stationId],
  );
}

export async function persistRisk(
  result: RiskAssessmentResult,
  isSimulated: boolean,
  simulationSessionId: string | null = null,
): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO risk_assessments
       (category, entity_type, entity_id, risk_score, risk_level, confidence_score, confidence_level,
        alert_state, method, supporting_evidence, missing_inputs, calculated_at, ruleset_version,
        is_simulated, simulation_session_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)
     RETURNING id`,
    [
      result.category,
      result.entityType,
      result.entityId,
      result.riskScore,
      result.riskLevel,
      result.confidenceScore,
      result.confidenceLevel,
      result.alertState,
      result.method,
      JSON.stringify(result.supportingEvidence),
      result.missingInputs,
      result.calculatedAt,
      result.rulesetVersion,
      isSimulated,
      simulationSessionId,
    ],
  );
  if (!row) throw new Error('Failed to persist risk assessment');
  for (const factor of result.factors) {
    await query(
      `INSERT INTO risk_factor_breakdowns (assessment_id, factor, weight, contribution, detail)
       VALUES ($1,$2,$3,$4,$5)`,
      [row.id, factor.factor, factor.weight, factor.contribution, factor.detail],
    );
  }
  return row.id;
}

export interface StationAssessment extends RiskAssessmentResult {
  assessmentId: string;
  station: {
    id: string;
    code: string;
    name: string;
    provider: string;
    stationType: string;
    healthStatus: string;
    lastSeenAt: string | null;
    isSimulated: boolean;
    localityId: string | null;
    localityName: string | null;
    lat: number;
    lng: number;
  };
}

export async function evaluateStation(
  stationId: string,
  options: { persist?: boolean; simulationSessionId?: string | null; isSimulatedOverride?: boolean } = {},
): Promise<StationAssessment | null> {
  const station = await getStation(stationId);
  if (!station) return null;
  const isSimulated = options.isSimulatedOverride ?? station.is_simulated;
  const latest = await latestReadings(stationId, station.station_type === 'WATER_SAMPLING' ? 'water' : station.station_type === 'INDUSTRIAL_STACK' ? 'industrial' : 'air');

  let result: RiskAssessmentResult;
  if (station.station_type === 'WATER_SAMPLING') {
    const reports = await one<{ verified: number; unverified: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE verification_state = 'VERIFIED')::int AS verified,
         COUNT(*) FILTER (WHERE verification_state <> 'VERIFIED')::int AS unverified
       FROM environmental_reports
       WHERE category = 'water' AND submitted_at > now() - interval '7 days'
         AND ST_DWithin(location, (SELECT location FROM monitoring_stations WHERE id = $1), 2000)`,
      [stationId],
    );
    result = assessWater({
      siteId: station.id,
      siteName: station.name,
      isSimulated,
      latest,
      verifiedReports7d: reports?.verified ?? 0,
      unverifiedReports7d: reports?.unverified ?? 0,
    });
  } else if (station.station_type === 'INDUSTRIAL_STACK') {
    const baselineRows = await query<{ pollutant_code: string; avg_value: number }>(
      `SELECT pollutant_code, AVG(value)::float8 AS avg_value
       FROM environmental_observations
       WHERE station_id = $1 AND category = 'industrial'
         AND observed_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'
       GROUP BY pollutant_code`,
      [stationId],
    );
    const baseline: Record<string, number> = {};
    for (const row of baselineRows) baseline[row.pollutant_code] = Number(row.avg_value);
    const reports = await one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM environmental_reports
       WHERE category = 'industrial' AND verification_state = 'VERIFIED'
         AND submitted_at > now() - interval '7 days'
         AND ST_DWithin(location, (SELECT location FROM monitoring_stations WHERE id = $1), 3000)`,
      [stationId],
    );
    const incidents = await one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM environmental_incidents
       WHERE category = 'industrial' AND status NOT IN ('RESOLVED','CLOSED')
         AND ST_DWithin(location, (SELECT location FROM monitoring_stations WHERE id = $1), 3000)`,
      [stationId],
    );
    result = assessIndustrial({
      siteId: station.id,
      siteName: station.name,
      isSimulated,
      latest,
      baseline,
      verifiedReports7d: reports?.count ?? 0,
      openIncidents: incidents?.count ?? 0,
    });
  } else {
    const history = await pm25History(stationId);
    const forecast = baselineForecast(history, 3);
    const weather = await latestWeather(stationId);
    result = assessAir({
      stationId: station.id,
      stationName: station.name,
      isSimulated,
      latest,
      pm25History: history,
      forecastPm25: forecast,
      healthStatus: station.health_status,
      weather: weather
        ? {
            windSpeedKmh: weather.wind_speed_kmh === null ? null : Number(weather.wind_speed_kmh),
            windDirectionDeg: weather.wind_direction_deg === null ? null : Number(weather.wind_direction_deg),
            observedAt: weather.observed_at,
          }
        : null,
    });
  }

  const assessmentId =
    options.persist === false
      ? 'not-persisted'
      : await persistRisk(result, isSimulated, options.simulationSessionId ?? null);

  return {
    ...result,
    assessmentId,
    station: {
      id: station.id,
      code: station.code,
      name: station.name,
      provider: station.provider,
      stationType: station.station_type,
      healthStatus: station.health_status,
      lastSeenAt: station.last_seen_at,
      isSimulated,
      localityId: station.locality_id,
      localityName: station.locality_name,
      lat: Number(station.lat),
      lng: Number(station.lng),
    },
  };
}

export async function evaluateAllStations(): Promise<StationAssessment[]> {
  const stations = await query<{ id: string }>('SELECT id FROM monitoring_stations ORDER BY code');
  const results: StationAssessment[] = [];
  for (const station of stations) {
    const assessment = await evaluateStation(station.id);
    if (assessment) results.push(assessment);
  }
  return results;
}

export async function evaluateWasteLocalities(): Promise<RiskAssessmentResult[]> {
  const localities = await query<{ id: string; name: string }>(
    `SELECT DISTINCT l.id, l.name
     FROM localities l
     JOIN environmental_reports r ON r.locality_id = l.id
     WHERE r.category = 'waste' AND r.submitted_at > now() - interval '7 days'`,
  );
  const results: RiskAssessmentResult[] = [];
  for (const locality of localities) {
    const reports = await query<{
      id: string;
      status: string;
      verification_state: string;
      evidence_count: number;
      distance_m: number;
      submitted_at: string;
      is_simulated: boolean;
    }>(
      `SELECT r.id, r.status, r.verification_state,
              (SELECT COUNT(*)::int FROM report_evidence e WHERE e.report_id = r.id) AS evidence_count,
              ST_Distance(r.location, l.location)::float8 AS distance_m,
              r.submitted_at, r.is_simulated
       FROM environmental_reports r
       JOIN localities l ON l.id = $1
       WHERE r.category = 'waste' AND r.submitted_at > now() - interval '7 days'
         AND ST_DWithin(r.location, l.location, 2000)`,
      [locality.id],
    );
    const incidents = await one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM environmental_incidents i
       JOIN localities l ON l.id = $1
       WHERE i.category = 'waste' AND i.status NOT IN ('RESOLVED','CLOSED')
         AND i.location IS NOT NULL AND ST_DWithin(i.location, l.location, 2000)`,
      [locality.id],
    );
    const result = assessWaste({
      localityId: locality.id,
      localityName: locality.name,
      reports7d: reports.map((r) => ({
        id: r.id,
        status: r.status,
        verificationState: r.verification_state,
        evidenceCount: Number(r.evidence_count),
        distanceM: Number(r.distance_m),
        submittedAt: r.submitted_at,
      })),
      criticalIncidents: incidents?.count ?? 0,
    });
    await persistRisk(result, reports.some((r) => r.is_simulated), null);
    results.push(result);
  }
  return results;
}

export async function evaluateAirStationsWithAlerts(): Promise<StationAssessment[]> {
  return evaluateAllStations();
}
