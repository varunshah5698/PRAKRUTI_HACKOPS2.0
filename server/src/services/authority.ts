import { withTransaction, query, one } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/errors.js';
import { appendTimeline, getEventOrThrow, type EventActor } from './event-intelligence.js';
import {
  AUTHORITY_LEVELS,
  AUTHORITY_MEMBERSHIP_ROLES,
  AUTHORITY_MEMBERSHIP_STATUSES,
  AUTHORITY_ACTION_TYPES,
  canTransitionAuthorityStatus,
  type AuthorityLevel,
  type AuthorityMembershipRole,
  type AuthorityMembershipStatus,
  type AuthorityActionType,
  type EventAuthorityStatus,
} from '../types.js';

export interface AuthorityInput {
  code: string;
  name: string;
  abbreviation?: string | null;
  level: AuthorityLevel;
  parentId?: string | null;
  officialUrl?: string | null;
  officialContacts?: Record<string, unknown>;
  reportingChannels?: unknown[];
  dataFeeds?: unknown[];
  coverageCountry?: string | null;
  coverageState?: string | null;
  coverageDistrict?: string | null;
  coverageCity?: string | null;
  jurisdictionArea?: unknown | null;
  verificationStatus?: 'SOURCE_VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'DISPUTED';
  sourceUrl?: string | null;
  notes?: string | null;
}

export interface AuthorityActionInput {
  actionType: AuthorityActionType;
  channel?: string | null;
  deliveryReference?: string | null;
  response?: string | null;
  evidenceIds?: string[];
  notes?: string | null;
}

export const AUTHORITY_ACTION_STATUS: Partial<Record<AuthorityActionType, EventAuthorityStatus>> = {
  NOTIFICATION_SENT: 'AUTHORITY_NOTIFIED',
  NOTIFICATION_FAILED: 'NOTIFICATION_FAILED',
  ACKNOWLEDGE: 'ACKNOWLEDGED',
  VERIFY: 'VERIFIED',
  START_ACTION: 'ACTION_INITIATED',
  RESOLVE: 'RESOLVED',
  CLOSE: 'CLOSED',
  REJECT: 'REJECTED',
  ESCALATE: 'ESCALATED',
  MARK_UNRESOLVED: 'UNRESOLVED',
};

export function actionTargetStatus(action: AuthorityActionType): EventAuthorityStatus | null {
  if (!AUTHORITY_ACTION_TYPES.includes(action)) throw badRequest('Invalid authority action.');
  return AUTHORITY_ACTION_STATUS[action] ?? null;
}

function validateAuthorityLevel(value: string): asserts value is AuthorityLevel {
  if (!AUTHORITY_LEVELS.includes(value as AuthorityLevel)) throw badRequest('Invalid authority level.');
}

function validateMembershipRole(value: string): asserts value is AuthorityMembershipRole {
  if (!AUTHORITY_MEMBERSHIP_ROLES.includes(value as AuthorityMembershipRole)) throw badRequest('Invalid authority membership role.');
}

function validateMembershipStatus(value: string): asserts value is AuthorityMembershipStatus {
  if (!AUTHORITY_MEMBERSHIP_STATUSES.includes(value as AuthorityMembershipStatus)) {
    throw badRequest('Invalid authority membership status.');
  }
}

function validateAction(value: string): asserts value is AuthorityActionType {
  if (!AUTHORITY_ACTION_TYPES.includes(value as AuthorityActionType)) throw badRequest('Invalid authority action.');
}

export async function listAuthorities(): Promise<Record<string, unknown>[]> {
  return query<Record<string, unknown>>(
    `SELECT id, code, name, abbreviation, level, parent_id, official_url, official_contacts,
            reporting_channels, data_feeds, coverage_country, coverage_state, coverage_district,
            coverage_city, verification_status, verified_at, source_url, notes,
            CASE WHEN jurisdiction_area IS NULL THEN NULL ELSE ST_AsGeoJSON(jurisdiction_area)::jsonb END AS jurisdiction_area,
            created_at, updated_at
     FROM authority_directory ORDER BY level, name`,
  );
}

