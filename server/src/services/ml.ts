import { env } from '../config/env.js';
import type { ObservationPoint } from './forecast.js';

export interface MlForecast {
  horizonHours: number;
  predictedValue: number;
  lowerBound: number;
  upperBound: number;
  targetTime: string;
}

export interface MlPredictionResult {
  status: 'COMPLETED' | 'NOT_CONFIGURED' | 'NOT_TRAINED' | 'UNAVAILABLE';
  modelVersion: string | null;
  forecasts: MlForecast[];
  deteriorationProbability: number | null;
  shapStatus: string;
  shap: Array<{ feature: string; contribution: number }>;
  limitations: string[];
  error?: string;
}

export const mlConfigured = Boolean(env.ML_SERVICE_URL);

export async function mlHealth(): Promise<{ status: string; modelVersion: string | null; error?: string }> {
  if (!mlConfigured) return { status: 'NOT_CONFIGURED', modelVersion: null };
  try {
    const response = await fetch(`${env.ML_SERVICE_URL.replace(/\/$/, '')}/health`, {
      headers: env.ML_SERVICE_API_KEY ? { Authorization: `Bearer ${env.ML_SERVICE_API_KEY}` } : {},
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { status: 'UNAVAILABLE', modelVersion: null, error: `HTTP ${response.status}` };
    const data = (await response.json()) as { status?: string; model_version?: string };
    return { status: data.status ?? 'UNAVAILABLE', modelVersion: data.model_version ?? null };
  } catch (error) {
    return { status: 'UNAVAILABLE', modelVersion: null, error: error instanceof Error ? error.message : 'ML service unreachable' };
  }
}

export async function getMlPrediction(params: {
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
}): Promise<MlPredictionResult> {
  if (!mlConfigured) {
    return { status: 'NOT_CONFIGURED', modelVersion: null, forecasts: [], deteriorationProbability: null, shapStatus: 'UNAVAILABLE', shap: [], limitations: [] };
  }
  try {
    const now = params.now ?? new Date();
    const response = await fetch(`${env.ML_SERVICE_URL.replace(/\/$/, '')}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.ML_SERVICE_API_KEY ? { Authorization: `Bearer ${env.ML_SERVICE_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        station_id: params.stationId,
        history: params.history.map((point) => ({ timestamp: point.observedAt, pm25: point.value })),
        weather: params.weather ?? {},
        latest: params.latest ?? {},
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        status: response.status === 503 ? 'NOT_TRAINED' : 'UNAVAILABLE',
        modelVersion: null,
        forecasts: [],
        deteriorationProbability: null,
        shapStatus: 'UNAVAILABLE',
        shap: [],
        limitations: [],
        error: body.slice(0, 300) || `HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as {
      status: string;
      model_version?: string;
      forecasts?: Array<{ horizon_hours: number; predicted_value: number; lower_bound: number; upper_bound: number }>;
      deterioration_probability?: number | null;
      shap_status?: string;
      shap?: Array<{ feature: string; contribution: number }>;
      limitations?: string[];
    };
    return {
      status: 'COMPLETED',
      modelVersion: data.model_version ?? null,
      forecasts: (data.forecasts ?? []).map((forecast) => ({
        horizonHours: forecast.horizon_hours,
        predictedValue: forecast.predicted_value,
        lowerBound: forecast.lower_bound,
        upperBound: forecast.upper_bound,
        targetTime: new Date(now.getTime() + forecast.horizon_hours * 3_600_000).toISOString(),
      })),
      deteriorationProbability: data.deterioration_probability ?? null,
      shapStatus: data.shap_status ?? 'UNAVAILABLE',
      shap: data.shap ?? [],
      limitations: data.limitations ?? [],
    };
  } catch (error) {
    return {
      status: 'UNAVAILABLE',
      modelVersion: null,
      forecasts: [],
      deteriorationProbability: null,
      shapStatus: 'UNAVAILABLE',
      shap: [],
      limitations: [],
      error: error instanceof Error ? error.message : 'ML service unreachable',
    };
  }
}
