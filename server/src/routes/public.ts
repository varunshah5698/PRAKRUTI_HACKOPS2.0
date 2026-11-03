import { Router } from 'express';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { getSourceStatuses } from '../services/sources.js';
import { getStationSnapshots } from '../services/station-data.js';
import { getDashboard } from '../services/dashboard.js';

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
      query<{ observed_at: string; temperature_c: number; relative_humidity: number; wind_speed_kmh: number; wind_direction_deg: number }>(
        `SELECT observed_at, temperature_c::float8, relative_humidity::float8, wind_speed_kmh::float8, wind_direction_deg::float8
         FROM weather_observations WHERE kind='OBSERVATION' ORDER BY observed_at DESC LIMIT 1`,
      ),
    ]);
    res.json({
      demoMode: env.DEMO_MODE,
      stations: snapshots.map((s) => ({
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
      weather: weather[0] ?? null,
      sources: sources
        .filter((s) => ['open-meteo-weather', 'open-meteo-cams', 'cpcb-caaqms', 'river-ai', 'ml-service', 'demo-network'].includes(s.id))
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
        weather: 'Live Open-Meteo observation',
      },
    });
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
