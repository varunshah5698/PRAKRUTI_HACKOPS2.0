import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyWeather, eventKey, fetchMetNoCurrent, locationKey } from './citizen-weather.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MET Norway current conditions', () => {
  it('normalises wind direction, pressure and the hourly precipitation forecast', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          properties: {
            timeseries: [
              {
                time: '2026-11-06T14:00:00Z',
                data: {
                  instant: {
                    details: {
                      air_temperature: 31.5,
                      relative_humidity: 47.8,
                      wind_speed: 4.8,
                      wind_speed_of_gust: 7.2,
                      wind_from_direction: 332.5,
                      air_pressure_at_sea_level: 1012.8,
                    },
                  },
                  next_1_hours: {
                    summary: { symbol_code: 'clearsky_night' },
                    details: { precipitation_amount: 0 },
                  },
                },
              },
            ],
          },
        }),
      })),
    );

    const reading = await fetchMetNoCurrent({ latitude: 19.076, longitude: 72.8777 });
    expect(reading?.sourceId).toBe('met-no-weather');
    expect(reading?.observedAt).toBe('2026-11-06T14:00:00Z');
    expect(reading?.windDirectionDeg).toBe(332.5);
    expect(reading?.pressureHpa).toBe(1012.8);
    expect(reading?.windSpeedKmh).toBeCloseTo(17.28, 2);
    expect(reading?.precipitationMm).toBe(0);
    expect(reading?.weatherCode).toBe(0);
  });
});

describe('citizen weather classification', () => {
  it('returns NORMAL when no threshold is crossed', () => {
    const result = classifyWeather({
      temperatureC: 29,
      precipitationMm: 0,
      windSpeedKmh: 12,
      windGustKmh: 20,
      weatherCode: 1,
    });
    expect(result.severity).toBe('NORMAL');
  });

  it('classifies heavy rain as HIGH and extreme rain as CRITICAL', () => {
    expect(
      classifyWeather({ temperatureC: 27, precipitationMm: 20, windSpeedKmh: 10, windGustKmh: 15, weatherCode: 63 })
        .severity,
    ).toBe('HIGH');
    expect(
      classifyWeather({ temperatureC: 27, precipitationMm: 40, windSpeedKmh: 10, windGustKmh: 15, weatherCode: 65 })
        .severity,
    ).toBe('CRITICAL');
  });

  it('classifies a thunderstorm and dangerous wind', () => {
    expect(
      classifyWeather({ temperatureC: 30, precipitationMm: 2, windSpeedKmh: 70, windGustKmh: 95, weatherCode: 95 })
        .severity,
    ).toBe('HIGH');
    expect(
      classifyWeather({ temperatureC: 30, precipitationMm: 0, windSpeedKmh: 80, windGustKmh: 120, weatherCode: 3 })
        .severity,
    ).toBe('CRITICAL');
  });

  it('separates extreme heat from normal heat', () => {
    expect(
      classifyWeather({ temperatureC: 41, precipitationMm: 0, windSpeedKmh: 5, windGustKmh: 8, weatherCode: 0 })
        .severity,
    ).toBe('MODERATE');
    expect(
      classifyWeather({ temperatureC: 45, precipitationMm: 0, windSpeedKmh: 5, windGustKmh: 8, weatherCode: 0 })
        .severity,
    ).toBe('HIGH');
  });
});

describe('citizen weather event keys', () => {
  const classification = classifyWeather({
    temperatureC: 46,
    precipitationMm: 0,
    windSpeedKmh: 4,
    windGustKmh: 6,
    weatherCode: 0,
  });

  it('groups nearby coordinates and deduplicates within a cooldown window', () => {
    const at = new Date('2026-11-05T10:00:00Z');
    const later = new Date('2026-11-05T11:00:00Z');
    expect(locationKey(19.076, 72.8777)).toBe(locationKey(19.0761, 72.8779));
    expect(eventKey('19.076,72.878', classification, at, 360)).toBe(
      eventKey('19.076,72.878', classification, later, 360),
    );
  });

  it('creates a new key after the cooldown and on severity escalation', () => {
    const at = new Date('2026-11-05T10:00:00Z');
    const after = new Date('2026-11-05T17:00:00Z');
    const critical = classifyWeather({
      temperatureC: 48,
      precipitationMm: 0,
      windSpeedKmh: 4,
      windGustKmh: 6,
      weatherCode: 0,
    });
    expect(eventKey('19.076,72.878', classification, at, 360)).not.toBe(
      eventKey('19.076,72.878', classification, after, 360),
    );
    expect(eventKey('19.076,72.878', classification, at, 360)).not.toBe(
      eventKey('19.076,72.878', critical, at, 360),
    );
  });
});
