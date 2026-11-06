import { createHash } from 'node:crypto';
import { one, query, withTransaction } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../middleware/errors.js';
import {
  EVENT_CATEGORIES,
  EVENT_ENTITY_TYPES,
  EVENT_SEVERITIES,
  EVENT_STATUSES,
  EVENT_TIMELINE_ENTRY_TYPES,
  EVIDENCE_FRESHNESS_STATUSES,
  EVIDENCE_RELIABILITY_CLASSES,
  EVIDENCE_TYPES,
  EVIDENCE_VERIFICATION_STATUSES,
  EVENT_TRANSITIONS,
  type EventCategory,
  type EventEntityType,
  type EventSeverity,
  type EventStatus,
  type EventTimelineEntryType,
  type EvidenceFreshnessStatus,
  type EvidenceReliabilityClass,
  type EvidenceType,
  type EvidenceVerificationStatus,
} from '../types.js';

export interface EventActor {
  id?: string | null;
  type: 'SYSTEM' | 'USER';
}

export interface CreateEventInput {
  eventKey?: string;
  category: EventCategory;
  title: string;
  description?: string | null;
  severity?: EventSeverity;
  startAt?: string | null;
  lastObservedAt?: string | null;
  detectedAt?: string | null;
  latitude: number;
  longitude: number;
  affectedArea?: unknown | null;
  adminArea?: string | null;
  confidence?: number | null;
  dataQuality?: string | null;
  detectionSource?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AddEvidenceInput {
  evidenceType: EvidenceType;
  sourceId?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceRecordId?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  title?: string | null;
  rawContent?: unknown | null;
  observedAt?: string | null;
  publishedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  verificationStatus?: EvidenceVerificationStatus;
  reliabilityClass?: EvidenceReliabilityClass;
  freshnessStatus?: EvidenceFreshnessStatus;
  metadata?: Record<string, unknown>;
}

export interface LinkSourceInput {
  entityType: EventEntityType;
  entityId: string;
  relationship: string;
  confidence?: number | null;
}

export interface CorrelateInput {
  relationship: string;
  confidence?: number | null;
  reason?: string | null;
  distanceM?: number | null;
  timeDeltaSeconds?: number | null;
}

export interface TimelineInput {
  entryType: EventTimelineEntryType;
  summary: string;
  detail?: unknown;
  evidenceIds?: string[];
  occurredAt?: string | null;
  dedupeKey?: string | null;
}

export interface ListEventFilters {
  category?: EventCategory;
  status?: EventStatus;
  severity?: EventSeverity;
  sourceId?: string;
  from?: string;
  to?: string;
  bbox?: [number, number, number, number];
  page: number;
  pageSize: number;
}

export interface DisasterEventRow {
  id: string;
  event_key: string;
  category: EventCategory;
  title: string;
  description: string | null;
  severity: EventSeverity;
  status: EventStatus;
  confidence: number | null;
  data_quality: string | null;
  detection_source: string | null;
  start_at: string | null;
  last_observed_at: string | null;
  detected_at: string;
  closed_at: string | null;
  primary_latitude: number | null;
  primary_longitude: number | null;
  affected_area: unknown | null;
  admin_area: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const EVENT_COLUMNS = `d.id, d.event_key, d.category, d.title, d.description, d.severity, d.status,
  d.confidence::float8 AS confidence, d.data_quality, d.detection_source, d.start_at, d.last_observed_at,
  d.detected_at, d.closed_at, d.admin_area, d.metadata, d.created_at, d.updated_at,
  ST_Y(d.primary_location::geometry)::float8 AS primary_latitude,
  ST_X(d.primary_location::geometry)::float8 AS primary_longitude,
  CASE WHEN d.affected_area IS NULL THEN NULL ELSE ST_AsGeoJSON(d.affected_area)::jsonb END AS affected_area`;

const EVIDENCE_COLUMNS = `e.id, e.event_id, e.evidence_type, e.source_id, e.source_name, e.source_url,
  e.source_record_id, e.source_entity_type, e.source_entity_id, e.title, e.raw_content, e.content_hash,
  e.observed_at, e.published_at, e.retrieved_at, e.verification_status, e.reliability_class,
  e.freshness_status, e.metadata, e.created_at,
  ST_Y(e.location::geometry)::float8 AS latitude, ST_X(e.location::geometry)::float8 AS longitude`;

export function hashContent(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

export function makeEventKey(input: {
  category: EventCategory;
  latitude: number;
  longitude: number;
  startAt?: string | null;
  detectedAt?: string | null;
  sourceId?: string | null;
  sourceRecordId?: string | null;
  explicitKey?: string | null;
}): string {
  if (input.explicitKey?.trim()) return input.explicitKey.trim().slice(0, 240);
  if (input.sourceId?.trim() && input.sourceRecordId?.trim()) {
    return `${input.sourceId.trim()}:${input.sourceRecordId.trim()}`.slice(0, 240);
  }
  const time = Date.parse(input.startAt ?? input.detectedAt ?? '') || Date.now();
  const bucket = Math.floor(time / (3 * 60 * 60_000));
  return `${input.category}:${input.latitude.toFixed(3)}:${input.longitude.toFixed(3)}:${bucket}`;
}

export function canTransitionEvent(current: EventStatus, next: EventStatus): boolean {
  return EVENT_TRANSITIONS[current]?.includes(next) ?? false;
}

function validateCategory(category: string): asserts category is EventCategory {
  if (!EVENT_CATEGORIES.includes(category as EventCategory)) throw badRequest('Invalid event category.');
}

function validateSeverity(severity: string): asserts severity is EventSeverity {
  if (!EVENT_SEVERITIES.includes(severity as EventSeverity)) throw badRequest('Invalid event severity.');
}

function validateStatus(status: string): asserts status is EventStatus {
  if (!EVENT_STATUSES.includes(status as EventStatus)) throw badRequest('Invalid event status.');
}

function validateEvidenceType(value: string): asserts value is EvidenceType {
  if (!EVIDENCE_TYPES.includes(value as EvidenceType)) throw badRequest('Invalid evidence type.');
}

function validateVerification(value: string): asserts value is EvidenceVerificationStatus {
  if (!EVIDENCE_VERIFICATION_STATUSES.includes(value as EvidenceVerificationStatus)) {
    throw badRequest('Invalid evidence verification status.');
  }
}

function validateReliability(value: string): asserts value is EvidenceReliabilityClass {
  if (!EVIDENCE_RELIABILITY_CLASSES.includes(value as EvidenceReliabilityClass)) {
    throw badRequest('Invalid evidence reliability class.');
  }
}

function validateFreshness(value: string): asserts value is EvidenceFreshnessStatus {
  if (!EVIDENCE_FRESHNESS_STATUSES.includes(value as EvidenceFreshnessStatus)) {
    throw badRequest('Invalid evidence freshness status.');
  }
}

function validateEntityType(value: string): asserts value is EventEntityType {
  if (!EVENT_ENTITY_TYPES.includes(value as EventEntityType)) throw badRequest('Invalid linked entity type.');
}

function validateCoordinates(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw badRequest('Invalid latitude.');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw badRequest('Invalid longitude.');
}

function validateConfidence(value: number | null | undefined): void {
  if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw badRequest('Confidence must be between 0 and 1.');
  }
}

async function appendTimelineWithClient(
  client: import('pg').PoolClient,
  eventId: string,
  actor: EventActor,
  entry: TimelineInput,
): Promise<Record<string, unknown>> {
  if (!EVENT_TIMELINE_ENTRY_TYPES.includes(entry.entryType)) throw badRequest('Invalid timeline entry type.');
  const row = await client.query<Record<string, unknown>>(
    `INSERT INTO event_timeline
       (event_id, entry_type, actor_type, actor_user_id, summary, detail, evidence_ids, occurred_at, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::uuid[],COALESCE($8::timestamptz, now()),$9)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id, event_id, entry_type, actor_type, actor_user_id, summary, detail, evidence_ids, occurred_at, created_at`,
    [
      eventId,
      entry.entryType,
      actor.type,
      actor.id ?? null,
      entry.summary,
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
      entry.evidenceIds ?? [],
      entry.occurredAt ?? null,
      entry.dedupeKey ?? null,
    ],
  );
  return row.rows[0] ?? {};
}

export async function appendTimeline(eventId: string, actor: EventActor, entry: TimelineInput): Promise<Record<string, unknown>> {
  return withTransaction(async (client) => {
    await assertEventExists(client, eventId);
    return appendTimelineWithClient(client, eventId, actor, entry);
  });
}

async function assertEventExists(client: import('pg').PoolClient, eventId: string): Promise<void> {
  const result = await client.query('SELECT 1 FROM disaster_events WHERE id=$1', [eventId]);
  if (result.rowCount === 0) throw notFound('Event not found.');
}

const LINK_TABLES: Record<Exclude<EventEntityType, 'EXTERNAL'>, string> = {
  ALERT: 'environmental_alerts',
  INCIDENT: 'environmental_incidents',
  REPORT: 'environmental_reports',
  WEATHER_OBSERVATION: 'weather_observations',
  ENVIRONMENTAL_OBSERVATION: 'environmental_observations',
};

async function assertLinkTargetExists(
  client: import('pg').PoolClient,
  entityType: EventEntityType,
  entityId: string,
): Promise<void> {
  if (entityType === 'EXTERNAL') return;
  const table = LINK_TABLES[entityType];
  if (!table) throw badRequest('Unsupported linked entity type.');
  const result = await client.query(`SELECT 1 FROM ${table} WHERE id::text=$1`, [entityId]);
  if (result.rowCount === 0) throw notFound(`Linked ${entityType} not found.`);
}

export async function createEvent(
  input: CreateEventInput,
  actor: EventActor = { type: 'SYSTEM' },
): Promise<{ event: DisasterEventRow; created: boolean }> {
  validateCategory(input.category);
  validateSeverity(input.severity ?? 'UNKNOWN');
  validateCoordinates(input.latitude, input.longitude);
  validateConfidence(input.confidence);
  if (!input.title.trim()) throw badRequest('Event title is required.');
  if (input.affectedArea && (input.affectedArea as { type?: string }).type !== 'MultiPolygon') {
    throw badRequest('affectedArea must be a GeoJSON MultiPolygon.');
  }
  const eventKey = makeEventKey({
    category: input.category,
    latitude: input.latitude,
    longitude: input.longitude,
    startAt: input.startAt,
    detectedAt: input.detectedAt,
    sourceId: input.detectionSource,
    explicitKey: input.eventKey,
  });

  const result = await withTransaction(async (client) => {
    const inserted = await client.query<DisasterEventRow>(
      `INSERT INTO disaster_events
         (event_key, category, title, description, severity, status, confidence, data_quality, detection_source,
          start_at, last_observed_at, detected_at, primary_location, affected_area, admin_area, metadata)
       VALUES ($1,$2,$3,$4,$5,'DETECTED',$6,$7,$8,
         COALESCE($9::timestamptz, now()), $10::timestamptz, COALESCE($11::timestamptz, now()),
         ST_SetSRID(ST_MakePoint($13,$12),4326)::geography,
         CASE WHEN $14::jsonb IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($14::jsonb),4326)::geometry(MultiPolygon,4326)::geography END,
         $15,$16::jsonb)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING ${EVENT_COLUMNS.replaceAll('d.', '')}`,
      [
        eventKey,
        input.category,
        input.title.trim(),
        input.description ?? null,
        input.severity ?? 'UNKNOWN',
        input.confidence ?? null,
        input.dataQuality ?? null,
        input.detectionSource ?? null,
        input.startAt ?? null,
        input.lastObservedAt ?? null,
        input.detectedAt ?? null,
        input.latitude,
        input.longitude,
        input.affectedArea ? JSON.stringify(input.affectedArea) : null,
        input.adminArea ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    if (inserted.rows[0]) {
      await appendTimelineWithClient(client, inserted.rows[0].id, actor, {
        entryType: 'EVENT_CREATED',
        summary: `Event created: ${input.title.trim()}`,
        detail: { eventKey, category: input.category, severity: input.severity ?? 'UNKNOWN' },
        dedupeKey: `event-created:${inserted.rows[0].id}`,
      });
      return { event: inserted.rows[0], created: true };
    }
    const existing = await client.query<DisasterEventRow>(
      `SELECT ${EVENT_COLUMNS} FROM disaster_events d WHERE d.event_key=$1`,
      [eventKey],
    );
    if (!existing.rows[0]) throw conflict('Event key conflict without an existing event.');
    return { event: existing.rows[0], created: false };
  });

  if (result.created) {
    await audit({
      actorId: actor.id ?? null,
      action: 'EVENT_CREATED',
      entityType: 'disaster_event',
      entityId: result.event.id,
      after: { eventKey, category: input.category, severity: result.event.severity },
    });
  }
  return result;
}

export async function addEvidence(
  eventId: string,
  input: AddEvidenceInput,
  actor: EventActor = { type: 'SYSTEM' },
): Promise<{ evidence: Record<string, unknown>; created: boolean }> {
  validateEvidenceType(input.evidenceType);
  validateVerification(input.verificationStatus ?? 'SOURCE_REPORTED');
  validateReliability(input.reliabilityClass ?? 'UNKNOWN');
  validateFreshness(input.freshnessStatus ?? 'UNKNOWN');
  if (input.latitude !== null && input.latitude !== undefined && input.longitude !== null && input.longitude !== undefined) {
    validateCoordinates(input.latitude, input.longitude);
  }
  const contentHash = hashContent(input.rawContent);

  const result = await withTransaction(async (client) => {
    const event = await client.query<{ id: string; status: EventStatus }>(
      'SELECT id, status FROM disaster_events WHERE id=$1 FOR UPDATE',
      [eventId],
    );
    if (!event.rows[0]) throw notFound('Event not found.');

    const inserted = await client.query<Record<string, unknown>>(
      `INSERT INTO event_evidence
         (event_id, evidence_type, source_id, source_name, source_url, source_record_id, source_entity_type,
          source_entity_id, title, raw_content, content_hash, observed_at, published_at, location,
          verification_status, reliability_class, freshness_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,
         $12::timestamptz,$13::timestamptz,
         CASE WHEN $15::float8 IS NULL OR $16::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($16,$15),4326)::geography END,
         $14,$17,$18,$19::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING ${EVIDENCE_COLUMNS.replaceAll('e.', '')}`,
      [
        eventId,
        input.evidenceType,
        input.sourceId ?? null,
        input.sourceName ?? null,
        input.sourceUrl ?? null,
        input.sourceRecordId ?? null,
        input.sourceEntityType ?? null,
        input.sourceEntityId ?? null,
        input.title ?? null,
        input.rawContent === undefined || input.rawContent === null ? null : JSON.stringify(input.rawContent),
        contentHash,
        input.observedAt ?? null,
        input.publishedAt ?? null,
        input.verificationStatus ?? 'SOURCE_REPORTED',
        input.latitude ?? null,
        input.longitude ?? null,
        input.reliabilityClass ?? 'UNKNOWN',
        input.freshnessStatus ?? 'UNKNOWN',
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    let evidence = inserted.rows[0];
    let created = Boolean(evidence);
    if (!evidence) {
      const existing = await client.query<Record<string, unknown>>(
        `SELECT ${EVIDENCE_COLUMNS} FROM event_evidence e
         WHERE e.event_id=$1 AND (
           ($2::text IS NOT NULL AND e.source_record_id=$2) OR
           ($3::text IS NOT NULL AND e.content_hash=$3)
         ) LIMIT 1`,
        [eventId, input.sourceRecordId ?? null, contentHash],
      );
      if (!existing.rows[0]) throw conflict('Evidence already exists or conflicts with an existing record.');
      evidence = existing.rows[0];
      created = false;
    }

    if (created) {
      await appendTimelineWithClient(client, eventId, actor, {
        entryType: 'EVIDENCE_ADDED',
        summary: `Evidence added: ${input.title ?? input.evidenceType}`,
        detail: { evidenceId: evidence.id, evidenceType: input.evidenceType, sourceId: input.sourceId ?? null },
        evidenceIds: [String(evidence.id)],
        dedupeKey: `evidence-added:${evidence.id}`,
      });
      if (event.rows[0].status === 'DETECTED') {
        await client.query(`UPDATE disaster_events SET status='EVIDENCE_COLLECTED', updated_at=now() WHERE id=$1`, [eventId]);
        await appendTimelineWithClient(client, eventId, actor, {
          entryType: 'STATUS_CHANGED',
          summary: 'Event moved from DETECTED to EVIDENCE_COLLECTED',
          detail: { from: 'DETECTED', to: 'EVIDENCE_COLLECTED', reason: 'Evidence added' },
          dedupeKey: `status:${eventId}:DETECTED:EVIDENCE_COLLECTED`,
        });
      }
    }
    return { evidence, created };
  });

  if (result.created) {
    await audit({
      actorId: actor.id ?? null,
      action: 'EVENT_EVIDENCE_ADDED',
      entityType: 'disaster_event',
      entityId: eventId,
      after: { evidenceId: result.evidence.id, evidenceType: input.evidenceType },
    });
  }
  return result;
}

export async function linkSource(
  eventId: string,
  input: LinkSourceInput,
  actor: EventActor = { type: 'SYSTEM' },
): Promise<{ link: Record<string, unknown>; created: boolean }> {
  validateEntityType(input.entityType);
  validateConfidence(input.confidence);
  if (!input.entityId.trim()) throw badRequest('Linked entity ID is required.');

  const result = await withTransaction(async (client) => {
    await assertEventExists(client, eventId);
    await assertLinkTargetExists(client, input.entityType, input.entityId);
    const inserted = await client.query<Record<string, unknown>>(
      `INSERT INTO event_links (event_id, entity_type, entity_id, relationship, confidence, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (event_id, entity_type, entity_id) DO NOTHING
       RETURNING event_id, entity_type, entity_id, relationship, confidence, created_by, created_at`,
      [eventId, input.entityType, input.entityId, input.relationship, input.confidence ?? null, actor.id ?? null],
    );
    let link = inserted.rows[0];
    let created = Boolean(link);
    if (!link) {
      const existing = await client.query<Record<string, unknown>>(
        `SELECT event_id, entity_type, entity_id, relationship, confidence, created_by, created_at
         FROM event_links WHERE event_id=$1 AND entity_type=$2 AND entity_id=$3`,
        [eventId, input.entityType, input.entityId],
      );
      link = existing.rows[0];
      created = false;
    }
    if (created) {
      await appendTimelineWithClient(client, eventId, actor, {
        entryType: 'SOURCE_LINKED',
        summary: `Linked ${input.entityType} ${input.entityId}`,
        detail: { entityType: input.entityType, entityId: input.entityId, relationship: input.relationship },
        dedupeKey: `source-linked:${input.entityType}:${input.entityId}`,
      });
    }
    return { link, created };
  });

  if (result.created) {
    await audit({
      actorId: actor.id ?? null,
      action: 'EVENT_SOURCE_LINKED',
      entityType: 'disaster_event',
      entityId: eventId,
      after: { entityType: input.entityType, entityId: input.entityId },
    });
  }
  return result;
}

export async function correlateEvents(
  eventId: string,
  relatedEventId: string,
  input: CorrelateInput,
  actor: EventActor = { type: 'SYSTEM' },
): Promise<{ correlation: Record<string, unknown>; created: boolean }> {
  if (eventId === relatedEventId) throw badRequest('An event cannot be correlated with itself.');
  validateConfidence(input.confidence);
  const [a, b] = eventId < relatedEventId ? [eventId, relatedEventId] : [relatedEventId, eventId];

  const result = await withTransaction(async (client) => {
    await assertEventExists(client, a);
    await assertEventExists(client, b);
    const inserted = await client.query<Record<string, unknown>>(
      `INSERT INTO event_correlations
         (event_a_id, event_b_id, relationship, distance_m, time_delta_seconds, confidence, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (event_a_id, event_b_id) DO NOTHING
       RETURNING event_a_id, event_b_id, relationship, distance_m, time_delta_seconds, confidence, reason, created_by, created_at`,
      [a, b, input.relationship, input.distanceM ?? null, input.timeDeltaSeconds ?? null, input.confidence ?? null, input.reason ?? null, actor.id ?? null],
    );
    let correlation = inserted.rows[0];
    let created = Boolean(correlation);
    if (!correlation) {
      const existing = await client.query<Record<string, unknown>>(
        `SELECT event_a_id, event_b_id, relationship, distance_m, time_delta_seconds, confidence, reason, created_by, created_at
         FROM event_correlations WHERE event_a_id=$1 AND event_b_id=$2`,
        [a, b],
      );
      correlation = existing.rows[0];
      created = false;
    }
    if (created) {
      for (const id of [a, b]) {
        await appendTimelineWithClient(client, id, actor, {
          entryType: 'CORRELATION_ADDED',
          summary: `Correlated with event ${id === a ? b : a}`,
          detail: { relatedEventId: id === a ? b : a, relationship: input.relationship, confidence: input.confidence ?? null },
          dedupeKey: `correlation:${a}:${b}:${id}`,
        });
      }
    }
    return { correlation, created };
  });

  if (result.created) {
    await audit({
      actorId: actor.id ?? null,
      action: 'EVENT_CORRELATED',
      entityType: 'disaster_event',
      entityId: a,
      after: { relatedEventId: b, relationship: input.relationship },
    });
  }
  return result;
}

export async function transitionEvent(
  eventId: string,
  nextStatus: EventStatus,
  actor: EventActor = { type: 'SYSTEM' },
  reason: string | null = null,
): Promise<{ event: DisasterEventRow; timelineEntry: Record<string, unknown> | null }> {
  validateStatus(nextStatus);
  return withTransaction(async (client) => {
    const current = await client.query<{ status: EventStatus }>(
      'SELECT status FROM disaster_events WHERE id=$1 FOR UPDATE',
      [eventId],
    );
    if (!current.rows[0]) throw notFound('Event not found.');
    if (current.rows[0].status === nextStatus) {
      const event = await client.query<DisasterEventRow>(`SELECT ${EVENT_COLUMNS} FROM disaster_events d WHERE d.id=$1`, [eventId]);
      return { event: event.rows[0], timelineEntry: null };
    }
    if (!canTransitionEvent(current.rows[0].status, nextStatus)) {
      throw conflict(`Invalid event transition: ${current.rows[0].status} → ${nextStatus}.`);
    }
    await client.query(
      `UPDATE disaster_events SET status=$2, closed_at=CASE WHEN $2='CLOSED' THEN now() ELSE closed_at END, updated_at=now() WHERE id=$1`,
      [eventId, nextStatus],
    );
    const timelineEntry = await appendTimelineWithClient(client, eventId, actor, {
      entryType: 'STATUS_CHANGED',
      summary: `Status changed from ${current.rows[0].status} to ${nextStatus}`,
      detail: { from: current.rows[0].status, to: nextStatus, reason },
    });
    const event = await client.query<DisasterEventRow>(`SELECT ${EVENT_COLUMNS} FROM disaster_events d WHERE d.id=$1`, [eventId]);
    return { event: event.rows[0], timelineEntry };
  }).then(async (result) => {
    if (result.timelineEntry) {
      await audit({
        actorId: actor.id ?? null,
        action: 'EVENT_STATUS_CHANGED',
        entityType: 'disaster_event',
        entityId: eventId,
        after: { status: result.event.status },
      });
    }
    return result;
  });
}

export async function getEvent(eventId: string): Promise<(DisasterEventRow & {
  evidence_count: number;
  link_count: number;
  correlation_count: number;
}) | null> {
  return one<DisasterEventRow & { evidence_count: number; link_count: number; correlation_count: number }>(
    `SELECT ${EVENT_COLUMNS},
       (SELECT COUNT(*)::int FROM event_evidence e WHERE e.event_id=d.id) AS evidence_count,
       (SELECT COUNT(*)::int FROM event_links l WHERE l.event_id=d.id) AS link_count,
       (SELECT COUNT(*)::int FROM event_correlations c WHERE c.event_a_id=d.id OR c.event_b_id=d.id) AS correlation_count
     FROM disaster_events d WHERE d.id=$1`,
    [eventId],
  );
}

export async function listEvents(filters: ListEventFilters): Promise<{
  events: DisasterEventRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.category) where.push(`d.category=${add(filters.category)}`);
  if (filters.status) where.push(`d.status=${add(filters.status)}`);
  if (filters.severity) where.push(`d.severity=${add(filters.severity)}`);
  if (filters.sourceId) where.push(`d.detection_source=${add(filters.sourceId)}`);
  if (filters.from) where.push(`COALESCE(d.start_at,d.detected_at) >= ${add(filters.from)}::timestamptz`);
  if (filters.to) where.push(`COALESCE(d.start_at,d.detected_at) <= ${add(filters.to)}::timestamptz`);
  if (filters.bbox) {
    const [minLng, minLat, maxLng, maxLat] = filters.bbox;
    const p1 = add(minLng);
    const p2 = add(minLat);
    const p3 = add(maxLng);
    const p4 = add(maxLat);
    where.push(`d.primary_location IS NOT NULL AND ST_Intersects(d.primary_location::geometry, ST_MakeEnvelope(${p1},${p2},${p3},${p4},4326))`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await one<{ count: number }>(`SELECT COUNT(*)::int AS count FROM disaster_events d ${clause}`, params);
  const limit = add(filters.pageSize);
  const offset = add((filters.page - 1) * filters.pageSize);
  const events = await query<DisasterEventRow>(
    `SELECT ${EVENT_COLUMNS} FROM disaster_events d ${clause}
     ORDER BY COALESCE(d.last_observed_at,d.start_at,d.detected_at) DESC, d.detected_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { events, total: count?.count ?? 0, page: filters.page, pageSize: filters.pageSize };
}

export async function listEvidence(eventId: string, viewerRole: string): Promise<Record<string, unknown>[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ${EVIDENCE_COLUMNS} FROM event_evidence e WHERE e.event_id=$1 ORDER BY COALESCE(e.observed_at,e.published_at,e.retrieved_at) DESC`,
    [eventId],
  );
  if (viewerRole === 'SYSTEM_ADMIN') return rows;
  return rows.map((row) => ({ ...row, raw_content: null, metadata: null }));
}

export async function listTimeline(eventId: string): Promise<Record<string, unknown>[]> {
  return query<Record<string, unknown>>(
    `SELECT id, event_id, entry_type, actor_type, actor_user_id, summary, detail, evidence_ids, occurred_at, created_at
     FROM event_timeline WHERE event_id=$1 ORDER BY occurred_at ASC, id ASC`,
    [eventId],
  );
}

export async function getEventOrThrow(eventId: string) {
  const event = await getEvent(eventId);
  if (!event) throw notFound('Event not found.');
  return event;
}
