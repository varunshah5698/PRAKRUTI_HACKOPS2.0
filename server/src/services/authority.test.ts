import { describe, expect, it } from 'vitest';
import { canTransitionAuthorityStatus } from '../types.js';

describe('authority event lifecycle', () => {
  it('allows the documented happy path', () => {
    const path = [
      'READY_FOR_REVIEW',
      'AUTHORITY_NOTIFIED',
      'ACKNOWLEDGED',
      'VERIFIED',
      'ACTION_INITIATED',
      'RESOLVED',
      'CLOSED',
    ] as const;
    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransitionAuthorityStatus(path[index], path[index + 1])).toBe(true);
    }
  });

  it('rejects skipping verification and reopening closed cases', () => {
    expect(canTransitionAuthorityStatus('AUTHORITY_NOTIFIED', 'VERIFIED')).toBe(false);
    expect(canTransitionAuthorityStatus('CLOSED', 'ACKNOWLEDGED')).toBe(false);
    expect(canTransitionAuthorityStatus('REJECTED', 'ACKNOWLEDGED')).toBe(false);
  });

  it('allows escalation from an acknowledged or investigated case', () => {
    expect(canTransitionAuthorityStatus('ACKNOWLEDGED', 'ESCALATED')).toBe(true);
    expect(canTransitionAuthorityStatus('UNDER_INVESTIGATION', 'ESCALATED')).toBe(true);
    expect(canTransitionAuthorityStatus('ESCALATED', 'ACKNOWLEDGED')).toBe(true);
  });
});
