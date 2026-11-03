/**
 * Clearly labelled persistence baseline.
 *
 * This is NOT the LightGBM model. It exists so the application can show an
 * honest analytical forecast while no verified Mumbai historical training
 * extract is available. It must always be displayed as PERSISTENCE BASELINE.
 */

export interface ObservationPoint {
  observedAt: string;
  value: number;
}

export interface BaselineForecast {
  horizonHours: number;
  predictedValue: number;
  lowerBound: number;
  upperBound: number;
  method: 'PERSISTENCE_BASELINE_V1';
  confidence: 'NOT_CALIBRATED';
  intervalNote: string;
  targetTime: string;
  currentValue: number;
  trendPerHour: number;
  sampleSize: number;
}

export function baselineForecast(
  observations: ObservationPoint[],
  horizonHours: number,
  now = new Date(),
): BaselineForecast | null {
  const sorted = observations
    .filter((o) => Number.isFinite(o.value))
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
  if (sorted.length < 3) return null;

  const current = sorted[sorted.length - 1].value;
  const recent = sorted.slice(-12);
  const diffs: number[] = [];
  for (let i = 1; i < recent.length; i += 1) {
    const dtHours =
      (new Date(recent[i].observedAt).getTime() - new Date(recent[i - 1].observedAt).getTime()) / 3_600_000;
    if (dtHours > 0) diffs.push((recent[i].value - recent[i - 1].value) / dtHours);
  }
  const meanDiff = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
  // Damp the trend so a single noisy hour cannot create an aggressive forecast.
  const dampedTrend = Math.max(-2, Math.min(2, meanDiff)) * 0.5;
  const predicted = Math.max(0, current + dampedTrend * horizonHours);

  const residuals: number[] = [];
  const mean = recent.reduce((a, b) => a + b.value, 0) / recent.length;
  for (const point of recent) residuals.push(point.value - mean);
  const variance = residuals.length > 1 ? residuals.reduce((a, b) => a + b * b, 0) / (residuals.length - 1) : 0;
  const sd = Math.sqrt(variance);
  // Empirical 80% band, widened with horizon. Not a calibrated prediction interval.
  const band = Math.max(2, sd * Math.sqrt(Math.max(1, horizonHours) / 3) * 1.2816);
  const target = new Date(now.getTime() + horizonHours * 3_600_000);

  return {
    horizonHours,
    predictedValue: Number(predicted.toFixed(1)),
    lowerBound: Number(Math.max(0, predicted - band).toFixed(1)),
    upperBound: Number((predicted + band).toFixed(1)),
    method: 'PERSISTENCE_BASELINE_V1',
    confidence: 'NOT_CALIBRATED',
    intervalNote:
      'Empirical 80% band from recent variability, widened by horizon. Not a calibrated quantile model and not validated forecast skill.',
    targetTime: target.toISOString(),
    currentValue: Number(current.toFixed(1)),
    trendPerHour: Number(dampedTrend.toFixed(2)),
    sampleSize: recent.length,
  };
}

export function anomalyScore(observations: ObservationPoint[]): {
  status: 'NORMAL' | 'UNUSUAL' | 'INSUFFICIENT_DATA';
  zScore: number | null;
  latest: number | null;
  mean: number | null;
  sd: number | null;
  method: string;
} {
  const sorted = [...observations].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
  );
  const values = sorted.map((o) => o.value).filter((v) => Number.isFinite(v));
  if (values.length < 6) {
    return { status: 'INSUFFICIENT_DATA', zScore: null, latest: null, mean: null, sd: null, method: 'ZSCORE_V1' };
  }
  const latest = values[values.length - 1];
  const baseline = values.slice(0, -1);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, baseline.length - 1);
  const sd = Math.sqrt(variance);
  const z = sd > 0.01 ? (latest - mean) / sd : latest === mean ? 0 : latest > mean ? 99 : -99;
  return {
    status: Math.abs(z) >= 2.5 ? 'UNUSUAL' : 'NORMAL',
    zScore: Number(z.toFixed(2)),
    latest,
    mean: Number(mean.toFixed(1)),
    sd: Number(sd.toFixed(1)),
    method: 'ZSCORE_V1 (analytical, not a trained anomaly model)',
  };
}
