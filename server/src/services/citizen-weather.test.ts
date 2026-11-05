import { describe, expect, it } from 'vitest';
import { classifyWeather, eventKey, locationKey } from './citizen-weather.js';

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
