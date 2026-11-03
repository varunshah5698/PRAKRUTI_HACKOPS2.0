import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { getStationSnapshots, getStationSeries } from '../services/station-data.js';
import { baselineForecast, anomalyScore } from '../services/forecast.js';

export const predictionsRouter = Router();
predictionsRouter.use(requireAuth);

async function stationPrediction(stationId: string) {
  const snapshots = await getStationSnapshots('air');
  const station = snapshots.find((s) => s.id === stationId);
  if (!station) return null;
  const series = await getStationSeries(stationId, 'pm25', 48);
  const history = series.map((s) => ({ observedAt: s.observed_at, value: Number(s.value) }));
  const forecasts = [1, 3, 6]
    .map((horizon) => baselineForecast(history, horizon))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));
  const anomaly = anomalyScore(history);
  const threshold = 60;
  const criteria = {
    threshold,
    unit: 'µg/m³',
    averaging: '24h NAAQS screening threshold',
    current: station.values.pm25?.value ?? null,
    forecast3h: forecasts.find((f) => f.horizonHours === 3)?.predictedValue ?? null,
    persistence: history.slice(-6).filter((h) => h.value >= threshold * 0.8).length,
    predictiveWarningMet: Boolean(
      forecasts.find((f) => f.horizonHours === 3 && f.predictedValue >= threshold) &&
        history.slice(-6).filter((h) => h.value >= threshold * 0.8).length >= 3,
    ),
    deteriorationProbability: null,
    note:
      'No calibrated deterioration classifier is trained, so no probability is shown. Warning criteria use the labelled persistence baseline and are analytical, not ML.',
  };
  const latestRisk = await query<Record<string, unknown>>(
    `SELECT risk_score::float8, risk_level, confidence_score::float8, confidence_level, alert_state, method, calculated_at
     FROM risk_assessments WHERE entity_type='station' AND entity_id=$1 ORDER BY calculated_at DESC LIMIT 1`,
    [stationId],
  );
  return {
    station,
    current: station.values.pm25 ?? null,
    forecasts,
    history: history.map((h) => ({ observedAt: h.observedAt, value: h.value })),
    anomaly,
    criteria,
    risk: latestRisk[0] ?? null,
    modelStatus: 'NOT_TRAINED',
    method: 'PERSISTENCE_BASELINE_V1',
    intervals: 'EMPIRICAL_80_PERCENT_BAND_NOT_CALIBRATED',
    shap: 'UNAVAILABLE — no trained model',
    forecastPerformance: {
      status: 'INSUFFICIENT_DATA',
      reason: 'No archived forecasts paired with subsequent observations exist yet.',
    },
  };
}

predictionsRouter.get('/', async (req, res, next) => {
  try {
    const snapshots = await getStationSnapshots('air');
    const selected = typeof req.query.stationId === 'string' ? req.query.stationId : snapshots[0]?.id;
    const detail = selected ? await stationPrediction(selected) : null;
    const models = await query<Record<string, unknown>>(
      `SELECT id, name, version, category, target, horizon_hours, model_type, status, metrics, trained_at, notes
       FROM model_registry ORDER BY status, name, version`,
    );
    const cams = await query<Record<string, unknown>>(
      `SELECT DISTINCT ON (o.locality_id, o.pollutant_code) o.locality_id, l.name AS locality_name,
              o.pollutant_code, o.value::float8 AS value, o.unit, o.observed_at
       FROM environmental_observations o JOIN localities l ON l.id=o.locality_id
       WHERE o.source_id='open-meteo-cams' ORDER BY o.locality_id, o.pollutant_code, o.observed_at DESC`,
    );
    res.json({
      detail,
      stations: snapshots.map((s) => ({
        id: s.id,
        name: s.name,
        locality: s.localityName,
        pm25: s.values.pm25?.value ?? null,
        aqi: s.aqi?.aqi ?? null,
        isSimulated: s.isSimulated,
      })),
      models,
      externalContext: {
        cams: cams.map((row) => ({ ...row, note: 'CAMS modelled value, not a station measurement.' })),
      },
      status: {
        trainedModels: 'NOT_TRAINED',
        reason: 'No verified Mumbai historical training extract has been supplied.',
        available: 'PERSISTENCE_BASELINE_V1',
        shap: 'UNAVAILABLE',
        quantileIntervals: 'NOT_AVAILABLE',
        deteriorationClassifier: 'NOT_TRAINED',
        anomalyDetector: 'ZSCORE_V1 analytical check only',
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

predictionsRouter.get('/models', async (_req, res, next) => {
  try {
    const models = await query<Record<string, unknown>>('SELECT * FROM model_registry ORDER BY name, version');
    res.json({ models });
  } catch (error) {
    next(error);
  }
});

predictionsRouter.get('/:stationId', async (req, res, next) => {
  try {
    const detail = await stationPrediction(req.params.stationId);
    if (!detail) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Station not found.' } });
      return;
    }
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

export const risksRouter = Router();
risksRouter.use(requireAuth);
risksRouter.get('/', async (req, res, next) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : null;
    const rows = await query<Record<string, unknown>>(
      `SELECT DISTINCT ON (entity_type, entity_id) id, category, entity_type, entity_id, risk_score::float8,
              risk_level, confidence_score::float8, confidence_level, alert_state, method, supporting_evidence,
              missing_inputs, calculated_at, ruleset_version, is_simulated
       FROM risk_assessments
       WHERE ($1::text IS NULL OR category=$1)
       ORDER BY entity_type, entity_id, calculated_at DESC`,
      [category],
    );
    res.json({ assessments: rows, note: 'Risk is category-specific; confidence is separate from severity.' });
  } catch (error) {
    next(error);
  }
});
