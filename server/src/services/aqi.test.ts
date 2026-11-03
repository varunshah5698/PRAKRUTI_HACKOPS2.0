import { describe, expect, it } from 'vitest';
import { calculateAqi, subIndex, aqiCategory } from './aqi.js';

describe('CPCB indicative AQI', () => {
  it('computes sub-indices at breakpoints', () => {
    expect(subIndex('pm25', 0)).toBe(0);
    expect(subIndex('pm25', 30)).toBe(50);
    expect(subIndex('pm25', 60)).toBe(100);
    expect(subIndex('pm25', 90)).toBe(200);
    expect(subIndex('pm25', 500)).toBe(500);
  });

  it('uses the worst sub-index as the AQI', () => {
    const result = calculateAqi({ pm25: 45, pm10: 160, no2: 30 });
    expect(result.dominantPollutant).toBe('pm10');
    expect(result.aqi).toBe(140);
    expect(result.category).toBe('Moderate');
    expect(result.caveat).toMatch(/not an official CPCB AQI/i);
  });

  it('returns insufficient data instead of inventing a value', () => {
    const result = calculateAqi({});
    expect(result.aqi).toBeNull();
    expect(result.category).toBe('INSUFFICIENT DATA');
  });

  it('maps AQI categories', () => {
    expect(aqiCategory(50)).toBe('Good');
    expect(aqiCategory(51)).toBe('Satisfactory');
    expect(aqiCategory(201)).toBe('Poor');
    expect(aqiCategory(null)).toBe('INSUFFICIENT DATA');
  });
});
