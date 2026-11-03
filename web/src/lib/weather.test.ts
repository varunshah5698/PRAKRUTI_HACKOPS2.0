import { describe, expect, it } from 'vitest';
import { feelsLikeC, isNightInMumbai, weatherCondition } from './weather';

const base = {
  temperature_c: 30,
  relative_humidity: 60,
  wind_speed_kmh: 10,
  precipitation_mm: 0,
};

describe('weatherCondition', () => {
  it('reports rain before any temperature label', () => {
    expect(weatherCondition({ ...base, temperature_c: 36, precipitation_mm: 1.2 }).mood).toBe('rain');
  });

  it('separates hot-dry from hot-humid', () => {
    expect(weatherCondition({ ...base, temperature_c: 34, relative_humidity: 40 }).label).toBe('Hot and dry');
    expect(weatherCondition({ ...base, temperature_c: 34, relative_humidity: 70 }).label).toBe('Hot and humid');
  });

  it('handles missing weather without inventing a condition', () => {
    expect(weatherCondition(null).label).toBe('Weather unavailable');
    expect(weatherCondition({ ...base, temperature_c: null }).label).toBe('Weather unavailable');
  });
});

describe('feelsLikeC', () => {
  it('raises apparent temperature in humid heat', () => {
    const feels = feelsLikeC({ ...base, temperature_c: 34, relative_humidity: 75, wind_speed_kmh: 8 });
    expect(feels).not.toBeNull();
    expect(feels as number).toBeGreaterThan(34);
  });

  it('returns null without a temperature', () => {
    expect(feelsLikeC({ ...base, temperature_c: null })).toBeNull();
  });
});

describe('isNightInMumbai', () => {
  it('uses Asia/Kolkata, not the viewer timezone', () => {
    expect(isNightInMumbai('2026-11-03T14:30:00+05:30')).toBe(false);
    expect(isNightInMumbai('2026-11-03T22:30:00+05:30')).toBe(true);
  });
});
