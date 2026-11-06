import { describe, expect, it } from 'vitest';
import { renderAuthorityEventEmail } from './email.js';

describe('authority event email', () => {
  it('names the authority and avoids claiming an official warning', () => {
    const email = renderAuthorityEventEmail({
      eventId: 'event-1',
      title: 'Mumbai flood',
      category: 'URBAN_FLOOD',
      severity: 'HIGH',
      status: 'EVIDENCE_COLLECTED',
      adminArea: 'Mumbai, Maharashtra',
      detectedAt: '2026-11-06T00:00:00.000Z',
      evidenceCount: 3,
      authorityName: 'BMC Disaster Management',
      appUrl: 'https://example.test',
    });
    expect(email.subject).toContain('Authority event assignment');
    expect(email.subject).toContain('URBAN FLOOD');
    expect(email.html).toContain('BMC Disaster Management');
    expect(email.html).toContain('https://example.test/authority');
    expect(email.html).toContain('not an official warning');
    expect(email.html).toContain('3 record(s)');
  });
});
