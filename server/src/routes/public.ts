import { Router } from 'express';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { getSourceStatuses } from '../services/sources.js';
import { getStationSnapshots } from '../services/station-data.js';
import { getDashboard } from '../services/dashboard.js';
import { weatherIntegrity, weatherRecommendation } from '../services/weather-status.js';
import { getWeatherWatchdogState } from '../services/weather-watchdog.js';
import { liveStatus } from '../services/live.js';
import { getRainRadar } from '../services/city.js';

export const publicRouter = Router();

publicRouter.get('/overview', async (_req, res, next) => {
  try {
    const [snapshots, sources, alertCounts, reportCounts, latest, weather] = await Promise.all([
      getStationSnapshots('air'),
      getSourceStatuses(),
      query<{ category: string; count: number }>(
        `SELECT category, COUNT(*)::int AS count FROM environmental_alerts
         WHERE state NOT IN ('CLOSED','RECOVERY') AND simulation_session_id IS NULL GROUP BY category`,
      ),
      query<{ category: string; count: number }>(
        `SELECT category, COUNT(*)::int AS count FROM environmental_reports
         WHERE submitted_at > now() - interval '7 days' GROUP BY category`,
      ),
      query<{ latest: string | null }>('SELECT MAX(observed_at) AS latest FROM environmental_observations'),
      query<{
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
    ]);
    const currentSnapshots = snapshots.filter((station) => !station.isStale);
    const staleStationCount = snapshots.length - currentSnapshots.length;
    const simulatedStationCount = currentSnapshots.filter((station) => station.isSimulated).length;
    const connectedStationCount = currentSnapshots.length - simulatedStationCount;
    const weatherRow = weather[0] ?? null;
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
    res.json({
      demoMode: env.DEMO_MODE,
      stationDataMode: connectedStationCount > 0 && simulatedStationCount > 0 ? 'MIXED' : connectedStationCount > 0 ? 'LIVE_SOURCE' : 'SIMULATION',
      stationCounts: { simulated: simulatedStationCount, connectedSource: connectedStationCount },
      staleStationCount,
      stations: currentSnapshots.map((s) => ({
        id: s.id,
        name: s.name,
        locality: s.localityName,
        lat: s.lat,
        lng: s.lng,
        aqi: s.aqi?.aqi ?? null,
        aqiCategory: s.aqi?.category ?? 'INSUFFICIENT DATA',
        pm25: s.values.pm25?.value ?? null,
        isSimulated: s.isSimulated,
        latestObservedAt: s.latestObservedAt,
      })),
      alertCounts,
      reportCounts,
      latestObservationAt: latest[0]?.latest ?? null,
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
            recommendation: weatherRecommendation(weatherRow.precipitation_mm > 0 ? 'Rain' : ''),
          }
        : null,
      sources: sources
        .filter((s) => ['open-meteo-weather', 'open-meteo-cams', 'cpcb-caaqms', 'data-gov-in-air', 'openaq', 'river-ai', 'ml-service', 'demo-network'].includes(s.id))
        .map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          lastSuccessAt: s.lastSuccessAt,
          attribution: s.attribution,
          notes: s.notes,
          isSimulated: s.id === 'demo-network',
        })),
      map: {
        styleUrl: env.MAP_STYLE_URL,
        tileProvider: env.MAP_TILE_PROVIDER,
        boundaryUrl: '/geo/mumbai-boundary.geojson',
        attribution: 'OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors (ODbL)',
      },
      labels: {
        observations: 'SIMULATION DATA — demo stations, not CPCB readings',
        weather: `Weather status: ${weatherStatus}${weatherCheck?.provider ? ` · ${weatherCheck.provider}` : ''}`,
        staleStations: `${staleStationCount} stale station(s) excluded from the current map and counts.`,
      },
    });
  } catch (error) {
    next(error);
  }
});

