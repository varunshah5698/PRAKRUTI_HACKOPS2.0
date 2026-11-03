import { baselineForecast, type BaselineForecast, type ObservationPoint } from './forecast.js';
import { getMlPrediction, mlConfigured, type MlForecast } from './ml.js';

export interface ForecastRecord {
  horizonHours: number;
  predictedValue: number;
  lowerBound: number;
  upperBound: number;
  method: 'LIGHTGBM_TRAINED' | 'PERSISTENCE_BASELINE_V1';
  confidence: 'MODEL_TRAINED' | 'NOT_CALIBRATED';
  intervalNote: string;
  targetTime: string;
  currentValue: number;
  trendPerHour: number;
  sampleSize: number;
  modelVersion?: string | null;
}

export interface ForecastBundle {
  source: 'ML' | 'BASELINE';
  modelStatus: 'TRAINED' | 'NOT_TRAINED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  modelVersion: string | null;
  forecasts: ForecastRecord[];
  deteriorationProbability: number | null;
  shapStatus: string;
  shap: Array<{ feature: string; contribution: number }>;
  limitations: string[];
  error?: string;
}

function toRecord(forecast: MlForecast, history: ObservationPoint[], modelVersion: string | null): ForecastRecord {
  const current = history.length ? history[history.length - 1].value : 0;
  const trend = (forecast.predictedValue - current) / Math.max(1, forecast.horizonHours);
  return {
    horizonHours: forecast.horizonHours,
    predictedValue: forecast.predictedValue,
    lowerBound: forecast.lowerBound,
    upperBound: forecast.upperBound,
    method: 'LIGHTGBM_TRAINED',
    confidence: 'MODEL_TRAINED',
    intervalNote:
      'Quantile 10th/90th percentile output from the registered LightGBM model. Coverage must be validated on the training extract; see MODEL_CARD.md.',
    targetTime: forecast.targetTime,
    currentValue: Number(current.toFixed(1)),
    trendPerHour: Number(trend.toFixed(2)),
    sampleSize: history.length,
    modelVersion,
  };
}

export async function getForecastsForStation(params: {
  stationId: string;
  history: ObservationPoint[];
  weather: {
    temperature: number | null;
    humidity: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    precipitation: number | null;
  } | null;
  latest?: Record<string, number>;
  now?: Date;
}): Promise<ForecastBundle> {
  if (mlConfigured) {
    const ml = await getMlPrediction(params);
    if (ml.status === 'COMPLETED' && ml.forecasts.length === 3) {
      return {
        source: 'ML',
        modelStatus: 'TRAINED',
        modelVersion: ml.modelVersion,
        forecasts: ml.forecasts.map((forecast) => toRecord(forecast, params.history, ml.modelVersion)),
        deteriorationProbability: ml.deteriorationProbability,
        shapStatus: ml.shapStatus,
        shap: ml.shap,
        limitations: ml.limitations,
      };
    }
    if (ml.status === 'NOT_TRAINED' || ml.status === 'UNAVAILABLE') {
      const baseline = [1, 3, 6]
        .map((horizon) => baselineForecast(params.history, horizon, params.now))
        .filter((forecast): forecast is BaselineForecast => Boolean(forecast));
      return {
        source: 'BASELINE',
        modelStatus: ml.status,
        modelVersion: null,
        forecasts: baseline,
        deteriorationProbability: null,
        shapStatus: 'UNAVAILABLE',
        shap: [],
        limitations: [ml.error ?? 'Trained model unavailable; labelled persistence baseline shown.'],
        error: ml.error,
      };
    }
  }
  const baseline = [1, 3, 6]
    .map((horizon) => baselineForecast(params.history, horizon, params.now))
    .filter((forecast): forecast is BaselineForecast => Boolean(forecast));
  return {
    source: 'BASELINE',
    modelStatus: 'NOT_CONFIGURED',
    modelVersion: null,
    forecasts: baseline,
    deteriorationProbability: null,
    shapStatus: 'UNAVAILABLE',
    shap: [],
    limitations: ['Labelled persistence baseline shown.'],
  };
}
