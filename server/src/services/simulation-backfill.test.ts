import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RiskAssessmentResult } from '../types.js';

vi.mock('../db/pool.js', () => ({
  one: vi.fn(),
  query: vi.fn(),
}));

import { one, query } from '../db/pool.js';
import { backfillSimulationSession } from './simulation-backfill.js';

const mockedOne = vi.mocked(one);
const mockedQuery = vi.mocked(query);

const risk: RiskAssessmentResult = {
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
  supportingEvidence: [],
  missingInputs: [],
  factors: [],
  calculatedAt: new Date().toISOString(),
};

describe('simulation backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds recommendations to an old event and marks the session', async () => {
    mockedOne.mockResolvedValueOnce({
      id: 'session-1',
      scenario: 'sudden_spike',
      category: 'air',
      total_steps: 14,
      recommendations_version: 0,
      station_name: 'Test monitor',
    } as never);
    mockedQuery.mockResolvedValueOnce([
      {
        step: 4,
        payload: {
          step: 4,
          values: {
            pm25: { value: 120, unit: 'µg/m³', qualityState: 'VALID' },
            pm10: { value: 230, unit: 'µg/m³', qualityState: 'VALID' },
          },
          risk,
          suppressAlert: false,
        },
      },
    ] as never);
    mockedQuery.mockResolvedValue([] as never);

    const result = await backfillSimulationSession('session-1');

    expect(result).toEqual({ sessions: 1, events: 1 });
    const update = mockedQuery.mock.calls.find(([sql]) => String(sql).includes('jsonb_set'));
    expect(update).toBeTruthy();
    const params = update?.[1] as unknown[] | undefined;
    const recommendations = JSON.parse(String(params?.[2]));
    expect(Array.isArray(recommendations)).toBe(true);
    expect(recommendations[0].reason).toContain('PM2.5');
    expect(mockedQuery.mock.calls.some(([sql]) => String(sql).includes('recommendations_version=1'))).toBe(true);
  });

  it('is idempotent for events that already carry recommendations', async () => {
    mockedOne.mockResolvedValueOnce({
      id: 'session-1',
      scenario: 'sudden_spike',
      category: 'air',
      total_steps: 14,
      recommendations_version: 1,
      station_name: 'Test monitor',
    } as never);
    mockedQuery.mockResolvedValueOnce([
      { step: 0, payload: { step: 0, values: {}, risk, recommendations: [] } },
    ] as never);
    mockedQuery.mockResolvedValue([] as never);

    const result = await backfillSimulationSession('session-1');

    expect(result).toEqual({ sessions: 1, events: 0 });
    expect(mockedQuery.mock.calls.some(([sql]) => String(sql).includes('jsonb_set'))).toBe(false);
  });
});