export async function getAuthority(authorityId: string): Promise<Record<string, unknown>> {
  const row = await one<Record<string, unknown>>(
    `SELECT id, code, name, abbreviation, level, parent_id, official_url, official_contacts,
            reporting_channels, data_feeds, coverage_country, coverage_state, coverage_district,
            coverage_city, verification_status, verified_at, source_url, notes,
            CASE WHEN jurisdiction_area IS NULL THEN NULL ELSE ST_AsGeoJSON(jurisdiction_area)::jsonb END AS jurisdiction_area,
            created_at, updated_at
     FROM authority_directory WHERE id=$1`,
    [authorityId],
  );
  if (!row) throw notFound('Authority not found.');
  return row;
}

export async function createAuthority(input: AuthorityInput, actor: EventActor = { type: 'SYSTEM' }): Promise<Record<string, unknown>> {
  validateAuthorityLevel(input.level);
  if (!input.code.trim() || !input.name.trim()) throw badRequest('Authority code and name are required.');
  if (input.verificationStatus === 'SOURCE_VERIFIED' && !input.sourceUrl) {
    throw badRequest('SOURCE_VERIFIED requires a sourceUrl.');
  }
  if (input.jurisdictionArea && (input.jurisdictionArea as { type?: string }).type !== 'MultiPolygon') {
    throw badRequest('Jurisdiction area must be a GeoJSON MultiPolygon.');
  }
  const row = await one<Record<string, unknown>>(
    `INSERT INTO authority_directory
       (code, name, abbreviation, level, parent_id, official_url, official_contacts, reporting_channels,
        data_feeds, coverage_country, coverage_state, coverage_district, coverage_city,
        jurisdiction_area, verification_status, verified_at, source_url, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,
       CASE WHEN $14::jsonb IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($14::jsonb),4326)::geometry(MultiPolygon,4326)::geography END,
       $15,$16,$17,$18)
     ON CONFLICT (code) DO UPDATE SET
       name=EXCLUDED.name, abbreviation=EXCLUDED.abbreviation, level=EXCLUDED.level, parent_id=EXCLUDED.parent_id,
       official_url=EXCLUDED.official_url, official_contacts=EXCLUDED.official_contacts,
       reporting_channels=EXCLUDED.reporting_channels, data_feeds=EXCLUDED.data_feeds,
       coverage_country=EXCLUDED.coverage_country, coverage_state=EXCLUDED.coverage_state,
       coverage_district=EXCLUDED.coverage_district, coverage_city=EXCLUDED.coverage_city,
       jurisdiction_area=EXCLUDED.jurisdiction_area, verification_status=EXCLUDED.verification_status,
       verified_at=EXCLUDED.verified_at, source_url=EXCLUDED.source_url, notes=EXCLUDED.notes, updated_at=now()
     RETURNING id, code, name, level, official_url, verification_status, coverage_country, coverage_state,
       coverage_district, coverage_city, verified_at, source_url, notes, created_at, updated_at`,
    [
      input.code.trim().toLowerCase(),
      input.name.trim(),
      input.abbreviation ?? null,
      input.level,
      input.parentId ?? null,
      input.officialUrl ?? null,
      JSON.stringify(input.officialContacts ?? {}),
      JSON.stringify(input.reportingChannels ?? []),
      JSON.stringify(input.dataFeeds ?? []),
      input.coverageCountry ?? 'India',
      input.coverageState ?? null,
      input.coverageDistrict ?? null,
      input.coverageCity ?? null,
      input.jurisdictionArea ? JSON.stringify(input.jurisdictionArea) : null,
      input.verificationStatus ?? 'PARTIALLY_VERIFIED',
      input.verificationStatus === 'SOURCE_VERIFIED' ? new Date().toISOString() : null,
      input.sourceUrl ?? null,
      input.notes ?? null,
    ],
  );
  if (!row) throw new Error('Could not create authority.');
  await audit({
    actorId: actor.id ?? null,
    action: 'AUTHORITY_DIRECTORY_UPSERTED',
    entityType: 'authority',
    entityId: String(row.id),
    after: { code: input.code, name: input.name, verificationStatus: input.verificationStatus ?? 'PARTIALLY_VERIFIED' },
  });
  return row;
}