publicRouter.get('/status', async (_req, res, next) => {
  try {
    const [sources, weatherRows, airRows] = await Promise.all([
      getSourceStatuses(),
      query<{
        observed_at: string;
        retrieved_at: string;
        source_id: string;
        temperature_c: number | null;
        relative_humidity: number | null;
        wind_speed_kmh: number | null;
        precipitation_mm: number | null;
        is_simulated: boolean;
        latitude: number;
        longitude: number;
      }>(
        `SELECT observed_at, retrieved_at, source_id, temperature_c::float8, relative_humidity::float8,
                wind_speed_kmh::float8, precipitation_mm::float8, is_simulated,
                ST_Y(location::geometry)::float8 AS latitude, ST_X(location::geometry)::float8 AS longitude
         FROM weather_observations
         WHERE kind='OBSERVATION' AND (is_simulated=false OR $1)
         ORDER BY observed_at DESC LIMIT 1`,
        [env.DEMO_MODE],
      ),
      query<{ observed_at: string; source_id: string }>(
        `SELECT observed_at, source_id FROM environmental_observations
         WHERE quality_state <> 'INVALID' AND (is_simulated=false OR $1)
         ORDER BY observed_at DESC LIMIT 1`,
        [env.DEMO_MODE],
      ),
    ]);

    const weatherRow = weatherRows[0] ?? null;
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
    const airRow = airRows[0] ?? null;
    const airAgeSeconds = airRow ? Math.max(0, Math.round((Date.now() - Date.parse(airRow.observed_at)) / 1000)) : null;
    const airStatus = airAgeSeconds === null ? 'UNAVAILABLE' : airAgeSeconds <= 3 * 3600 ? 'LIVE' : airAgeSeconds <= 24 * 3600 ? 'STALE' : 'UNAVAILABLE';

    const feedIds = new Set([
      'open-meteo-weather',
      'met-no-weather',
      'open-meteo-cams',
      'openaq',
      'data-gov-in-air',
      'cpcb-caaqms',
      'rainviewer-radar',
    ]);
    const feeds = sources
      .filter((source) => feedIds.has(source.id))
      .map((source) => ({
        id: source.id,
        name: source.name,
        provider: source.provider,
        status: source.status,
        lastAttemptAt: source.lastAttemptAt ?? null,
        lastSuccessAt: source.lastSuccessAt ?? null,
        errorMessage: source.errorMessage ?? null,
        attribution: source.attribution ?? null,
        notes: source.notes ?? null,
      }));
    const criticalFeedFailed = feeds.some(
      (feed) => ['open-meteo-weather', 'met-no-weather', 'open-meteo-cams', 'openaq'].includes(feed.id) && feed.status === 'FAILED',
    );
    const overall =
      weatherCheck?.status === 'UNAVAILABLE' || airStatus === 'UNAVAILABLE'
        ? 'OUTAGE'
        : weatherCheck?.status !== 'LIVE' || airStatus !== 'LIVE' || criticalFeedFailed
          ? 'DEGRADED'
          : 'OK';

    res.json({
      generatedAt: new Date().toISOString(),
      demoMode: env.DEMO_MODE,
      overall,
      weather: weatherRow
        ? {
            status: weatherCheck?.status ?? 'UNAVAILABLE',
            provider: weatherCheck?.provider ?? null,
            dataSourceType: weatherCheck?.dataSourceType ?? null,
            sourceId: weatherRow.source_id,
            observedAt: weatherCheck?.observationTime ?? weatherRow.observed_at,
            fetchedAt: weatherCheck?.fetchedAt ?? null,
            ageSeconds: weatherCheck?.observationTime
              ? Math.max(0, Math.round((Date.now() - Date.parse(weatherCheck.observationTime)) / 1000))
              : null,
            temperatureC: weatherRow.temperature_c,
            isLive: weatherCheck?.isLive ?? false,
          }
        : null,
      air: airRow
        ? {
            status: airStatus,
            sourceId: airRow.source_id,
            observedAt: airRow.observed_at,
            ageSeconds: airAgeSeconds,
          }
        : { status: 'UNAVAILABLE', sourceId: null, observedAt: null, ageSeconds: null },
      feeds,
      watchdog: getWeatherWatchdogState(),
      live: liveStatus(),
    });
  } catch (error) {
    next(error);
  }
});

publicRouter.get('/radar', async (_req, res, next) => {
  try {
    res.json(await getRainRadar());
  } catch (error) {
    next(error);
  }
});

publicRouter.get('/localities', async (_req, res, next) => {
  try {
    const rows = await query<{ id: string; name: string; lat: number; lng: number }>(
      'SELECT id, name, lat::float8, lng::float8 FROM localities ORDER BY name',
    );
    res.json({ localities: rows });
  } catch (error) {
    next(error);
  }
});

publicRouter.get('/dashboard-preview', async (_req, res, next) => {
  try {
    const dashboard = await getDashboard();
    res.json({
      demoMode: dashboard.demoMode,
      kpis: dashboard.kpis,
      categories: dashboard.categories,
      alerts: dashboard.alerts.slice(0, 4),
      mapStations: dashboard.mapStations,
      dataMode: dashboard.dataMode,
      generatedAt: dashboard.generatedAt,
    });
  } catch (error) {
    next(error);
  }
});
