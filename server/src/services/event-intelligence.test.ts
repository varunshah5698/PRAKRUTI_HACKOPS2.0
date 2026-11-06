import { describe, expect, it } from 'vitest';
import { canTransitionEvent, hashContent, makeEventKey } from './event-intelligence.js';

describe('event intelligence foundation helpers', () => {
  it('builds deterministic event keys for the same category, location and time bucket', () => {
    const input = {
      category: 'URBAN_FLOOD' as const,
      latitude: 19.076,
      longitude: 72.8777,
      startAt: '2026-11-05T10:00:00Z',
    };
    const a = makeEventKey(input);
    const b = makeEventKey({ ...input, startAt: '2026-11-05T11:00:00Z' });
    const c = makeEventKey({ ...input, startAt: '2026-11-05T14:00:00Z' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('uses an explicit or source record identifier when supplied', () => {
    const base = {
      category: 'CYCLONE' as const,
      latitude: 19.076,
      longitude: 72.8777,
    };
    expect(makeEventKey({ ...base, explicitKey: 'manual-cyclone-1' })).toBe('manual-cyclone-1');
    expect(makeEventKey({ ...base, sourceId: 'imd', sourceRecordId: 'warning-123' })).toBe('imd:warning-123');
  });

  it('rejects self and authority transitions during Phase 1', () => {
    expect(canTransitionEvent('DETECTED', 'EVIDENCE_COLLECTED')).toBe(true);
    expect(canTransitionEvent('EVIDENCE_COLLECTED', 'READY_FOR_REVIEW')).toBe(true);
    expect(canTransitionEvent('DETECTED', 'ACKNOWLEDGED')).toBe(false);
    expect(canTransitionEvent('READY_FOR_REVIEW', 'VERIFIED')).toBe(false);
  });

  it('hashes semantic JSON content stably', () => {
    const a = hashContent({ b: 2, a: 1 });
    const b = hashContent({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(hashContent({ a: 2 })).not.toBe(a);
    expect(hashContent(null)).toBeNull();
  });
});