export async function createMembership(
  authorityId: string,
  input: { userId: string; membershipRole: AuthorityMembershipRole; status?: AuthorityMembershipStatus; verificationSource?: string | null },
  actor: EventActor = { type: 'SYSTEM' },
): Promise<Record<string, unknown>> {
  validateMembershipRole(input.membershipRole);
  const status = input.status ?? 'ACTIVE';
  validateMembershipStatus(status);
  await getAuthority(authorityId);
  const user = await one<{ id: string; role: string }>('SELECT id, role::text FROM users WHERE id=$1', [input.userId]);
  if (!user) throw notFound('User not found.');
  if (user.role === 'SYSTEM_ADMIN') {
    throw badRequest('System administrators manage the authority directory but cannot hold an authority membership or act as an authority.');
  }
  if (!['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN'].includes(user.role)) {
    throw badRequest('Authority membership requires an existing authority-capable account.');
  }
  const row = await one<Record<string, unknown>>(
    `INSERT INTO authority_memberships (user_id, authority_id, membership_role, status, verified_at, verification_source)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, authority_id) DO UPDATE SET
       membership_role=EXCLUDED.membership_role, status=EXCLUDED.status,
       verified_at=EXCLUDED.verified_at, verification_source=EXCLUDED.verification_source, updated_at=now()
     RETURNING id, user_id, authority_id, membership_role, status, verified_at, verification_source, created_at, updated_at`,
    [
      input.userId,
      authorityId,
      input.membershipRole,
      status,
      status === 'ACTIVE' ? new Date().toISOString() : null,
      input.verificationSource ?? 'System administrator approval',
    ],
  );
  if (!row) throw new Error('Could not create authority membership.');
  await audit({
    actorId: actor.id ?? null,
    action: 'AUTHORITY_MEMBERSHIP_UPSERTED',
    entityType: 'authority_membership',
    entityId: String(row.id),
    after: { userId: input.userId, authorityId, membershipRole: input.membershipRole, status },
  });
  return row;
}

export async function membershipsForUser(userId: string): Promise<Record<string, unknown>[]> {
  return query<Record<string, unknown>>(
    `SELECT m.id, m.authority_id, a.name AS authority_name, a.level, m.membership_role, m.status,
            m.verified_at, m.verification_source
     FROM authority_memberships m JOIN authority_directory a ON a.id=m.authority_id
     WHERE m.user_id=$1 AND m.status='ACTIVE' ORDER BY a.name`,
    [userId],
  );
}

async function activeMembership(userId: string, authorityId: string, requireWrite = false) {
  const row = await one<{ id: string; membership_role: AuthorityMembershipRole; status: string }>(
    `SELECT id, membership_role, status FROM authority_memberships
     WHERE user_id=$1 AND authority_id=$2 AND status='ACTIVE'`,
    [userId, authorityId],
  );
  if (!row) throw forbidden('Active authority membership required.');
  if (requireWrite && row.membership_role === 'VIEWER') throw forbidden('Authority viewer membership is read-only.');
  return row;
}

