import { describe, expect, it } from 'vitest';
import { assessAir, assessIndustrial, assessWater, assessWaste, type AirRiskInput, type LatestReading } from './risk-engine.js';
import { baselineForecast } from './forecast.js';

const now = new Date('2026-01-01T12:00:00Z');

function reading(value: number, observedAt = '2026-01-01T11:00:00Z'): LatestReading {
  return { value, unit: 'µg/m³', observedAt, qualityState: 'VALID', sourceId: 'demo-network', isSimulated: true };
}

function airInput(overrides: Partial<AirRiskInput> = {}): AirRiskInput {
  const history = Array.from({ length: 6 }, (_, index) => ({
    observedAt: new Date(now.getTime() - (6 - index) * 3_600_000).toISOString(),
    value: 70,
  }));
  return {
    stationId: '00000000-0000-0000-0000-000000000001',
    stationName: 'Test station',
    isSimulated: true,
    latest: { pm25: reading(70), pm10: reading(150), no2: reading(30), so2: reading(10), co: reading(0.8), o3: reading(40) },
    pm25History: history,
    forecastPm25: baselineForecast(history, 3, now),
    healthStatus: 'ONLINE',
    weather: { windSpeedKmh: 10, windDirectionDeg: 200, observedAt: '2026-01-01T11:00:00Z' },
    now,
    ...overrides,
  };
}

describe('air risk engine', () => {
  it('raises a critical screening state after three consecutive values at the threshold', () => {
    const result = assessAir(airInput());
    expect(result.observedAlertState).toBe('CRITICAL');
    expect(result.alertState).toBe('CRITICAL');
    expect(result.riskScore).toBeGreaterThanOrEqual(75);
    expect(result.supportingEvidence.some((e) => String(e.note).includes('not an official exceedance'))).toBe(true);
  });

  it('does not raise a critical state from a single spike', () => {
    const history = Array.from({ length: 6 }, (_, index) => ({
      observedAt: new Date(now.getTime() - (6 - index) * 3_600_000).toISOString(),
      value: index === 5 ? 80 : 30,
    }));
    const result = assessAir(airInput({ pm25History: history, latest: { ...airInput().latest, pm25: reading(80), pm10: reading(70) } }));
    expect(result.observedAlertState).not.toBe('CRITICAL');
  });

  it('returns UNKNOWN rather than normal when no readings exist', () => {
    const result = assessAir(airInput({ latest: {}, pm25History: [], forecastPm25: null, healthStatus: 'OFFLINE' }));
    expect(result.riskScore).toBeNull();
    expect(result.riskLevel).toBe('UNKNOWN');
    expect(result.missingInputs.length).toBeGreaterThan(0);
  });

  it('suppresses critical and predictive alerts for SUSPECT readings', () => {
    const suspect = { ...reading(80), qualityState: 'SUSPECT' };
    const result = assessAir(
      airInput({
        latest: { pm25: suspect, pm10: { ...reading(160), qualityState: 'SUSPECT' } },
        pm25History: Array.from({ length: 6 }, (_, index) => ({
          observedAt: new Date(now.getTime() - (6 - index) * 3_600_000).toISOString(),
          value: 80,
        })),
      }),
    );
    expect(result.observedAlertState).not.toBe('CRITICAL');
    expect(result.predictiveAlertState).not.toBe('EARLY_WARNING');
    expect(result.missingInputs.some((item) => item.includes('SUSPECT'))).toBe(true);
  });

  it('keeps confidence separate from severity and records missing inputs', () => {
    const result = assessAir(airInput({ latest: { pm25: reading(80) }, healthStatus: 'DEGRADED' }));
    expect(result.riskScore).not.toBeNull();
    expect(result.confidenceScore).not.toBeNull();
    expect(result.missingInputs.length).toBeGreaterThan(0);
    expect(result.confidenceLevel).toMatch(/LOW|MEDIUM|HIGH/);
  });
});

