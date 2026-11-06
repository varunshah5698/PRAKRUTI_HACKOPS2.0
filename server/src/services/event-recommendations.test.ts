import { describe, expect, it } from 'vitest';
import { buildRecommendationDrafts } from './event-recommendations.js';

describe('event recommendation rule engine', () => {
  it('creates separate citizen and authority drafts for a flood event', () => {
    const drafts = buildRecommendationDrafts({
      category: 'URBAN_FLOOD',
      severity: 'HIGH',
      title: 'Mumbai flood',
      evidenceCount: 3,
    });
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.audience)).toEqual(['CITIZEN', 'AUTHORITY']);
    expect(drafts[0].recommendationKey).toContain('flood');
    expect(drafts[1].recommendationKey).toContain('flood');
    expect(drafts.every((draft) => draft.urgency === 'HIGH')).toBe(true);
    expect(drafts[0].reason).toContain('3 linked evidence');
  });

  it('escalates urgency with event severity', () => {
    const drafts = buildRecommendationDrafts({
      category: 'CYCLONE',
      severity: 'CRITICAL',
      title: 'Cyclone',
      evidenceCount: 1,
    });
    expect(drafts.every((draft) => draft.urgency === 'CRITICAL')).toBe(true);
    expect(drafts.every((draft) => draft.timeframe.includes('Immediate'))).toBe(true);
  });

  it('uses category-specific citizen safety guidance', () => {
    const drafts = buildRecommendationDrafts({
      category: 'HEATWAVE',
      severity: 'MODERATE',
      title: 'Heatwave',
      evidenceCount: 2,
    });
    expect(drafts[0].action).toContain('water');
    expect(drafts[0].recommendationKey).toBe('citizen-heat-safety');
  });
});
