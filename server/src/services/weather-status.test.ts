import { describe, expect, it } from 'vitest';
import { validateWeatherReading, weatherIntegrity } from './weather-status.js';

const base = {
  observedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  fetchedAt: new Date().toISOString(),
  sourceId: 'open-meteo-weather',
  isSimulated: false,
  demoMode: false,
  latitude: 19.076,
  longitude: 72.8777,
  temperatureC: 31,
  relativeHumidity: 70,
  precipitationMm: 0,
  windSpeedKmh: 12,
  windGustKmh: 20,
};

describe('weather data integrity', () => {
  it('accepts a recent validated Open-Meteo reading as LIVE', () => {
    const result = weatherIntegrity(base);
    expect(result.status).toBe('LIVE');
    expect(result.isLive).toBe(true);
    expect(result.provider).toBe('Open-Meteo');
    expect(result.dataSourceType).toBe('CURRENT_CONDITIONS');
    expect(result.validationStatus).toBe('VALID');
  });

  it('marks an older real reading STALE and a very old one UNAVAILABLE', () => {
    expect(weatherIntegrity({ ...base, observedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() }).status).toBe('STALE');
    expect(weatherIntegrity({ ...base, observedAt: new Date(Date.now() - 30 * 60 * 60_000).toISOString() }).status).toBe('UNAVAILABLE');
  });

  it('rejects fabricated or out-of-range values', () => {
    expect(validateWeatherReading({ ...base, temperatureC: 120 }).valid).toBe(false);
    expect(validateWeatherReading({ ...base, sourceId: 'unknown-source' }).valid).toBe(false);
    expect(validateWeatherReading({ ...base, latitude: 500 }).valid).toBe(false);
    expect(weatherIntegrity({ ...base, temperatureC: 120 }).status).toBe('UNAVAILABLE');
  });

  it('never labels simulated data as live in production', () => {
    const result = weatherIntegrity({ ...base, sourceId: 'demo-network', isSimulated: true, demoMode: false });
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.isLive).toBe(false);
  });

  it('labels simulated data DEMO only in an explicit demo environment', () => {
    expect(weatherIntegrity({ ...base, sourceId: 'demo-network', isSimulated: true, demoMode: true }).status).toBe('DEMO');
  });

  it('identifies MET Norway as an hourly forecast, not a current observation', () => {
    const result = weatherIntegrity({ ...base, sourceId: 'met-no-weather' });
    expect(result.provider).toBe('MET Norway');
    expect(result.dataSourceType).toBe('HOURLY_FORECAST');
    expect(result.forecastTime).toBe(base.observedAt);
  });
});
