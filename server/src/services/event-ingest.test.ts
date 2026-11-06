import { describe, expect, it } from 'vitest';
import { classifyPlanetEvent } from './event-ingest.js';
import type { PlanetEvent } from './city.js';

function event(overrides: Partial<PlanetEvent>): PlanetEvent {
  return {
    id: 'test',
    title: 'Test event',
    kind: 'Other',
    date: null,
    lat: 19,
    lng: 72,
    magnitude: null,
    url: null,
    distanceKm: null,
    provider: 'NASA EONET',
    ...overrides,
  };
}

describe('disaster feed classification', () => {
  it('maps GDACS alert levels without claiming local official warnings', () => {
    const result = classifyPlanetEvent(
      event({ provider: 'GDACS', kind: 'TC · Red alert', title: 'Tropical cyclone' }),
    );
    expect(result.category).toBe('CYCLONE');
    expect(result.severity).toBe('CRITICAL');
  });

  it('maps flood and wildfire feeds', () => {
    expect(classifyPlanetEvent(event({ provider: 'GDACS', kind: 'FL · Orange alert', title: 'Flood' })).category).toBe('RIVER_FLOOD');
    expect(classifyPlanetEvent(event({ provider: 'NASA EONET', kind: 'Wildfires', title: 'Forest fire' })).category).toBe('WILDFIRE');
  });

  it('maps USGS earthquakes by magnitude', () => {
    const result = classifyPlanetEvent(event({ provider: 'USGS', kind: 'Earthquake', title: 'M6.2 earthquake', magnitude: 6.2 }));
    expect(result.category).toBe('EARTHQUAKE');
    expect(result.severity).toBe('HIGH');
  });

  it('leaves unknown EONET severity unclaimed', () => {
    const result = classifyPlanetEvent(event({ provider: 'NASA EONET', kind: 'Dust and Haze', title: 'Dust event' }));
    expect(result.category).toBe('OTHER');
    expect(result.severity).toBe('UNKNOWN');
  });
});
