import { describe, expect, it } from 'vitest';
import { buildLocationRecommendations, confidenceFor, shortPlaceName, type LocationStationSummary } from './location-analysis.js';

function airStation(overrides: Partial<LocationStationSummary> = {}): LocationStationSummary {
  return {
    id: 'station-1',
    name: 'Test monitor',
    code: 'TEST-01',
    stationType: 'AIR_CAAQMS',
    localityName: 'Test locality',
    lat: 19.07,
    lng: 72.87,
    distanceM: 600,
    healthStatus: 'ONLINE',
    isSimulated: false,
    isStale: false,
    latestObservedAt: new Date().toISOString(),
    aqi: 210,
    aqiCategory: 'Poor',
    dominantPollutant: 'pm25',
    values: {
      pm25: { value: 94, unit: 'µg/m³', observedAt: new Date().toISOString(), qualityState: 'VALID', sourceId: 'test', isSimulated: false },
    },
    ...overrides,
  };
}

describe('reverse-geocoded place labels', () => {
  it('prefers neighbourhood and suburb for a short place label', () => {
    expect(shortPlaceName({ road: 'Dr. BR Ambedkar Road', neighbourhood: 'Adarsh Nagar', suburb: 'Khar' })).toBe('Adarsh Nagar, Khar');
  });

  it('falls back to the first display-name segment', () => {
    expect(shortPlaceName({}, 'Marine Drive, Churchgate, Mumbai, India')).toBe('Marine Drive');
  });
});

describe('location analysis recommendations', () => {
  it('prioritises exposure advice for a poor-air location', () => {
    const items = buildLocationRecommendations({
      category: 'air',
      primary: airStation(),
      cams: null,
      weather: null,
      sources: [],
      reports: [],
      incidents: [],
      alerts: [],
    });
    expect(items[0].tone).toBe('urgent');
    expect(items[0].title.toLowerCase()).toContain('limit outdoor exposure');
  });

  it('does not present simulation-labelled evidence as high confidence', () => {
    const confidence = confidenceFor({
      primary: airStation({ isSimulated: true }),
      cams: { localityName: 'Test', pm25: 40, pm10: 70, observedAt: new Date().toISOString(), note: 'modelled' },
      weather: { temperatureC: 30, relativeHumidity: 70, windSpeedKmh: 9, windDirectionDeg: 240, precipitationMm: 0, observedAt: new Date().toISOString(), sourceId: 'test' },
      reports: [],
    });
    expect(confidence.level).toBe('MEDIUM');
    expect(confidence.reasons.join(' ')).toContain('simulation-labelled');
  });

  it('does not claim high confidence from a distant monitor', () => {
    const confidence = confidenceFor({
      primary: airStation({ distanceM: 4800 }),
      cams: null,
      weather: null,
      reports: [],
    });
    expect(confidence.level).toBe('LOW');
  });

  it('adds avoid-contact advice for a water location with low dissolved oxygen', () => {
    const items = buildLocationRecommendations({
      category: 'water',
      primary: airStation({
        stationType: 'WATER_SAMPLING',
        values: {
          do: { value: 3.8, unit: 'mg/L', observedAt: new Date().toISOString(), qualityState: 'VALID', sourceId: 'test', isSimulated: false },
          ph: { value: 7, unit: 'pH', observedAt: new Date().toISOString(), qualityState: 'VALID', sourceId: 'test', isSimulated: false },
        },
      }),
      cams: null,
      weather: null,
      sources: [],
      reports: [],
      incidents: [],
      alerts: [],
    });
    expect(items.some((item) => item.title.toLowerCase().includes('avoid contact'))).toBe(true);
    expect(items.some((item) => item.title.toLowerCase().includes('dissolved oxygen'))).toBe(true);
  });
});
