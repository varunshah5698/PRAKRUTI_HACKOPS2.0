import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import {
  addEvidence,
  correlateEvents,
  createEvent,
  getEventOrThrow,
  linkSource,
  listEvidence,
  listEvents,
  transitionEvent,
} from './event-intelligence.js';

const enabled = process.env.EVENT_TEST_DB === '1';

async function clean() {
  await query(
    'TRUNCATE recommendation_evidence, action_recommendations, event_forecasts, event_analysis_evidence, event_analysis, event_timeline, event_correlations, event_evidence, event_links, disaster_events RESTART IDENTITY CASCADE',
  );
}

describe.skipIf(!enabled)('event intelligence database foundation', () => {
  beforeAll(clean);
  afterAll(async () => {
    await clean();
    await closePool();
  });

  it('creates an event idempotently by event key', async () => {
    const input = {
      eventKey: 'test:flood:1',
      category: 'URBAN_FLOOD' as const,
      title: 'Test urban flood',
      severity: 'HIGH' as const,
      latitude: 19.076,
      longitude: 72.8777,
      detectionSource: 'test',
    };
    const first = await createEvent(input);
    const second = await createEvent(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.event.id).toBe(first.event.id);
  });

  it('deduplicates evidence and preserves the raw content', async () => {
    const event = await createEvent({
      eventKey: 'test:evidence:1',
      category: 'EXTREME_RAINFALL' as const,
      title: 'Evidence test',
      latitude: 19.0,
      longitude: 72.8,
    });
    const raw = { rainfall_mm: 42, source: 'test' };
    const first = await addEvidence(event.event.id, {
      evidenceType: 'WEATHER_OBSERVATION',
      sourceId: 'test-source',
      sourceRecordId: 'record-1',
      title: 'Rainfall observation',
      rawContent: raw,
    });
    const second = await addEvidence(event.event.id, {
      evidenceType: 'WEATHER_OBSERVATION',
      sourceId: 'test-source',
      sourceRecordId: 'record-1',
      title: 'Rainfall observation duplicate',
      rawContent: raw,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.evidence.id).toBe(first.evidence.id);
    expect(first.evidence.raw_content).toEqual(raw);
    const visible = await listEvidence(event.event.id, 'SYSTEM_ADMIN');
    expect(visible).toHaveLength(1);
  });

  it('deduplicates links and correlations and enforces the timeline trigger', async () => {
    const a = await createEvent({
      eventKey: 'test:correlation:a',
      category: 'URBAN_FLOOD' as const,
      title: 'Mumbai flood A',
      latitude: 19.1,
      longitude: 72.9,
    });
    const b = await createEvent({
      eventKey: 'test:correlation:b',
      category: 'URBAN_FLOOD' as const,
      title: 'Mumbai flood B',
      latitude: 19.2,
      longitude: 73.0,
    });
    const link1 = await linkSource(a.event.id, { entityType: 'EXTERNAL', entityId: 'ext-1', relationship: 'SOURCE' });
    const link2 = await linkSource(a.event.id, { entityType: 'EXTERNAL', entityId: 'ext-1', relationship: 'SOURCE' });
    expect(link1.created).toBe(true);
    expect(link2.created).toBe(false);
    const correlation1 = await correlateEvents(a.event.id, b.event.id, { relationship: 'POSSIBLY_RELATED', confidence: 0.7 });
    const correlation2 = await correlateEvents(b.event.id, a.event.id, { relationship: 'POSSIBLY_RELATED', confidence: 0.7 });
    expect(correlation1.created).toBe(true);
    expect(correlation2.created).toBe(false);
    await expect(transitionEvent(a.event.id, 'EVIDENCE_COLLECTED', { type: 'SYSTEM' })).resolves.toBeTruthy();
    const timeline = await query<{ id: string }>('SELECT id FROM event_timeline LIMIT 1');
    await expect(query('UPDATE event_timeline SET summary=$2 WHERE id=$1', [timeline[0].id, 'tampered'])).rejects.toThrow();
  });

  it('supports filters and returns event counts', async () => {
    await createEvent({
      eventKey: 'test:filter:1',
      category: 'HEATWAVE' as const,
      title: 'Filterable event',
      severity: 'CRITICAL' as const,
      latitude: 19.2,
      longitude: 72.9,
    });
    const listed = await listEvents({ category: 'HEATWAVE', page: 1, pageSize: 10 });
    expect(listed.total).toBeGreaterThan(0);
    expect(listed.events.every((event) => event.category === 'HEATWAVE')).toBe(true);
    const detail = await getEventOrThrow(listed.events[0].id);
    expect(detail.evidence_count).toBe(0);
  });
});
