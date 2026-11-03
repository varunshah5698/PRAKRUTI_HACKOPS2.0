import { describe, expect, it } from 'vitest';
import {
  bearingDegrees,
  buildPlumePolygon,
  computeSourceImpact,
  compassLabel,
  haversineMeters,
  type IndustrialSource,
} from './source-impact.js';

const source: IndustrialSource = {
  id: 'TEST-SOURCE',
  name: 'Test stack',
  type: 'Test',
  localityName: 'Test locality',
  lat: 19.0,
  lng: 72.8,
  stackHeightM: 80,
  emissionIndex: 90,
  primaryPollutant: 'PM2.5',
  isSimulated: true,
  note: 'test',
};

describe('industrial source screening', () => {
  it('measures distance and bearing to a nearby point', () => {
    const distance = haversineMeters(19.0, 72.8, 19.0, 72.9);
    expect(distance).toBeGreaterThan(10_000);
    expect(distance).toBeLessThan(11_000);
    expect(bearingDegrees(19.0, 72.8, 19.1, 72.8)).toBeCloseTo(0, 0);
  });

  it('builds a closed plume polygon pointing downwind', () => {
    const plume = buildPlumePolygon(source, { speedKmh: 10, directionDeg: 270, observedAt: null, source: 'TEST' });
    const ring = plume.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const tip = ring[Math.floor(ring.length / 2)];
    expect(tip[0]).toBeGreaterThan(source.lng);
    expect(plume.lengthM).toBeGreaterThan(1_000);
  });

  it('attributes a downwind monitor more strongly than a crosswind monitor', () => {
    const downwind = { id: 'DOWNWIND', name: 'Downwind', localityName: 'East', lat: 19.0, lng: 72.86, pm25: 60 };
    const crosswind = { id: 'CROSSWIND', name: 'Crosswind', localityName: 'North', lat: 19.06, lng: 72.8, pm25: 60 };
    const result = computeSourceImpact([downwind, crosswind], {
      speedKmh: 8,
      directionDeg: 270,
      observedAt: new Date().toISOString(),
      source: 'TEST',
    }, [source]);
    expect(result.stationAttributions.DOWNWIND.sources[0].alignment).toBeGreaterThan(0.9);
    expect(result.stationAttributions.CROSSWIND.sources.length).toBe(0);
    expect(result.stationAttributions.CROSSWIND.impactLevel).toBe('NONE');
    expect(result.stationAttributions.DOWNWIND.impactLevel).not.toBe('NONE');
    expect(result.sources[0].rank).toBe(1);
    expect(result.wind.fromLabel).toBe('W');
  });

  it('still exposes a plume footprint when no monitor is close', () => {
    const result = computeSourceImpact([], { speedKmh: 12, directionDeg: 240, observedAt: null, source: 'TEST' }, [source]);
    expect(result.landImpact.affectedStations).toBe(0);
    expect(result.sources[0].plume.coordinates[0].length).toBeGreaterThan(10);
    expect(compassLabel(240)).toBe('WSW');
  });
});