describe('water risk engine', () => {
  it('does not make a mild pH/DO excursion critical', () => {
    const result = assessWater({
      siteId: '00000000-0000-0000-0000-000000000002',
      siteName: 'Water site',
      isSimulated: true,
      latest: {
        ph: { value: 6.2, unit: 'pH', observedAt: '2026-01-01T10:00:00Z', qualityState: 'VALID', sourceId: 'demo-network', isSimulated: true },
        do: { value: 4.1, unit: 'mg/L', observedAt: '2026-01-01T10:00:00Z', qualityState: 'VALID', sourceId: 'demo-network', isSimulated: true },
        turbidity: { value: 20, unit: 'NTU', observedAt: '2026-01-01T10:00:00Z', qualityState: 'VALID', sourceId: 'demo-network', isSimulated: true },
      },
      verifiedReports7d: 0,
      unverifiedReports7d: 1,
      now,
    });
    expect(result.alertState).toBe('WATCH');
  });

  it('can reach a critical state only with severe pH and DO conditions', () => {
    const result = assessWater({
      siteId: '00000000-0000-0000-0000-000000000003',
      siteName: 'Water site',
      isSimulated: true,
      latest: {
        ph: { value: 5.4, unit: 'pH', observedAt: '2026-01-01T10:00:00Z', qualityState: 'VALID', sourceId: 'demo-network', isSimulated: true },
        do: { value: 2.5, unit: 'mg/L', observedAt: '2026-01-01T10:00:00Z', qualityState: 'VALID', sourceId: 'demo-network', isSimulated: true },
        turbidity: { value: 70, unit: 'NTU', observedAt: '2026-01-01T10:00:00Z', qualityState: 'VALID', sourceId: 'demo-network', isSimulated: true },
      },
      verifiedReports7d: 0,
      unverifiedReports7d: 0,
      now,
    });
    expect(result.alertState).toBe('CRITICAL');
  });
});

describe('waste and industrial risk engines', () => {
  it('does not make one unverified waste complaint critical', () => {
    const result = assessWaste({
      localityId: '00000000-0000-0000-0000-000000000004',
      localityName: 'Test locality',
      reports7d: [{ id: 'r1', status: 'AWAITING_VERIFICATION', verificationState: 'UNVERIFIED', evidenceCount: 1, distanceM: 100, submittedAt: '2026-01-01T10:00:00Z' }],
      criticalIncidents: 0,
      now,
    });
    expect(result.alertState).not.toBe('CRITICAL');
  });

  it('treats two verified reports as a repeat hotspot', () => {
    const result = assessWaste({
      localityId: '00000000-0000-0000-0000-000000000005',
      localityName: 'Test locality',
      reports7d: [
        { id: 'r1', status: 'VERIFIED', verificationState: 'VERIFIED', evidenceCount: 1, distanceM: 80, submittedAt: '2026-01-01T10:00:00Z' },
        { id: 'r2', status: 'VERIFIED', verificationState: 'VERIFIED', evidenceCount: 1, distanceM: 120, submittedAt: '2026-01-01T11:00:00Z' },
      ],
      criticalIncidents: 0,
      now,
    });
    expect(result.alertState).toBe('CRITICAL');
    expect(result.riskScore).toBeGreaterThanOrEqual(75);
  });

  it('does not apply a legal threshold to industrial readings', () => {
    const result = assessIndustrial({
      siteId: '00000000-0000-0000-0000-000000000006',
      siteName: 'Test stack',
      isSimulated: true,
      latest: {
        stack_pm: { value: 120, unit: 'mg/Nm³', observedAt: '2026-01-01T10:00:00Z', qualityState: 'VALID', sourceId: 'demo-network', isSimulated: true },
      },
      baseline: { stack_pm: 40 },
      verifiedReports7d: 0,
      openIncidents: 0,
      now,
    });
    expect(result.method).toMatch(/No legal threshold applied/i);
    expect(result.supportingEvidence.some((e) => String(e.note).includes('No legal emission threshold'))).toBe(true);
  });
});
