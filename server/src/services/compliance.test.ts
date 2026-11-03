import { describe, expect, it } from 'vitest';
import { compareObservation, type StandardLike } from './compliance.js';

const observation = {
  value: 70,
  unit: 'µg/m³',
  observed_at: '2026-01-01T10:00:00Z',
  quality_state: 'VALID',
  source_id: 'demo-network',
  is_simulated: true,
};

const pm25Standard: StandardLike = {
  parameter: 'PM2.5',
  parameter_code: 'pm25',
  operator: '<=',
  threshold_value: 60,
  threshold_max: null,
  unit: 'µg/m³',
  averaging_period: '24 hours',
  applicability: 'Ambient air',
  section_ref: 'NAAQS 2009 — PM2.5',
};

describe('compliance comparability', () => {
  it('refuses to compare an hourly observation with a 24-hour standard', () => {
    const result = compareObservation('AIR_CAAQMS', observation, pm25Standard);
    expect(result.comparability).toBe('NOT_COMPARABLE_AVERAGING');
    expect(result.indicative).toBe('NOT_ASSESSED');
    expect(result.label).toMatch(/NOT COMPARABLE/);
  });

  it('rejects unit mismatch without converting', () => {
    const result = compareObservation('AIR_CAAQMS', { ...observation, unit: 'mg/m³' }, pm25Standard);
    expect(result.comparability).toBe('NOT_COMPARABLE_UNIT');
  });

  it('does not apply effluent standards to stack readings', () => {
    const result = compareObservation(
      'INDUSTRIAL_STACK',
      { ...observation, unit: 'mg/L', value: 40 },
      { ...pm25Standard, unit: 'mg/L', parameter: 'BOD', averaging_period: 'effluent sample' },
    );
    expect(result.comparability).toBe('NOT_APPLICABLE_SOURCE_TYPE');
  });

  it('can flag a potential concern for a comparable grab-sample reference', () => {
    const result = compareObservation(
      'WATER_SAMPLING',
      { ...observation, unit: 'pH', value: 5.4 },
      {
        parameter: 'pH',
        parameter_code: 'ph',
        operator: 'range',
        threshold_value: 6.5,
        threshold_max: 8.5,
        unit: 'pH',
        averaging_period: 'grab sample',
        applicability: 'Outdoor bathing',
        section_ref: 'CPCB Water Quality Criteria',
      },
    );
    expect(result.comparability).toBe('COMPARABLE_REFERENCE');
    expect(result.indicative).toBe('ABOVE_REFERENCE');
    expect(result.label).toMatch(/POTENTIAL COMPLIANCE CONCERN/);
  });
});
