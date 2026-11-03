import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { getStationSnapshots, getStationSeries, getLatestWeather } from '../services/station-data.js';
import { anomalyScore } from '../services/forecast.js';
import { getForecastsForStation } from '../services/forecast-service.js';
import { mlConfigured, mlHealth } from '../services/ml.js';

export const predictionsRouter = Router();
predictionsRouter.use(requireAuth);

async function stationPrediction(stationId: string) {
  const snapshots = await getStationSnapshots('air');
  const station = snapshots.find((s) => s.id === stationId);
  if (!station) return null;
  const series = await getStationSeries(stationId, 'pm25', 48);
  const history = series.map((s) => ({ observedAt: s.observed_at, value: Number(s.value) }));
  const weather = await getLatestWeather(stationId);
  const latest = Object.fromEntries(Object.entries(station.values).map(([code, reading]) => [code, reading.value]));
  const bundle = await getForecastsForStation({
    stationId,
    history,
    latest,
    weather: weather[0]
      ? {
          temperature: weather[0].temperature_c === null ? null : Number(weather[0].temperature_c),
          humidity: weather[0].relative_humidity === null ? null : Number(weather[0].relative_humidity),
          windSpeed: weather[0].wind_speed_kmh === null ? null : Number(weather[0].wind_speed_kmh),
          windDirection: weather[0].wind_direction_deg === null ? null : Number(weather[0].wind_direction_deg),
          precipitation: weather[0].precipitation_mm === null ? null : Number(weather[0].precipitation_mm),
        }
      : null,
  });
  const forecasts = bundle.forecasts;
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
    deteriorationProbability: bundle.deteriorationProbability,
    note:
      bundle.source === 'ML'
        ? 'Warning criteria use the registered LightGBM model and its calibrated deterioration probability. The model is not a regulatory determination.'
        : 'No calibrated deterioration classifier is trained, so no probability is shown. Warning criteria use the labelled persistence baseline and are analytical, not ML.',
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
    modelStatus: bundle.modelStatus,
    method: bundle.source === 'ML' ? 'LIGHTGBM_TRAINED' : 'PERSISTENCE_BASELINE_V1',
    intervals: bundle.source === 'ML' ? 'QUANTILE_10_90' : 'EMPIRICAL_80_PERCENT_BAND_NOT_CALIBRATED',
    shap: bundle.shapStatus,
    shapValues: bundle.shap,
    forecastLimitations: bundle.limitations,
    modelVersion: bundle.modelVersion,
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
    const [models, mlStatus] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT id, name, version, category, target, horizon_hours, model_type, status, metrics, trained_at, notes
         FROM model_registry ORDER BY status, name, version`,
      ),
      mlConfigured ? mlHealth() : Promise.resolve({ status: 'NOT_CONFIGURED', modelVersion: null }),
    ]);
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
        trainedModels: mlStatus.status === 'TRAINED' ? 'TRAINED' : mlStatus.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'NOT_TRAINED',
        reason:
          mlStatus.status === 'TRAINED'
            ? 'A trained ML service is registered. Verify the model card and metrics before operational use.'
            : mlStatus.status === 'UNAVAILABLE'
              ? 'The configured ML service is unreachable; the labelled persistence baseline is shown.'
              : 'No verified Mumbai historical training extract has been supplied.',
        available: mlStatus.status === 'TRAINED' ? 'LIGHTGBM_TRAINED' : 'PERSISTENCE_BASELINE_V1',
        modelVersion: mlStatus.modelVersion,
        shap: mlStatus.status === 'TRAINED' ? 'COMPUTED_BY_MODEL' : 'UNAVAILABLE',
        quantileIntervals: mlStatus.status === 'TRAINED' ? 'QUANTILE_10_90' : 'NOT_AVAILABLE',
        deteriorationClassifier: mlStatus.status === 'TRAINED' ? 'TRAINED' : 'NOT_TRAINED',
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
