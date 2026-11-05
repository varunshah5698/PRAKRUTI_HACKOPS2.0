import { env } from '../config/env.js';
import { one, query } from '../db/pool.js';
import { getSourceStatuses } from './sources.js';
import { getStationSnapshots } from './station-data.js';
import { mlHealth } from './ml.js';
import { weatherIntegrity, weatherRecommendation } from './weather-status.js';
import { CATEGORY_LABELS, type Category } from '../types.js';

interface AlertRow {
  id: string;
  public_ref: string;
  category: string;
  level: string;
  state: string;
  trigger_type: string;
  title: string;
  summary: string;
  triggered_at: string;
  station_name: string | null;
  locality_name: string | null;
  is_simulated: boolean;
  source_id: string | null;
}

interface ReportRow {
  id: string;
  public_ref: string;
  category: string;
  incident_type: string;
  status: string;
  verification_state: string;
  submitted_at: string;
  locality_name: string | null;
  is_simulated: boolean;
}

interface IncidentRow {
  id: string;
  public_ref: string;
  category: string;
  title: string;
  status: string;
  risk_level: string;
  detected_at: string;
  locality_name: string | null;
  is_simulated: boolean;
}

function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function getDashboard() {
  const [snapshots, sources, mlStatus] = await Promise.all([getStationSnapshots(), getSourceStatuses(), mlHealth()]);
  const currentSnapshots = snapshots.filter((station) => !station.isStale);
  const staleStationCount = snapshots.length - currentSnapshots.length;

  const [
    activeStationRow,
    previousActiveRow,
    watchRow,
    previousWatchRow,
    predictiveRow,
    previousPredictiveRow,
    criticalIncidentRow,
    alerts,
    reports,
    incidents,
    latestRow,
    weatherRow,
    camsRows,
    pm25Series,
    pm10Series,
    dailySeries,
    incidentCategories,
    alertStates,
    windRows,
    latestReadings,
    categoriesRows,
  ] = await Promise.all([
    one<{ count: number; latest: string | null }>(
      `SELECT COUNT(DISTINCT station_id)::int AS count, MAX(observed_at) AS latest
       FROM environmental_observations WHERE station_id IS NOT NULL AND observed_at > now() - interval '6 hours'`,
    ),
    one<{ count: number }>(
      `SELECT COUNT(DISTINCT station_id)::int AS count FROM environmental_observations
       WHERE station_id IS NOT NULL AND observed_at BETWEEN now() - interval '30 hours' AND now() - interval '24 hours'`,
    ),
    one<{ count: number }>(
      `SELECT COUNT(DISTINCT locality_id)::int AS count FROM environmental_alerts
       WHERE state IN ('WATCH','EARLY_WARNING','CRITICAL') AND locality_id IS NOT NULL
         AND simulation_session_id IS NULL`,
    ),
    one<{ count: number }>(
      `SELECT COUNT(DISTINCT locality_id)::int AS count FROM environmental_alerts
       WHERE triggered_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'
         AND locality_id IS NOT NULL AND simulation_session_id IS NULL`,
    ),
    one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM environmental_alerts
       WHERE trigger_type='PREDICTIVE' AND state='EARLY_WARNING' AND simulation_session_id IS NULL`,
    ),
    one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM environmental_alerts
       WHERE trigger_type='PREDICTIVE' AND triggered_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours'
         AND simulation_session_id IS NULL`,
    ),
    one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM environmental_incidents
       WHERE risk_level='CRITICAL' AND status NOT IN ('RESOLVED','CLOSED') AND simulation_session_id IS NULL`,
    ),
    query<AlertRow>(
      `SELECT a.id, a.public_ref, a.category, a.level, a.state, a.trigger_type, a.title, a.summary,
              a.triggered_at, s.name AS station_name, l.name AS locality_name, a.is_simulated, a.source_id
       FROM environmental_alerts a
       LEFT JOIN monitoring_stations s ON s.id=a.station_id
       LEFT JOIN localities l ON l.id=a.locality_id
       WHERE a.state <> 'CLOSED' AND a.simulation_session_id IS NULL
       ORDER BY CASE a.state WHEN 'CRITICAL' THEN 0 WHEN 'EARLY_WARNING' THEN 1 WHEN 'WATCH' THEN 2 ELSE 3 END,
                a.triggered_at DESC LIMIT 8`,
    ),
    query<ReportRow>(
      `SELECT r.id, r.public_ref, r.category, r.incident_type, r.status, r.verification_state,
              r.submitted_at, l.name AS locality_name, r.is_simulated
       FROM environmental_reports r LEFT JOIN localities l ON l.id=r.locality_id
       ORDER BY r.submitted_at DESC LIMIT 6`,
    ),
    query<IncidentRow>(
      `SELECT i.id, i.public_ref, i.category, i.title, i.status, i.risk_level, i.detected_at,
              l.name AS locality_name, i.is_simulated
       FROM environmental_incidents i LEFT JOIN localities l ON l.id=i.locality_id
       WHERE i.status NOT IN ('CLOSED') AND i.simulation_session_id IS NULL
       ORDER BY i.detected_at DESC LIMIT 6`,
    ),
    one<{ latest: string | null }>('SELECT MAX(observed_at) AS latest FROM environmental_observations'),
    one<{
      observed_at: string;
      retrieved_at: string;
      source_id: string;
      temperature_c: number;
      relative_humidity: number;
      wind_speed_kmh: number;
      wind_direction_deg: number;
      precipitation_mm: number;
      is_simulated: boolean;
      latitude: number;
      longitude: number;
    }>(
      `SELECT observed_at, retrieved_at, source_id, temperature_c::float8, relative_humidity::float8,
              wind_speed_kmh::float8, wind_direction_deg::float8, precipitation_mm::float8, is_simulated,
              ST_Y(location::geometry)::float8 AS latitude, ST_X(location::geometry)::float8 AS longitude
       FROM weather_observations
       WHERE kind='OBSERVATION' AND (is_simulated=false OR $1)
       ORDER BY observed_at DESC LIMIT 1`,
      [env.DEMO_MODE],
    ),
    query<{ locality_id: string; locality_name: string; pollutant_code: string; value: number; unit: string; observed_at: string }>(
      `SELECT DISTINCT ON (o.locality_id, o.pollutant_code) o.locality_id, l.name AS locality_name,
              o.pollutant_code, o.value::float8 AS value, o.unit, o.observed_at
       FROM environmental_observations o JOIN localities l ON l.id=o.locality_id
       WHERE o.source_id='open-meteo-cams' AND o.quality_state='MODELLED'
       ORDER BY o.locality_id, o.pollutant_code, o.observed_at DESC`,
    ),
    query<{ bucket: string; value: number; samples: number; is_simulated: boolean }>(
      `SELECT to_char(date_trunc('hour', observed_at) AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:00') AS bucket,
              AVG(value)::float8 AS value, COUNT(*)::int AS samples, BOOL_AND(is_simulated) AS is_simulated
       FROM environmental_observations
       WHERE pollutant_code='pm25' AND station_id IS NOT NULL AND observed_at > now() - interval '48 hours'
       GROUP BY 1 ORDER BY 1`,
    ),
    query<{ bucket: string; value: number; samples: number; is_simulated: boolean }>(
      `SELECT to_char(date_trunc('hour', observed_at) AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:00') AS bucket,
              AVG(value)::float8 AS value, COUNT(*)::int AS samples, BOOL_AND(is_simulated) AS is_simulated
       FROM environmental_observations
       WHERE pollutant_code='pm10' AND station_id IS NOT NULL AND observed_at > now() - interval '48 hours'
       GROUP BY 1 ORDER BY 1`,
    ),
    query<{ day: string; value: number; samples: number }>(
      `SELECT to_char(date_trunc('day', observed_at) AT TIME ZONE 'Asia/Kolkata','DD Mon') AS day,
              AVG(value)::float8 AS value, COUNT(*)::int AS samples
       FROM environmental_observations
       WHERE pollutant_code='pm25' AND station_id IS NOT NULL AND observed_at > now() - interval '4 days'
       GROUP BY 1 ORDER BY MIN(observed_at)`,
    ),
    query<{ category: string; count: number }>(
      `SELECT category, COUNT(*)::int AS count FROM environmental_incidents WHERE simulation_session_id IS NULL GROUP BY category`,
    ),
    query<{ state: string; count: number }>(
      `SELECT state, COUNT(*)::int AS count FROM environmental_alerts WHERE simulation_session_id IS NULL GROUP BY state`,
    ),
    query<{ station_name: string; wind_speed_kmh: number; wind_direction_deg: number; observed_at: string; is_simulated: boolean }>(
      `SELECT DISTINCT ON (w.station_id) s.name AS station_name, w.wind_speed_kmh::float8,
              w.wind_direction_deg::float8, w.observed_at, w.is_simulated
       FROM weather_observations w JOIN monitoring_stations s ON s.id=w.station_id
       WHERE w.kind='OBSERVATION' ORDER BY w.station_id, w.observed_at DESC`,
    ),
    query<{
      station_name: string;
      pollutant_code: string;
      value: number;
      unit: string;
      observed_at: string;
      is_simulated: boolean;
      source_id: string;
    }>(
      `SELECT DISTINCT ON (o.station_id, o.pollutant_code) s.name AS station_name, o.pollutant_code,
              o.value::float8 AS value, o.unit, o.observed_at, o.is_simulated, o.source_id
       FROM environmental_observations o JOIN monitoring_stations s ON s.id=o.station_id
       WHERE o.observed_at > now() - interval '6 hours'
       ORDER BY o.station_id, o.pollutant_code, o.observed_at DESC`,
    ),
    query<{ category: string; stations: number; reports_7d: number; observations_24h: number; latest_update: string | null }>(
      `SELECT c.category,
              (SELECT COUNT(*)::int FROM monitoring_stations s WHERE
                 ((c.category='air' AND s.station_type='AIR_CAAQMS') OR
                  (c.category='water' AND s.station_type='WATER_SAMPLING') OR
                  (c.category='industrial' AND s.station_type='INDUSTRIAL_STACK'))
                 AND s.last_seen_at > now() - interval '6 hours') AS stations,
              (SELECT COUNT(*)::int FROM environmental_reports r WHERE r.category=c.category AND r.submitted_at > now() - interval '7 days') AS reports_7d,
              (SELECT COUNT(*)::int FROM environmental_observations o WHERE o.category=c.category AND o.station_id IS NOT NULL AND o.observed_at > now() - interval '24 hours') AS observations_24h,
              GREATEST(
                (SELECT MAX(o.observed_at) FROM environmental_observations o WHERE o.category=c.category),
                (SELECT MAX(r.submitted_at) FROM environmental_reports r WHERE r.category=c.category)
              ) AS latest_update
       FROM (VALUES ('air'),('water'),('waste'),('industrial')) AS c(category)`,
    ),
  ]);

  const latestByCategory = await query<{ category: string; count: number; critical: number; latest_alert: string | null }>(
    `SELECT category, COUNT(*)::int AS count,
            COUNT(*) FILTER (WHERE state='CRITICAL')::int AS critical,
            MAX(triggered_at) AS latest_alert
     FROM environmental_alerts WHERE state NOT IN ('CLOSED','RECOVERY') AND simulation_session_id IS NULL GROUP BY category`,
  );
  const alertByCategory = new Map(latestByCategory.map((r) => [r.category, r]));

  const categories = categoriesRows.map((row) => {
    const alertsForCategory = alertByCategory.get(row.category);
    const status =
      (alertsForCategory?.critical ?? 0) > 0
        ? 'CRITICAL'
        : (alertsForCategory?.count ?? 0) > 0
          ? 'WATCH'
          : 'NORMAL';
    return {
      category: row.category as Category,
      label: CATEGORY_LABELS[row.category as Category] ?? row.category,
      status,
      monitoringStations: Number(row.stations),
      activeAlerts: Number(alertsForCategory?.count ?? 0),
      criticalAlerts: Number(alertsForCategory?.critical ?? 0),
      reports7d: Number(row.reports_7d),
      observations24h: Number(row.observations_24h),
      latestUpdate: row.latest_update,
      latestAlert: alertsForCategory?.latest_alert ?? null,
      coverageNote:
        row.category === 'waste'
          ? 'No waste monitoring stations. This category is report and evidence based.'
          : Number(row.stations) === 0
            ? 'No monitoring stations configured for this category.'
            : null,
    };
  });

  const airSnapshots = currentSnapshots.filter((s) => s.stationType === 'AIR_CAAQMS');
  const aqiBuckets = ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe'];
  const aqiDistribution = aqiBuckets.map((bucket) => ({
    bucket,
    count: airSnapshots.filter((s) => s.aqi?.category === bucket).length,
  }));

  const thresholds: Record<string, { value: number; unit: string; averaging: string }> = {
    pm25: { value: 60, unit: 'µg/m³', averaging: '24h NAAQS' },
    pm10: { value: 100, unit: 'µg/m³', averaging: '24h NAAQS' },
    no2: { value: 80, unit: 'µg/m³', averaging: '24h NAAQS' },
    so2: { value: 80, unit: 'µg/m³', averaging: '24h NAAQS' },
    co: { value: 2, unit: 'mg/m³', averaging: '8h NAAQS' },
    o3: { value: 100, unit: 'µg/m³', averaging: '8h NAAQS' },
  };
  const pollutantTotals = new Map<string, {
    sum: number;
    count: number;
    unit: string;
    lowest: number;
    lowestStation: string;
    peak: number;
    peakStation: string;
  }>();
  for (const station of airSnapshots) {
    const stationName = station.name.replace(' demo air monitor', '');
    for (const [code, reading] of Object.entries(station.values)) {
      const spec = thresholds[code];
      if (!spec || reading.unit !== spec.unit) continue;
      const existing = pollutantTotals.get(code) ?? {
        sum: 0,
        count: 0,
        unit: reading.unit,
        lowest: reading.value,
        lowestStation: stationName,
        peak: reading.value,
        peakStation: stationName,
      };
      existing.sum += reading.value;
      existing.count += 1;
      if (reading.value < existing.lowest) {
        existing.lowest = reading.value;
        existing.lowestStation = stationName;
      }
      if (reading.value > existing.peak) {
        existing.peak = reading.value;
        existing.peakStation = stationName;
      }
      pollutantTotals.set(code, existing);
    }
  }
  const pollutantComparison = [...pollutantTotals.entries()].map(([code, total]) => ({
    pollutant: code.toUpperCase(),
    value: Number((total.sum / total.count).toFixed(1)),
    unit: total.unit,
    threshold: thresholds[code]?.value ?? null,
    thresholdUnit: thresholds[code]?.unit ?? null,
    averaging: thresholds[code]?.averaging ?? null,
    stations: total.count,
    lowest: Number(total.lowest.toFixed(1)),
    lowestStation: total.lowestStation,
    peak: Number(total.peak.toFixed(1)),
    peakStation: total.peakStation,
    note: 'Average of latest station values. Indicative only; compare only with matching averaging periods.',
  }));

  const camsMap = new Map<string, { localityId: string; localityName: string; pm25: number | null; pm10: number | null; observedAt: string }>();
  for (const row of camsRows) {
    const existing = camsMap.get(row.locality_id) ?? {
      localityId: row.locality_id,
      localityName: row.locality_name,
      pm25: null,
      pm10: null,
      observedAt: row.observed_at,
    };
    if (row.pollutant_code === 'pm25') existing.pm25 = Number(row.value);
    if (row.pollutant_code === 'pm10') existing.pm10 = Number(row.value);
    camsMap.set(row.locality_id, existing);
  }

  const simulatedStationCount = currentSnapshots.filter((station) => station.isSimulated).length;
  const connectedStationCount = currentSnapshots.length - simulatedStationCount;
  const weatherCheck = weatherRow
    ? weatherIntegrity({
        observedAt: weatherRow.observed_at,
        fetchedAt: weatherRow.retrieved_at,
        sourceId: weatherRow.source_id,
        isSimulated: weatherRow.is_simulated,
        demoMode: env.DEMO_MODE,
        latitude: weatherRow.latitude,
        longitude: weatherRow.longitude,
        temperatureC: weatherRow.temperature_c,
        relativeHumidity: weatherRow.relative_humidity,
        precipitationMm: weatherRow.precipitation_mm,
        windSpeedKmh: weatherRow.wind_speed_kmh,
      })
    : null;
  const weatherStatus = weatherCheck?.status ?? 'UNAVAILABLE';
  const weatherCondition =
    weatherRow && weatherRow.precipitation_mm > 0
      ? 'Rain'
      : weatherRow && weatherRow.temperature_c >= 40
        ? 'Heat'
        : weatherRow && weatherRow.wind_speed_kmh >= 60
          ? 'Wind'
          : '';
  const stationDataMode = connectedStationCount > 0 && simulatedStationCount > 0 ? 'MIXED' : connectedStationCount > 0 ? 'LIVE_SOURCE' : 'SIMULATION';
  const activeStations = Number(activeStationRow?.count ?? 0);
  const previousActive = Number(previousActiveRow?.count ?? 0);
  const watchLocations = Number(watchRow?.count ?? 0);
  const previousWatch = Number(previousWatchRow?.count ?? 0);
  const predictiveWarnings = Number(predictiveRow?.count ?? 0);
  const previousPredictive = Number(previousPredictiveRow?.count ?? 0);

  return {
    generatedAt: new Date().toISOString(),
    demoMode: env.DEMO_MODE,
    dataMode: {
      stationObservations: stationDataMode,
      simulatedStations: simulatedStationCount,
      connectedSourceStations: connectedStationCount,
      staleStationsExcluded: staleStationCount,
      weather: weatherStatus,
      cams: 'MODELLED_CAMS',
      cpcb: env.DATA_GOV_IN_API_KEY ? 'CONFIGURED' : 'NOT_CONFIGURED',
      forecasts: mlStatus.status === 'TRAINED' ? 'LIGHTGBM_TRAINED_AVAILABLE' : 'PERSISTENCE_BASELINE',
    },
    kpis: {
      activeStations: {
        value: activeStations,
        previous: previousActive,
        trendPct: percentChange(activeStations, previousActive),
        window: 'Observed in the last 6 hours',
        dataTimestamp: activeStationRow?.latest ?? null,
        href: '/map',
        note:
          connectedStationCount > 0
            ? `${connectedStationCount} connected-source station(s) and ${simulatedStationCount} simulation-labelled demo station(s) reporting within 6 hours. ${staleStationCount} stale station(s) excluded from current totals.`
            : `All current stations are simulation-labelled demo stations. ${staleStationCount} stale station(s) excluded. No CPCB station is connected.`,
      },
      locationsUnderWatch: {
        value: watchLocations,
        previous: previousWatch,
        trendPct: percentChange(watchLocations, previousWatch),
        window: 'Active WATCH / EARLY WARNING / CRITICAL alerts',
        dataTimestamp: latestRow?.latest ?? null,
        href: '/alerts',
        note: 'A location may have more than one category alert.',
      },
      predictiveWarnings: {
        value: predictiveWarnings,
        previous: previousPredictive,
        trendPct: percentChange(predictiveWarnings, previousPredictive),
        window: 'Active analytical early warnings',
        dataTimestamp: latestRow?.latest ?? null,
        href: '/intelligence/predictions',
        note:
          mlStatus.status === 'TRAINED'
            ? 'LightGBM models are trained for OpenAQ stations with sufficient hourly history. Other stations use the labelled persistence baseline.'
            : 'Persistence baseline only. The trained ML service is not reachable.',
      },
      criticalIncidents: {
        value: Number(criticalIncidentRow?.count ?? 0),
        previous: null,
        trendPct: null,
        window: 'Open incidents with critical risk',
        dataTimestamp: latestRow?.latest ?? null,
        href: '/incidents',
        note: 'Simulation-labelled demonstration incidents.',
      },
    },
    categories,
    stations: currentSnapshots,
    staleStationCount,
    mapStations: airSnapshots.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      locality: s.localityName,
      lat: s.lat,
      lng: s.lng,
      aqi: s.aqi?.aqi ?? null,
      aqiCategory: s.aqi?.category ?? 'INSUFFICIENT DATA',
      pm25: s.values.pm25?.value ?? null,
      pm10: s.values.pm10?.value ?? null,
      isSimulated: s.isSimulated,
      isStale: s.isStale,
      healthStatus: s.healthStatus,
      latestObservedAt: s.latestObservedAt,
    })),
    alerts,
    reports,
    incidents,
    sources,
    weather: weatherRow
      ? {
          ...weatherRow,
          status: weatherStatus,
          provider: weatherCheck?.provider ?? null,
          dataSourceType: weatherCheck?.dataSourceType ?? null,
          fetchedAt: weatherCheck?.fetchedAt ?? null,
          observationTime: weatherCheck?.observationTime ?? null,
          forecastTime: weatherCheck?.forecastTime ?? null,
          isLive: weatherCheck?.isLive ?? false,
          freshnessStatus: weatherCheck?.freshnessStatus ?? 'UNAVAILABLE',
          validationStatus: weatherCheck?.validationStatus ?? 'INVALID',
          recommendation: weatherRecommendation(weatherCondition),
          note:
            weatherStatus === 'LIVE'
              ? `Verified ${weatherCheck?.dataSourceType === 'HOURLY_FORECAST' ? 'hourly forecast' : 'current conditions'} from ${weatherCheck?.provider}. Weather is context, not evidence of causation.`
              : weatherStatus === 'STALE'
                ? `Last verified reading from ${weatherCheck?.provider} is stale. It is retained with its original timestamp.`
                : `No verified live weather reading is available from the configured providers.`,
        }
      : null,
    cams: [...camsMap.values()],
    latestReadings,
    charts: {
      aqiDistribution,
      pm25Series,
      pm10Series,
      pollutantComparison,
      stationComparison: airSnapshots.map((s) => ({
        id: s.id,
        station: s.name.replace(' demo air monitor', ''),
        locality: s.localityName,
        provider: s.provider,
        aqi: s.aqi?.aqi ?? null,
        aqiCategory: s.aqi?.category ?? 'INSUFFICIENT DATA',
        pm25: s.values.pm25?.value ?? null,
        pm10: s.values.pm10?.value ?? null,
        isSimulated: s.isSimulated,
        latestObservedAt: s.latestObservedAt,
      })),
      dailyTrend: dailySeries,
      incidentCategories,
      alertStates,
      wind: windRows,
    },
    latestUpdate: latestRow?.latest ?? null,
    aqiMethod: {
      method: 'CPCB sub-index breakpoints applied to available hourly demo values',
      caveat:
        'Indicative only. Official CPCB AQI requires specified averaging periods (mostly 24h). These are not official AQI values.',
    },
  };
}
