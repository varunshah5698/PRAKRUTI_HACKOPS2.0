import { describe, expect, it } from 'vitest';
import { baselineForecast, anomalyScore } from './forecast.js';

describe('persistence baseline', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    observedAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    value: 40 + index,
  }));

  it('is deterministic for the same input', () => {
    const a = baselineForecast(history, 3, new Date('2026-01-01T12:00:00Z'));
    const b = baselineForecast(history, 3, new Date('2026-01-01T12:00:00Z'));
    expect(a).toEqual(b);
    expect(a?.method).toBe('PERSISTENCE_BASELINE_V1');
    expect(a?.confidence).toBe('NOT_CALIBRATED');
  });

  it('returns null when history is insufficient', () => {
    expect(baselineForecast(history.slice(0, 2), 3)).toBeNull();
  });

  it('widens the empirical band with horizon', () => {
    const one = baselineForecast(history, 1)!;
    const six = baselineForecast(history, 6)!;
    expect(six.upperBound - six.lowerBound).toBeGreaterThan(one.upperBound - one.lowerBound);
  });

  it('flags a large anomaly with the analytical z-score method', () => {
    const values = Array.from({ length: 10 }, (_, index) => ({
      observedAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      value: index === 9 ? 200 : 40,
    }));
    const result = anomalyScore(values);
    expect(result.status).toBe('UNUSUAL');
    expect(result.method).toMatch(/not a trained anomaly model/i);
  });
});