export async function assignEventAuthorities(
  eventId: string,
  authorityIds: string[],
  actor: EventActor = { type: 'SYSTEM' },
): Promise<{ assigned: number; existing: number; authorities: Record<string, unknown>[] }> {
  await getEventOrThrow(eventId);
  if (authorityIds.length === 0) throw badRequest('At least one authority is required.');
  const unique = [...new Set(authorityIds)];
  let assigned = 0;
  let existing = 0;
  await withTransaction(async (client) => {
    for (const authorityId of unique) {
      const authority = await client.query('SELECT 1 FROM authority_directory WHERE id=$1', [authorityId]);
      if (authority.rowCount === 0) throw notFound(`Authority ${authorityId} not found.`);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO event_authority (event_id, authority_id, assigned_by)
         VALUES ($1,$2,$3)
         ON CONFLICT (event_id, authority_id) DO NOTHING
         RETURNING id`,
        [eventId, authorityId, actor.id ?? null],
      );
      if (inserted.rows[0]) {
        assigned += 1;
        await client.query(
          `INSERT INTO event_timeline (event_id, entry_type, actor_type, actor_user_id, summary, detail, dedupe_key)
           VALUES ($1,'AUTHORITY_ACTION',$2,$3,'Authority assigned',$4::jsonb,$5)`,
          [
            eventId,
            actor.type,
            actor.id ?? null,
            JSON.stringify({ authorityId, authorityEventId: inserted.rows[0].id }),
            `authority-assigned:${eventId}:${authorityId}`,
          ],
        );
      } else {
        existing += 1;
      }
    }
  });
  await audit({
    actorId: actor.id ?? null,
    action: 'EVENT_AUTHORITIES_ASSIGNED',
    entityType: 'disaster_event',
    entityId: eventId,
    after: { authorityIds: unique, assigned, existing },
  });
  return { assigned, existing, authorities: await getEventAuthorities(eventId) };
}

export async function autoMapAuthorities(eventId: string, actor: EventActor = { type: 'SYSTEM' }) {
  const event = await getEventOrThrow(eventId);
  const rows = await query<{ id: string }>(
    `SELECT id FROM authority_directory
     WHERE verification_status IN ('SOURCE_VERIFIED','PARTIALLY_VERIFIED')
       AND (
         (jurisdiction_area IS NOT NULL AND $1::float8 IS NOT NULL AND $2::float8 IS NOT NULL
           AND ST_Contains(jurisdiction_area::geometry, ST_SetSRID(ST_MakePoint($2,$1),4326)))
         OR ($3::text IS NOT NULL AND coverage_city IS NOT NULL AND $3 ILIKE '%' || coverage_city || '%')
         OR ($3::text IS NOT NULL AND coverage_district IS NOT NULL AND $3 ILIKE '%' || coverage_district || '%')
         OR ($3::text IS NOT NULL AND coverage_state IS NOT NULL AND $3 ILIKE '%' || coverage_state || '%')
       )
     ORDER BY level, name`,
    [event.primary_latitude, event.primary_longitude, event.admin_area],
  );
  if (rows.length === 0) {
    return { assigned: 0, existing: 0, authorities: await getEventAuthorities(eventId), note: 'No authority coverage matched; assign manually.' };
  }
  return assignEventAuthorities(eventId, rows.map((row) => row.id), actor);
}

export async function getEventAuthorities(eventId: string): Promise<Record<string, unknown>[]> {
  await getEventOrThrow(eventId);
  return query<Record<string, unknown>>(
    `SELECT ea.id, ea.event_id, ea.authority_id, a.name AS authority_name, a.code AS authority_code,
            a.level, a.official_url, ea.status, ea.assigned_at, ea.updated_at,
            (SELECT COUNT(*)::int FROM event_authority_actions x WHERE x.event_authority_id=ea.id) AS action_count
     FROM event_authority ea JOIN authority_directory a ON a.id=ea.authority_id
     WHERE ea.event_id=$1 ORDER BY a.level, a.name`,
    [eventId],
  );
}

export async function authorityEvents(userId: string, status?: EventAuthorityStatus): Promise<Record<string, unknown>[]> {
  const memberships = await membershipsForUser(userId);
  const ids = memberships.map((row) => String(row.authority_id));
  if (ids.length === 0) throw forbidden('Active authority membership required.');
  const params: unknown[] = [ids];
  let statusClause = '';
  if (status) {
    params.push(status);
    statusClause = ' AND ea.status=$2';
  }
  return query<Record<string, unknown>>(
    `SELECT ea.id, ea.event_id, ea.authority_id, a.name AS authority_name, ea.status AS authority_status,
            e.title, e.category, e.severity, e.status AS event_status, e.detected_at, e.last_observed_at,
            e.admin_area,
            ST_Y(e.primary_location::geometry)::float8 AS latitude,
            ST_X(e.primary_location::geometry)::float8 AS longitude
     FROM event_authority ea
     JOIN authority_directory a ON a.id=ea.authority_id
     JOIN disaster_events e ON e.id=ea.event_id
     WHERE ea.authority_id = ANY($1::uuid[])${statusClause}
     ORDER BY CASE ea.status WHEN 'READY_FOR_REVIEW' THEN 0 WHEN 'AUTHORITY_NOTIFIED' THEN 1 WHEN 'ACKNOWLEDGED' THEN 2 ELSE 3 END,
              ea.updated_at DESC`,
    params,
  );
}

export async function authorityEventDetail(userId: string, eventId: string, authorityId: string) {
  await activeMembership(userId, authorityId);
  const assignment = await one<Record<string, unknown>>(
    `SELECT ea.id, ea.event_id, ea.authority_id, ea.status, ea.assigned_at, ea.updated_at,
            a.name AS authority_name, a.official_url
     FROM event_authority ea JOIN authority_directory a ON a.id=ea.authority_id
     WHERE ea.event_id=$1 AND ea.authority_id=$2`,
    [eventId, authorityId],
  );
  if (!assignment) throw notFound('Event is not assigned to this authority.');
  const event = await getEventOrThrow(eventId);
  const actions = await query<Record<string, unknown>>(
    `SELECT id, action_type, previous_status, new_status, channel, delivery_reference, response,
            evidence_ids, notes, created_at, user_id
     FROM event_authority_actions WHERE event_id=$1 AND authority_id=$2 ORDER BY created_at ASC`,
    [eventId, authorityId],
  );
  return { event, authority: assignment, actions };
}

export async function recordAuthorityAction(
  userId: string,
  eventId: string,
  authorityId: string,
  input: AuthorityActionInput,
  actor: EventActor = { type: 'USER', id: userId },
) {
  validateAction(input.actionType);
  const user = await one<{ role: string }>('SELECT role::text FROM users WHERE id=$1', [userId]);
  if (!user) throw forbidden('Authority membership required.');
  if (user.role === 'SYSTEM_ADMIN') {
    throw forbidden('System administrators cannot act on behalf of an authority.');
  }
  await activeMembership(userId, authorityId, true);
  if (input.actionType === 'NOTIFICATION_SENT' && (!input.channel?.trim() || !input.deliveryReference?.trim())) {
    throw badRequest('NOTIFICATION_SENT requires channel and deliveryReference. This records a manual notification; it does not prove external delivery.');
  }
  if (
    ['REJECT', 'ESCALATE', 'MARK_UNRESOLVED'].includes(input.actionType) &&
    !input.response?.trim() &&
    !input.notes?.trim()
  ) {
    throw badRequest(`${input.actionType} requires a response or notes explaining the decision.`);
  }
  const evidenceIds = [...new Set(input.evidenceIds ?? [])];
  if (evidenceIds.length > 0) {
    const linked = await query<{ id: string }>(
      `SELECT id::text FROM event_evidence WHERE event_id=$1 AND id = ANY($2::uuid[])
       UNION
       SELECT ae.evidence_id::text FROM event_analysis_evidence ae
         JOIN event_analysis a ON a.id=ae.analysis_id
       WHERE a.event_id=$1 AND ae.evidence_id = ANY($2::uuid[])`,
      [eventId, evidenceIds],
    );
    if (linked.length !== evidenceIds.length) {
      throw badRequest('Every action evidence ID must belong to this event.');
    }
  }
  const target = actionTargetStatus(input.actionType);
  const result = await withTransaction(async (client) => {
    const assignment = await client.query<{ id: string; status: EventAuthorityStatus }>(
      `SELECT id, status FROM event_authority WHERE event_id=$1 AND authority_id=$2 FOR UPDATE`,
      [eventId, authorityId],
    );
    if (!assignment.rows[0]) throw notFound('Event is not assigned to this authority.');
    const current = assignment.rows[0].status;
    if (target && !canTransitionAuthorityStatus(current, target)) {
      throw conflict(`Invalid authority transition: ${current} → ${target}.`);
    }
    if (target) {
      await client.query(
        `UPDATE event_authority SET status=$2, updated_at=now() WHERE id=$1`,
        [assignment.rows[0].id, target],
      );
    }
    const action = await client.query<Record<string, unknown>>(
      `INSERT INTO event_authority_actions
         (event_authority_id, event_id, authority_id, user_id, actor_type, action_type, previous_status,
          new_status, channel, delivery_reference, response, evidence_ids, notes)
       VALUES ($1,$2,$3,$4,'AUTHORITY_USER',$5,$6,$7,$8,$9,$10,$11::uuid[],$12)
       RETURNING id, action_type, previous_status, new_status, channel, delivery_reference, response,
         evidence_ids, notes, created_at`,
      [
        assignment.rows[0].id,
        eventId,
        authorityId,
        userId,
        input.actionType,
        current,
        target ?? current,
        input.channel ?? null,
        input.deliveryReference ?? null,
        input.response ?? null,
        input.evidenceIds ?? [],
        input.notes ?? null,
      ],
    );
    return { action: action.rows[0], current, target };
  });
  await appendTimeline(eventId, actor, {
    entryType: 'AUTHORITY_ACTION',
    summary: `${input.actionType.replace(/_/g, ' ').toLowerCase()} by authority`,
    detail: {
      authorityId,
      actionType: input.actionType,
      previousStatus: result.current,
      newStatus: result.target ?? result.current,
      channel: input.channel ?? null,
      deliveryReference: input.deliveryReference ?? null,
    },
    evidenceIds: input.evidenceIds ?? [],
    dedupeKey: `authority-action:${String(result.action.id)}`,
  });
  await audit({
    actorId: userId,
    action: `AUTHORITY_${input.actionType}`,
    entityType: 'event_authority',
    entityId: String(result.action.id),
    after: { eventId, authorityId, previousStatus: result.current, newStatus: result.target ?? result.current },
  });
  return result.action;
}
