import { describe, expect, it } from 'vitest';
import {
  FORECAST_HOURS,
  HISTORY_HOURS,
  aqiCategory,
  aqiFromPm25,
  buildSimulation,
  type Seed,
} from './AtmospherePage';

const seed: Seed = {
  basePm25: 62,
  baseAqi: 103,
  weather: {
    observed_at: '2026-11-03T08:00:00.000Z',
    temperature_c: 30,
    relative_humidity: 74,
    wind_speed_kmh: 11,
    wind_direction_deg: 240,
    precipitation_mm: 0,
    is_simulated: true,
  },
  stations: [],
  generatedAt: null,
  source: 'sandbox',
  summary: null,
};

const anchor = new Date('2026-11-03T08:00:00.000Z');

describe('atmosphere simulation', () => {
  it('uses the CPCB PM2.5 breakpoints and categories', () => {
    expect(aqiFromPm25(30)).toBe(50);
    expect(aqiFromPm25(60)).toBe(100);
    expect(aqiFromPm25(90)).toBe(200);
    expect(aqiFromPm25(120)).toBe(300);
    expect(aqiFromPm25(null)).toBeNull();
    expect(aqiCategory(50)).toBe('Good');
    expect(aqiCategory(51)).toBe('Satisfactory');
    expect(aqiCategory(101)).toBe('Moderate');
    expect(aqiCategory(201)).toBe('Poor');
    expect(aqiCategory(301)).toBe('Very Poor');
    expect(aqiCategory(401)).toBe('Severe');
  });

  it('normalises the current hour to the seed and widens the uncertainty band', () => {
    const sim = buildSimulation(seed, 'baseline', anchor);
    expect(sim.points).toHaveLength(HISTORY_HOURS + FORECAST_HOURS + 1);
    expect(sim.points[HISTORY_HOURS].pm25).toBeCloseTo(seed.basePm25, 4);
    expect(sim.points[HISTORY_HOURS].lower).toBeLessThan(seed.basePm25);
    expect(sim.points[HISTORY_HOURS].upper).toBeGreaterThan(seed.basePm25);
    const currentSpread = sim.points[HISTORY_HOURS].upper - sim.points[HISTORY_HOURS].lower;
    const lastSpread = sim.points.at(-1)!.upper - sim.points.at(-1)!.lower;
    expect(lastSpread).toBeGreaterThan(currentSpread);
  });

  it('is deterministic and orders clean-air below stagnation', () => {
    const baseline = buildSimulation(seed, 'baseline', anchor);
    const repeat = buildSimulation(seed, 'baseline', anchor);
    const clean = buildSimulation(seed, 'clean', anchor);
    const stagnant = buildSimulation(seed, 'stagnant', anchor);

    expect(repeat.points.map((point) => point.pm25)).toEqual(baseline.points.map((point) => point.pm25));
    // Every scenario shares the baseline normalisation, so the scenario itself can shift the current hour.
    expect(baseline.points[HISTORY_HOURS].pm25).toBeCloseTo(seed.basePm25, 4);
    expect(clean.points[HISTORY_HOURS].pm25).toBeLessThan(seed.basePm25);
    expect(stagnant.points[HISTORY_HOURS].pm25).toBeGreaterThan(seed.basePm25);
    const average = (points: typeof baseline.points) =>
      points.slice(HISTORY_HOURS).reduce((sum, point) => sum + point.pm25, 0) / (points.length - HISTORY_HOURS);
    expect(average(clean.points)).toBeLessThan(average(baseline.points));
    expect(average(stagnant.points)).toBeGreaterThan(average(baseline.points));
  });
});
