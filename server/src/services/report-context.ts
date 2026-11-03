import { query } from '../db/pool.js';

/** Nearby evidence used by both the report detail page and the AI analyst. */
export async function enrichReport(reportId: string) {
  const stations = await query<Record<string, unknown>>(
    `SELECT s.id, s.code, s.name, s.station_type, s.health_status, s.is_simulated,
            ST_Y(s.location::geometry)::float8 AS lat, ST_X(s.location::geometry)::float8 AS lng,
            ST_Distance(s.location, r.location)::float8 AS distance_m,
            (SELECT jsonb_object_agg(pollutant_code, jsonb_build_object('value', value::float8, 'unit', unit, 'observedAt', observed_at, 'sourceId', source_id, 'isSimulated', is_simulated))
             FROM (SELECT DISTINCT ON (pollutant_code) * FROM environmental_observations o
                   WHERE o.station_id=s.id AND o.observed_at > now() - interval '24 hours'
                   ORDER BY pollutant_code, observed_at DESC) latest) AS latest_readings
     FROM environmental_reports r
     JOIN monitoring_stations s ON ST_DWithin(s.location, r.location, 3000)
     WHERE r.id=$1 ORDER BY distance_m LIMIT 10`,
    [reportId],
  );
  const weather = await query<Record<string, unknown>>(
    `SELECT w.observed_at, w.temperature_c::float8, w.relative_humidity::float8, w.wind_speed_kmh::float8,
            w.wind_direction_deg::float8, w.precipitation_mm::float8, w.is_simulated, w.source_id,
            ST_Distance(w.location, r.location)::float8 AS distance_m
     FROM environmental_reports r
     JOIN weather_observations w ON ST_DWithin(w.location, r.location, 5000) AND w.kind='OBSERVATION'
     WHERE r.id=$1 ORDER BY w.observed_at DESC, distance_m LIMIT 1`,
    [reportId],
  );
  const nearbyReports = await query<Record<string, unknown>>(
    `SELECT r2.id, r2.public_ref, r2.category, r2.incident_type, r2.status, r2.verification_state, r2.submitted_at,
            ST_Y(r2.location::geometry)::float8 AS lat, ST_X(r2.location::geometry)::float8 AS lng,
            ST_Distance(r2.location, r1.location)::float8 AS distance_m, r2.is_simulated
     FROM environmental_reports r1 JOIN environmental_reports r2 ON r2.id <> r1.id
     WHERE r1.id=$1 AND ST_DWithin(r2.location, r1.location, 500)
     ORDER BY distance_m LIMIT 8`,
    [reportId],
  );
  const alerts = await query<Record<string, unknown>>(
    `SELECT a.id, a.public_ref, a.category, a.level, a.state, a.trigger_type, a.title, a.triggered_at, a.is_simulated
     FROM environmental_reports r JOIN environmental_alerts a ON a.category=r.category AND a.state NOT IN ('CLOSED','RECOVERY')
     WHERE r.id=$1 AND a.simulation_session_id IS NULL AND (a.locality_id = r.locality_id OR (a.station_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM monitoring_stations s WHERE s.id=a.station_id AND ST_DWithin(s.location, r.location, 3000))))
     ORDER BY a.triggered_at DESC LIMIT 5`,
    [reportId],
  );
  const incidents = await query<Record<string, unknown>>(
    `SELECT i.id, i.public_ref, i.category, i.title, i.status, i.risk_level, i.detected_at,
            ST_Distance(i.location, r.location)::float8 AS distance_m, i.is_simulated
     FROM environmental_reports r JOIN environmental_incidents i ON i.category=r.category AND i.location IS NOT NULL
     WHERE r.id=$1 AND i.simulation_session_id IS NULL AND ST_DWithin(i.location, r.location, 3000)
     ORDER BY i.detected_at DESC LIMIT 5`,
    [reportId],
  );
  return { stations, weather: weather[0] ?? null, nearbyReports, alerts, incidents };
}
