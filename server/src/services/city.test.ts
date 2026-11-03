import { describe, expect, it } from 'vitest';
import { classifyDischarge, haversineKm, isWithinMumbaiBounds } from './city.js';

describe('live city open-data helpers', () => {
  it('keeps queries inside the Greater Mumbai viewbox', () => {
    expect(isWithinMumbaiBounds(19.076, 72.8777)).toBe(true);
    expect(isWithinMumbaiBounds(19.35, 73.05)).toBe(true);
    expect(isWithinMumbaiBounds(28.6139, 77.209)).toBe(false);
    expect(isWithinMumbaiBounds(19.076, 71.5)).toBe(false);
  });

  it('computes short distances with the haversine formula', () => {
    const bandra = { lat: 19.0607, lng: 72.8362 };
    const colaba = { lat: 18.9067, lng: 72.8147 };
    expect(haversineKm(bandra, colaba)).toBeGreaterThan(17);
    expect(haversineKm(bandra, colaba)).toBeLessThan(19);
    expect(haversineKm(bandra, bandra)).toBe(0);
  });

  it('bands modelled discharge without pretending it is a flood warning', () => {
    expect(classifyDischarge(10, 10, 12)).toBe('TYPICAL');
    expect(classifyDischarge(13, 10, 15)).toBe('WATCH');
    expect(classifyDischarge(21, 10, 15)).toBe('ELEVATED');
    expect(classifyDischarge(null, 10, 15)).toBe('NO DATA');
  });
});
