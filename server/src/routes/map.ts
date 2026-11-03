import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { getMapTimeline, getStationDetail } from '../services/map.js';
import { getStationSnapshots } from '../services/station-data.js';
import { getSourceStatuses } from '../services/sources.js';
import { baselineForecast } from '../services/forecast.js';
import { getStationSeries } from '../services/station-data.js';

export const mapRouter = Router();
mapRouter.use(requireAuth);

const timelineSchema = z.object({
  at: z.string().datetime({ offset: true }).optional(),
  category: z.enum(['air', 'water', 'waste', 'industrial']).default('air'),
  pollutant: z.string().max(30).optional(),
  localityId: z.string().uuid().optional(),
  sourceId: z.string().max(60).optional(),
  severity: z.string().max(40).optional(),
  verification: z.string().max(40).optional(),
  includeForecast: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v !== false && v !== 'false'),
});

mapRouter.get('/timeline', async (req, res, next) => {
  try {
    const parsed = timelineSchema.parse(req.query);
    const result = await getMapTimeline({
      at: parsed.at ?? new Date().toISOString(),
      category: parsed.category,
      pollutant: parsed.pollutant ?? null,
      localityId: parsed.localityId ?? null,
      sourceId: parsed.sourceId ?? null,
      severity: parsed.severity ?? null,
      verification: parsed.verification ?? null,
      includeForecast: parsed.includeForecast ?? true,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

mapRouter.get('/localities', async (_req, res, next) => {
  try {
    const rows = await query<Record<string, unknown>>(
      'SELECT id, name, lat::float8, lng::float8 FROM localities ORDER BY name',
    );
    res.json({ localities: rows });
  } catch (error) {
    next(error);
  }
});

mapRouter.get('/layers', async (_req, res, next) => {
  try {
    const [sources, modelStatus] = await Promise.all([
      getSourceStatuses(),
      query<Record<string, unknown>>('SELECT name, version, status, horizon_hours, notes FROM model_registry ORDER BY name'),
    ]);
    res.json({
      categories: [
        { id: 'air', label: 'Air pollution', monitoring: '10 demo air monitors', forecast: 'Persistence baseline only' },
        { id: 'water', label: 'Water pollution', monitoring: '3 demo water sampling points', forecast: 'No forecast' },
        { id: 'waste', label: 'Unsafe waste disposal', monitoring: 'No monitoring stations; report evidence', forecast: 'No forecast' },
        { id: 'industrial', label: 'Industrial emissions', monitoring: '2 demo stack monitors', forecast: 'No forecast' },
      ],
      markerKinds: {
        OBSERVED: 'Filled marker with measured value and source timestamp',
        PREDICTED: 'Hollow/dashed marker from a forecast record',
        REPORTED: 'Citizen report icon with verification state',
        INCIDENT: 'Official incident marker with workflow status',
      },
      estimatedZones: {
        available: false,
        reason:
          'No interpolated surface is produced. The station network is sparse and demo observations are synthetic; a point measurement cannot establish concentration across an area.',
      },
      sources: sources.filter((s) => ['demo-network', 'open-meteo-weather', 'open-meteo-cams', 'cpcb-caaqms'].includes(s.id)),
      modelStatus,
      attribution: 'OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors (ODbL)',
    });
  } catch (error) {
    next(error);
  }
});

mapRouter.get('/stations', async (req, res, next) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const snapshots = await getStationSnapshots(category);
    res.json({ stations: snapshots });
  } catch (error) {
    next(error);
  }
});

mapRouter.get('/stations/:id', async (req, res, next) => {
  try {
    const detail = await getStationDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Station not found.' } });
      return;
    }
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

mapRouter.get('/stations/:id/observations', async (req, res, next) => {
  try {
    const pollutant = typeof req.query.pollutant === 'string' ? req.query.pollutant : 'pm25';
    const hours = Math.min(168, Math.max(1, Number(req.query.hours ?? 48)));
    const rows = await getStationSeries(req.params.id, pollutant, hours);
    res.json({
      stationId: req.params.id,
      pollutant,
      unit: rows[0]?.unit ?? null,
      hours,
      observations: rows.map((r) => ({
        observedAt: r.observed_at,
        value: Number(r.value),
        qualityState: r.quality_state,
        isSimulated: r.is_simulated,
      })),
      note: 'Stored observations only. Missing periods are not filled.',
    });
  } catch (error) {
    next(error);
  }
});

mapRouter.get('/stations/:id/forecasts', async (req, res, next) => {
  try {
    const detail = await getStationDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Station not found.' } });
      return;
    }
    const history = detail.series.map((s) => ({ observedAt: s.observed_at, value: Number(s.value) }));
    const forecasts = [1, 3, 6].map((horizon) => baselineForecast(history, horizon)).filter(Boolean);
    res.json({
      stationId: req.params.id,
      modelStatus: detail.forecastStatus,
      forecasts,
      predictions: [],
      note:
        'No trained LightGBM forecast is available. These records are PERSISTENCE_BASELINE_V1 with empirical bands and NOT_CALIBRATED confidence.',
    });
  } catch (error) {
    next(error);
  }
});
