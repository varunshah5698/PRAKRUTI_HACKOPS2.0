import { describe, expect, it } from 'vitest';
import type { RiskAssessmentResult } from '../types.js';
import { buildSimulationRecommendations } from './simulation-recommendations.js';

function risk(overrides: Partial<RiskAssessmentResult> = {}): RiskAssessmentResult {
  return {
    category: 'air',
    entityType: 'simulation_station',
    entityId: 'session-1',
    riskScore: 88,
    riskLevel: 'CRITICAL',
    confidenceScore: 82,
    confidenceLevel: 'HIGH',
    alertState: 'CRITICAL',
    observedAlertState: 'CRITICAL',
    predictiveAlertState: 'NORMAL',
    method: 'AIR_SCREEN_V1',
    rulesetVersion: 'AIR_SCREEN_V1',
    supportingEvidence: [
      { parameter: 'station_persistence', consecutivePm25AboveThreshold: 6, fractionAbove80Percent: 0.83 },
      { kind: 'PREDICTED', predictedValue: 96, lowerBound: 82, upperBound: 110 },
    ],
    missingInputs: [],
    factors: [],
    calculatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const values = {
  pm25: { value: 104, unit: 'µg/m³', qualityState: 'VALID' },
  pm10: { value: 196, unit: 'µg/m³', qualityState: 'VALID' },
  no2: { value: 61, unit: 'µg/m³', qualityState: 'VALID' },
};

const conditions = { windSpeedKmh: 5, windDirectionDeg: 240, precipitationMm: 0, dispersion: 'Poor' };

describe('simulation recommendations', () => {
  it('explains a critical air recommendation with the reading and its reason', () => {
    const items = buildSimulationRecommendations({
      scenario: 'gradual_pm25',
      category: 'air',
      step: 12,
      totalSteps: 24,
      stationName: 'Test monitor',
      risk: risk(),
      values,
      conditions,
    });
    const first = items[0];
    expect(first.priority).toBe('IMMEDIATE');
    expect(first.audience).toBe('PUBLIC');
    expect(first.reason).toContain('104');
    expect(first.reason).toContain('6 consecutive');
    expect(items.some((item) => item.audience === 'FIELD' && item.reason.includes('Poor'))).toBe(true);
  });

  it('prioritises a maintenance check and suppresses public alarm for a suspect sensor', () => {
    const items = buildSimulationRecommendations({
      scenario: 'sensor_malfunction',
      category: 'air',
      step: 6,
      totalSteps: 12,
      stationName: 'Test monitor',
      risk: risk({ alertState: 'NORMAL', riskScore: null, riskLevel: 'UNKNOWN', confidenceScore: 32, confidenceLevel: 'LOW' }),
      values: { pm25: { value: 997.4, unit: 'µg/m³', qualityState: 'SUSPECT' } },
      conditions,
      suppressAlert: true,
    });
    expect(items[0].title.toLowerCase()).toContain('maintenance');
    expect(items.some((item) => item.title.toLowerCase().includes('do not issue'))).toBe(true);
    expect(items.every((item) => !item.reason.includes('environmental deterioration'))).toBe(true);
  });

  it('ties construction-dust advice to the PM10/PM2.5 contrast', () => {
    const items = buildSimulationRecommendations({
      scenario: 'construction_dust',
      category: 'air',
      step: 6,
      totalSteps: 16,
      stationName: 'Test monitor',
      risk: risk(),
      values: {
        pm25: { value: 76, unit: 'µg/m³', qualityState: 'VALID' },
        pm10: { value: 302, unit: 'µg/m³', qualityState: 'VALID' },
      },
      conditions,
    });
    const dust = items.find((item) => item.title.toLowerCase().includes('dust controls'));
    expect(dust?.reason).toContain('PM10');
    expect(dust?.reason).toContain('PM2.5');
    expect(items.some((item) => item.title.toLowerCase().includes('screening lead'))).toBe(true);
  });

  it('adds mixed-pollutant and neutral-enforcement advice for a firecracker burst', () => {
    const items = buildSimulationRecommendations({
      scenario: 'festival_firecracker',
      category: 'air',
      step: 5,
      totalSteps: 14,
      stationName: 'Test monitor',
      risk: risk(),
      values: {
        pm25: { value: 220, unit: 'µg/m³', qualityState: 'VALID' },
        so2: { value: 105, unit: 'µg/m³', qualityState: 'VALID' },
      },
      conditions,
    });
    expect(items.some((item) => item.title.toLowerCase().includes('firecracker smoke'))).toBe(true);
    expect(items.some((item) => item.reason.includes('SO₂'))).toBe(true);
    expect(items.some((item) => item.title.toLowerCase().includes('enforcement language'))).toBe(true);
  });

  it('adds overflow contact advice and an outfall inspection for drain overflow', () => {
    const items = buildSimulationRecommendations({
      scenario: 'monsoon_drain_overflow',
      category: 'water',
      step: 5,
      totalSteps: 12,
      stationName: 'Test outfall',
      risk: risk({ category: 'water', riskScore: 78, alertState: 'CRITICAL', observedAlertState: 'CRITICAL' }),
      values: {
        ph: { value: 5.9, unit: 'pH', qualityState: 'VALID' },
        do: { value: 2.8, unit: 'mg/L', qualityState: 'VALID' },
        turbidity: { value: 190, unit: 'NTU', qualityState: 'VALID' },
      },
      conditions,
    });
    expect(items.some((item) => item.title.toLowerCase().includes('drain overflow'))).toBe(true);
    expect(items.some((item) => item.title.toLowerCase().includes('overflowing outfall'))).toBe(true);
    expect(items.some((item) => item.reason.includes('Turbidity'))).toBe(true);
  });

  it('keeps industrial advice relative and explicitly non-regulatory', () => {
    const items = buildSimulationRecommendations({
      scenario: 'industrial_emission',
      category: 'industrial',
      step: 12,
      totalSteps: 16,
      stationName: 'Stack monitor',
      risk: risk({ category: 'industrial', riskScore: 72, riskLevel: 'HIGH', alertState: 'WATCH', observedAlertState: 'WATCH' }),
      values: {
        stack_pm: { value: 96, unit: 'mg/Nm³', qualityState: 'VALID' },
        stack_nox: { value: 230, unit: 'mg/Nm³', qualityState: 'VALID' },
      },
      conditions,
    });
    expect(items.some((item) => item.title.toLowerCase().includes('stack check'))).toBe(true);
    expect(items.some((item) => [...item.evidence, item.reason].join(' ').includes('legal emission threshold'))).toBe(true);
  });
});
