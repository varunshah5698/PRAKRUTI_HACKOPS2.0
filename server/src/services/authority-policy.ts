import type { AuthorityLevel, EventSeverity } from '../types.js';

export interface AuthorityMatchCandidate {
  id: string;
  code: string;
  name: string;
  level: AuthorityLevel;
  coverage_state: string | null;
  coverage_district: string | null;
  coverage_city: string | null;
  polygon_match?: boolean;
}

export interface AuthorityMatch {
  authorityId: string;
  code: string;
  name: string;
  level: AuthorityLevel;
  reason: string;
  specificity: number;
}

export interface AuthorityDeadlines {
  acknowledgementDueAt: Date;
  resolutionDueAt: Date;
}

const HOUR_MS = 60 * 60 * 1000;

export function authoritySlaHours(severity: EventSeverity): { acknowledgement: number; resolution: number } {
  switch (severity) {
    case 'CRITICAL':
      return { acknowledgement: 1, resolution: 24 };
    case 'HIGH':
      return { acknowledgement: 4, resolution: 72 };
    case 'MODERATE':
      return { acknowledgement: 12, resolution: 168 };
    default:
      return { acknowledgement: 24, resolution: 336 };
  }
}

export function authorityDeadlines(
  severity: EventSeverity,
  from: Date = new Date(),
): AuthorityDeadlines {
  const hours = authoritySlaHours(severity);
  return {
    acknowledgementDueAt: new Date(from.getTime() + hours.acknowledgement * HOUR_MS),
    resolutionDueAt: new Date(from.getTime() + hours.resolution * HOUR_MS),
  };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function segments(adminArea: string): string[] {
  return adminArea
    .split(',')
    .map(normalize)
    .filter((value) => value.length >= 2);
}

/**
 * Exact area-token matching. Substring matching is deliberately avoided:
 * "Mumbai Suburban" or "Navi Mumbai" must not silently become "Mumbai".
 * A polygon match is stronger and uses the stored PostGIS geometry.
 */
export function matchAuthorities(
  input: { adminArea: string | null; latitude: number | null; longitude: number | null },
  candidates: AuthorityMatchCandidate[],
): AuthorityMatch[] {
  const areas = input.adminArea ? segments(input.adminArea) : [];
  const matches: AuthorityMatch[] = [];

  for (const candidate of candidates) {
    let best: AuthorityMatch | null = null;
    const add = (specificity: number, reason: string) => {
      if (!best || specificity > best.specificity) {
        best = {
          authorityId: candidate.id,
          code: candidate.code,
          name: candidate.name,
          level: candidate.level,
          reason,
          specificity,
        };
      }
    };

    if (candidate.polygon_match) {
      add(100, 'Event point is inside the stored jurisdiction polygon.');
    }
    if (candidate.coverage_city) {
      const city = normalize(candidate.coverage_city);
      if (city.length >= 2 && areas.includes(city)) {
        add(40, `Coverage city matches "${candidate.coverage_city}".`);
      }
    }
    if (candidate.coverage_district) {
      const district = normalize(candidate.coverage_district);
      if (district.length >= 2 && areas.includes(district)) {
        add(30, `Coverage district matches "${candidate.coverage_district}".`);
      }
    }
    if (candidate.coverage_state) {
      const state = normalize(candidate.coverage_state);
      const stateWide = candidate.level === 'STATE' || candidate.level === 'NATIONAL';
      if (stateWide && state.length >= 2 && areas.includes(state)) {
        add(20, `Coverage state matches "${candidate.coverage_state}".`);
      }
    }

    if (best) matches.push(best);
  }

  return matches.sort((a, b) => b.specificity - a.specificity || a.code.localeCompare(b.code));
}
