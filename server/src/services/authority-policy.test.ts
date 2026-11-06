import { describe, expect, it } from 'vitest';
import { authorityDeadlines, matchAuthorities, type AuthorityMatchCandidate } from './authority-policy.js';

const candidates: AuthorityMatchCandidate[] = [
  {
    id: 'bmc',
    code: 'bmc-dm',
    name: 'BMC Disaster Management',
    level: 'MUNICIPAL',
    coverage_state: 'Maharashtra',
    coverage_district: 'Mumbai',
    coverage_city: 'Mumbai',
  },
  {
    id: 'sdma',
    code: 'maharashtra-sdma',
    name: 'Maharashtra SDMA',
    level: 'STATE',
    coverage_state: 'Maharashtra',
    coverage_district: null,
    coverage_city: null,
  },
  {
    id: 'thane',
    code: 'thane-dm',
    name: 'Thane Disaster Management',
    level: 'DISTRICT',
    coverage_state: 'Maharashtra',
    coverage_district: 'Thane',
    coverage_city: null,
  },
];

describe('authority jurisdiction matching', () => {
  it('matches city and state from a comma-separated admin area', () => {
    const matches = matchAuthorities({ adminArea: 'Mumbai, Maharashtra', latitude: 19.07, longitude: 72.87 }, candidates);
    expect(matches.map((match) => match.code)).toEqual(['bmc-dm', 'maharashtra-sdma']);
  });

  it('does not turn nearby place names into a Mumbai match', () => {
    expect(
      matchAuthorities({ adminArea: 'Navi Mumbai, Maharashtra', latitude: 19.03, longitude: 73.02 }, candidates).map(
        (match) => match.code,
      ),
    ).toEqual(['maharashtra-sdma']);
    expect(
      matchAuthorities({ adminArea: 'Mumbai Suburban, Maharashtra', latitude: 19.12, longitude: 72.85 }, candidates).map(
        (match) => match.code,
      ),
    ).toEqual(['maharashtra-sdma']);
  });

  it('uses a polygon match above text coverage', () => {
    const withPolygon = candidates.map((candidate) =>
      candidate.id === 'thane' ? { ...candidate, polygon_match: true } : candidate,
    );
    const matches = matchAuthorities({ adminArea: 'Mumbai, Maharashtra', latitude: 19.07, longitude: 72.87 }, withPolygon);
    expect(matches[0].code).toBe('thane-dm');
    expect(matches[0].reason).toContain('polygon');
  });

  it('returns nothing when there is no admin area or polygon match', () => {
    expect(matchAuthorities({ adminArea: null, latitude: 19.07, longitude: 72.87 }, candidates)).toEqual([]);
    expect(matchAuthorities({ adminArea: 'Unknown place', latitude: null, longitude: null }, candidates)).toEqual([]);
  });

  it('sets shorter deadlines for more severe events', () => {
    const now = new Date('2026-11-06T00:00:00.000Z');
    const critical = authorityDeadlines('CRITICAL', now);
    const normal = authorityDeadlines('NORMAL', now);
    expect(critical.acknowledgementDueAt.toISOString()).toBe('2026-11-06T01:00:00.000Z');
    expect(critical.resolutionDueAt.toISOString()).toBe('2026-11-07T00:00:00.000Z');
    expect(normal.acknowledgementDueAt.getTime()).toBeGreaterThan(critical.acknowledgementDueAt.getTime());
  });
});
