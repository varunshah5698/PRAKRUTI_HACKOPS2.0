import { withTransaction, query, one } from '../db/pool.js';
import { env, emailConfigured } from '../config/env.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/errors.js';
import { appendTimeline, getEventOrThrow, type EventActor } from './event-intelligence.js';
import {
  deliverEmail,
  markNotificationStatus,
  recordNotificationEvent,
  renderAuthorityEventEmail,
} from './email.js';
import {
  authorityDeadlines,
  matchAuthorities,
  type AuthorityMatch,
  type AuthorityMatchCandidate,
} from './authority-policy.js';
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
  type EventSeverity,
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

export async function listAuthorityMemberships(authorityId: string): Promise<Record<string, unknown>[]> {
  await getAuthority(authorityId);
  return query<Record<string, unknown>>(
    `SELECT m.id, m.user_id, u.name AS user_name, u.email, u.role::text AS user_role,
            m.membership_role, m.status, m.verified_at, m.verification_source, m.created_at, m.updated_at
     FROM authority_memberships m JOIN users u ON u.id=m.user_id
     WHERE m.authority_id=$1 ORDER BY m.status, u.name`,
    [authorityId],
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
): Promise<{ assigned: number; reactivated: number; existing: number; authorities: Record<string, unknown>[] }> {
  await getEventOrThrow(eventId);
  if (authorityIds.length === 0) throw badRequest('At least one authority is required.');
  const unique = [...new Set(authorityIds)];
  let assigned = 0;
  let reactivated = 0;
  let existing = 0;
  await withTransaction(async (client) => {
    for (const authorityId of unique) {
      const authority = await client.query('SELECT 1 FROM authority_directory WHERE id=$1', [authorityId]);
      if (authority.rowCount === 0) throw notFound(`Authority ${authorityId} not found.`);
      const current = await client.query<{ id: string; withdrawn_at: string | null }>(
        `SELECT id, withdrawn_at FROM event_authority
         WHERE event_id=$1 AND authority_id=$2 FOR UPDATE`,
        [eventId, authorityId],
      );
      if (current.rows[0] && !current.rows[0].withdrawn_at) {
        existing += 1;
        continue;
      }
      if (current.rows[0]) {
        await client.query(
          `UPDATE event_authority
           SET withdrawn_at=NULL, withdrawn_by=NULL, withdrawal_reason=NULL, status='READY_FOR_REVIEW',
               assigned_by=$2, assigned_at=now(), notified_at=NULL, acknowledgement_due_at=NULL,
               resolution_due_at=NULL, updated_at=now()
           WHERE id=$1`,
          [current.rows[0].id, actor.id ?? null],
        );
        reactivated += 1;
        await client.query(
          `INSERT INTO event_timeline (event_id, entry_type, actor_type, actor_user_id, summary, detail, dedupe_key)
           VALUES ($1,'AUTHORITY_ACTION',$2,$3,'Authority re-assigned',$4::jsonb,$5)`,
          [
            eventId,
            actor.type,
            actor.id ?? null,
            JSON.stringify({ authorityId, authorityEventId: current.rows[0].id }),
            `authority-reassigned:${current.rows[0].id}:${new Date().toISOString()}`,
          ],
        );
        continue;
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO event_authority (event_id, authority_id, assigned_by)
         VALUES ($1,$2,$3)
         RETURNING id`,
        [eventId, authorityId, actor.id ?? null],
      );
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
    }
  });
  await audit({
    actorId: actor.id ?? null,
    action: 'EVENT_AUTHORITIES_ASSIGNED',
    entityType: 'disaster_event',
    entityId: eventId,
    after: { authorityIds: unique, assigned, reactivated, existing },
  });
  return { assigned, reactivated, existing, authorities: await getEventAuthorities(eventId) };
}

export async function autoMapAuthorities(
  eventId: string,
  actor: EventActor = { type: 'SYSTEM' },
): Promise<{
  assigned: number;
  reactivated: number;
  existing: number;
  authorities: Record<string, unknown>[];
  matches: AuthorityMatch[];
  note?: string;
}> {
  const event = await getEventOrThrow(eventId);
  const candidates = await query<AuthorityMatchCandidate>(
    `SELECT id, code, name, level, coverage_state, coverage_district, coverage_city,
            CASE WHEN jurisdiction_area IS NOT NULL
                  AND $1::float8 IS NOT NULL AND $2::float8 IS NOT NULL
                  AND ST_Contains(jurisdiction_area::geometry, ST_SetSRID(ST_MakePoint($2,$1),4326))
                 THEN true ELSE false END AS polygon_match
     FROM authority_directory
     WHERE verification_status IN ('SOURCE_VERIFIED','PARTIALLY_VERIFIED')
     ORDER BY level, name`,
    [event.primary_latitude, event.primary_longitude],
  );
  const matches = matchAuthorities(
    {
      adminArea: event.admin_area ?? null,
      latitude: event.primary_latitude ?? null,
      longitude: event.primary_longitude ?? null,
    },
    candidates,
  );
  if (matches.length === 0) {
    return {
      assigned: 0,
      reactivated: 0,
      existing: 0,
      authorities: await getEventAuthorities(eventId),
      matches,
      note: 'No exact coverage match. Assign an authority manually; substring matching is intentionally disabled.',
    };
  }
  const result = await assignEventAuthorities(
    eventId,
    matches.map((match) => match.authorityId),
    actor,
  );
  return { ...result, matches };
}

export async function withdrawEventAuthority(
  eventId: string,
  authorityId: string,
  reason: string,
  actor: EventActor = { type: 'SYSTEM' },
): Promise<Record<string, unknown>> {
  if (reason.trim().length < 5) throw badRequest('A withdrawal reason of at least 5 characters is required.');
  await getEventOrThrow(eventId);
  const assignment = await one<{ id: string; withdrawn_at: string | null }>(
    `SELECT id, withdrawn_at FROM event_authority WHERE event_id=$1 AND authority_id=$2`,
    [eventId, authorityId],
  );
  if (!assignment) throw notFound('Event is not assigned to this authority.');
  if (assignment.withdrawn_at) throw conflict('Authority assignment is already withdrawn.');
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE event_authority
       SET withdrawn_at=now(), withdrawn_by=$2, withdrawal_reason=$3, updated_at=now()
       WHERE id=$1`,
      [assignment.id, actor.id ?? null, reason.trim()],
    );
    await client.query(
      `INSERT INTO event_timeline (event_id, entry_type, actor_type, actor_user_id, summary, detail, dedupe_key)
       VALUES ($1,'AUTHORITY_ACTION',$2,$3,'Authority withdrawn from event',$4::jsonb,$5)`,
      [
        eventId,
        actor.type,
        actor.id ?? null,
        JSON.stringify({ authorityId, authorityEventId: assignment.id, reason: reason.trim() }),
        `authority-withdrawn:${assignment.id}:${new Date().toISOString()}`,
      ],
    );
  });
  await audit({
    actorId: actor.id ?? null,
    action: 'EVENT_AUTHORITY_WITHDRAWN',
    entityType: 'event_authority',
    entityId: assignment.id,
    after: { eventId, authorityId, reason: reason.trim() },
  });
  return { withdrawn: true, authorityId, reason: reason.trim(), authorities: await getEventAuthorities(eventId) };
}

export async function getEventAuthorities(
  eventId: string,
  includeWithdrawn = false,
): Promise<Record<string, unknown>[]> {
  await getEventOrThrow(eventId);
  return query<Record<string, unknown>>(
    `SELECT ea.id, ea.event_id, ea.authority_id, a.name AS authority_name, a.code AS authority_code,
            a.level, a.official_url, ea.status, ea.assigned_at, ea.notified_at,
            ea.acknowledgement_due_at, ea.resolution_due_at, ea.updated_at,
            ea.withdrawn_at, ea.withdrawal_reason,
            (ea.status='AUTHORITY_NOTIFIED' AND ea.acknowledgement_due_at IS NOT NULL
              AND ea.acknowledgement_due_at < now()) AS acknowledgement_overdue,
            (ea.status NOT IN ('RESOLVED','CLOSED','REJECTED') AND ea.resolution_due_at IS NOT NULL
              AND ea.resolution_due_at < now()) AS resolution_overdue,
            (SELECT COUNT(*)::int FROM event_authority_actions x WHERE x.event_authority_id=ea.id) AS action_count,
            (SELECT MAX(x.created_at) FROM event_authority_actions x WHERE x.event_authority_id=ea.id) AS last_action_at,
            (SELECT COUNT(*)::int FROM event_evidence ev WHERE ev.event_id=ea.event_id) AS evidence_count
     FROM event_authority ea JOIN authority_directory a ON a.id=ea.authority_id
     WHERE ea.event_id=$1 AND ($2::boolean OR ea.withdrawn_at IS NULL)
     ORDER BY ea.withdrawn_at NULLS FIRST, a.level, a.name`,
    [eventId, includeWithdrawn],
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
            e.admin_area, ea.assigned_at, ea.notified_at, ea.acknowledgement_due_at, ea.resolution_due_at,
            ea.updated_at,
            (ea.status='AUTHORITY_NOTIFIED' AND ea.acknowledgement_due_at IS NOT NULL
              AND ea.acknowledgement_due_at < now()) AS acknowledgement_overdue,
            (ea.status NOT IN ('RESOLVED','CLOSED','REJECTED') AND ea.resolution_due_at IS NOT NULL
              AND ea.resolution_due_at < now()) AS resolution_overdue,
            (SELECT COUNT(*)::int FROM event_authority_actions x WHERE x.event_authority_id=ea.id) AS action_count,
            (SELECT MAX(x.created_at) FROM event_authority_actions x WHERE x.event_authority_id=ea.id) AS last_action_at,
            (SELECT COUNT(*)::int FROM event_evidence ev WHERE ev.event_id=ea.event_id) AS evidence_count,
            ST_Y(e.primary_location::geometry)::float8 AS latitude,
            ST_X(e.primary_location::geometry)::float8 AS longitude
     FROM event_authority ea
     JOIN authority_directory a ON a.id=ea.authority_id
     JOIN disaster_events e ON e.id=ea.event_id
     WHERE ea.authority_id = ANY($1::uuid[]) AND ea.withdrawn_at IS NULL${statusClause}
     ORDER BY acknowledgement_overdue DESC,
              CASE ea.status WHEN 'READY_FOR_REVIEW' THEN 0 WHEN 'AUTHORITY_NOTIFIED' THEN 1 WHEN 'ACKNOWLEDGED' THEN 2 ELSE 3 END,
              ea.updated_at DESC`,
    params,
  );
}

export async function authorityEventDetail(userId: string, eventId: string, authorityId: string) {
  await activeMembership(userId, authorityId);
  const assignment = await one<Record<string, unknown>>(
    `SELECT ea.id, ea.event_id, ea.authority_id, ea.status, ea.assigned_at, ea.notified_at,
            ea.acknowledgement_due_at, ea.resolution_due_at, ea.updated_at,
            (ea.status='AUTHORITY_NOTIFIED' AND ea.acknowledgement_due_at IS NOT NULL
              AND ea.acknowledgement_due_at < now()) AS acknowledgement_overdue,
            (ea.status NOT IN ('RESOLVED','CLOSED','REJECTED') AND ea.resolution_due_at IS NOT NULL
              AND ea.resolution_due_at < now()) AS resolution_overdue,
            a.name AS authority_name, a.official_url
     FROM event_authority ea JOIN authority_directory a ON a.id=ea.authority_id
     WHERE ea.event_id=$1 AND ea.authority_id=$2 AND ea.withdrawn_at IS NULL`,
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
  const evidence = await query<Record<string, unknown>>(
    `SELECT id, evidence_type, source_name, source_url, title, observed_at, published_at,
            verification_status, reliability_class, freshness_status
     FROM event_evidence WHERE event_id=$1
     ORDER BY COALESCE(observed_at,published_at,retrieved_at) DESC`,
    [eventId],
  );
  const notifications = await query<Record<string, unknown>>(
    `SELECT n.id, n.subject, n.status, n.sent_at, n.delivered_at, n.error, n.is_simulated, n.created_at,
            regexp_replace(u.email, '(^.).*(@.*$)', '\\1***\\2') AS recipient_masked
     FROM notifications n LEFT JOIN users u ON u.id=n.user_id
     WHERE n.event_authority_id=$1 ORDER BY n.created_at DESC`,
    [assignment.id],
  );
  return { event, authority: assignment, actions, evidence, notifications };
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
    ['REJECT', 'ESCALATE', 'MARK_UNRESOLVED', 'VERIFY', 'START_ACTION', 'RESOLVE', 'CLOSE', 'NOTIFICATION_FAILED'].includes(
      input.actionType,
    ) &&
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
  if (input.actionType === 'VERIFY') {
    const eventEvidence = await one<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM event_evidence WHERE event_id=$1',
      [eventId],
    );
    if ((eventEvidence?.count ?? 0) === 0 && evidenceIds.length === 0) {
      throw badRequest('VERIFY requires at least one linked evidence record.');
    }
  }
  const target = actionTargetStatus(input.actionType);
  const result = await withTransaction(async (client) => {
    const assignment = await client.query<{
      id: string;
      status: EventAuthorityStatus;
      withdrawn_at: string | null;
      severity: EventSeverity;
    }>(
      `SELECT ea.id, ea.status, ea.withdrawn_at, d.severity
       FROM event_authority ea JOIN disaster_events d ON d.id=ea.event_id
       WHERE ea.event_id=$1 AND ea.authority_id=$2 FOR UPDATE OF ea`,
      [eventId, authorityId],
    );
    const row = assignment.rows[0];
    if (!row) throw notFound('Event is not assigned to this authority.');
    if (row.withdrawn_at) throw conflict('Authority assignment has been withdrawn.');
    const current = row.status;
    if (target && !canTransitionAuthorityStatus(current, target)) {
      throw conflict(`Invalid authority transition: ${current} → ${target}.`);
    }
    if (target) {
      if (target === 'AUTHORITY_NOTIFIED') {
        const deadlines = authorityDeadlines(row.severity);
        await client.query(
          `UPDATE event_authority
           SET status=$2, notified_at=COALESCE(notified_at, now()),
               acknowledgement_due_at=COALESCE(acknowledgement_due_at, $3),
               resolution_due_at=COALESCE(resolution_due_at, $4), updated_at=now()
           WHERE id=$1`,
          [row.id, target, deadlines.acknowledgementDueAt.toISOString(), deadlines.resolutionDueAt.toISOString()],
        );
      } else if (target === 'ACTION_INITIATED') {
        const deadlines = authorityDeadlines(row.severity);
        await client.query(
          `UPDATE event_authority
           SET status=$2, resolution_due_at=COALESCE(resolution_due_at, $3), updated_at=now()
           WHERE id=$1`,
          [row.id, target, deadlines.resolutionDueAt.toISOString()],
        );
      } else {
        await client.query(
          `UPDATE event_authority SET status=$2, updated_at=now() WHERE id=$1`,
          [row.id, target],
        );
      }
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

export interface AuthorityNotificationResult {
  eventAuthorityId: string;
  authorityStatus: EventAuthorityStatus;
  delivered: boolean;
  sent: number;
  failed: number;
  simulated: number;
  skippedRecent: number;
  demoMode: boolean;
  notifications: Array<{
    id: string;
    status: 'SENT' | 'FAILED' | 'SIMULATED';
    recipientMasked: string;
    providerMessageId: string | null;
    error: string | null;
  }>;
  actionId: string;
}

function maskEmail(value: string): string {
  return value.replace(/(^.).*(@.*$)/, '$1***$2');
}

/**
 * System-dispatched email to active members of an assigned authority. This is
 * a workflow notification, not an official warning. Provider acceptance is
 * recorded as SENT; only a provider webhook can record DELIVERED. If the email
 * provider is not configured, no status is fabricated: the assignment moves to
 * NOTIFICATION_FAILED and the reason is stored.
 */
export async function notifyEventAuthority(
  eventId: string,
  authorityId: string,
  actor: EventActor = { type: 'SYSTEM' },
): Promise<AuthorityNotificationResult> {
  const event = await getEventOrThrow(eventId);
  const authority = await getAuthority(authorityId);
  if (event.evidence_count === 0) {
    throw badRequest('Cannot notify an authority about an event with no linked evidence.');
  }
  const assignment = await one<{ id: string; status: EventAuthorityStatus; withdrawn_at: string | null }>(
    `SELECT id, status, withdrawn_at FROM event_authority WHERE event_id=$1 AND authority_id=$2`,
    [eventId, authorityId],
  );
  if (!assignment) throw notFound('Event is not assigned to this authority.');
  if (assignment.withdrawn_at) throw conflict('Authority assignment has been withdrawn.');
  if (assignment.status !== 'AUTHORITY_NOTIFIED' && !canTransitionAuthorityStatus(assignment.status, 'AUTHORITY_NOTIFIED')) {
    throw conflict(`Authority status ${assignment.status} cannot be notified again.`);
  }

  const recipients = await query<{ id: string; name: string; email: string }>(
    `SELECT u.id, u.name, u.email
     FROM authority_memberships m JOIN users u ON u.id=m.user_id
     WHERE m.authority_id=$1 AND m.status='ACTIVE' AND u.account_status='ACTIVE'
     ORDER BY u.name`,
    [authorityId],
  );
  if (recipients.length === 0) {
    throw badRequest('This authority has no active members. Add an active membership before notifying.');
  }

  const rendered = renderAuthorityEventEmail({
    eventId,
    title: String(event.title),
    category: String(event.category),
    severity: String(event.severity),
    status: String(event.status),
    adminArea: event.admin_area ?? null,
    detectedAt: String(event.detected_at),
    evidenceCount: event.evidence_count,
    authorityName: String(authority.name),
    appUrl: env.FRONTEND_URL,
  });

  const results: AuthorityNotificationResult['notifications'] = [];
  let skippedRecent = 0;
  for (const recipient of recipients) {
    const recent = await one<{ id: string }>(
      `SELECT id FROM notifications
       WHERE event_authority_id=$1 AND user_id=$2 AND template='AUTHORITY_EVENT_NOTIFICATION'
         AND created_at > now() - interval '10 minutes'`,
      [assignment.id, recipient.id],
    );
    if (recent) {
      skippedRecent += 1;
      continue;
    }
    const isSimulated = !emailConfigured || (env.DEMO_MODE && !env.DEMO_EMAIL_RECIPIENT);
    const inserted = await one<{ id: string }>(
      `INSERT INTO notifications
         (user_id, audience, channel, template, subject, body_html, status, is_simulated,
          disaster_event_id, event_authority_id)
       VALUES ($1,'AUTHORITY','EMAIL','AUTHORITY_EVENT_NOTIFICATION',$2,$3,'SIMULATED',$4,$5,$6)
       RETURNING id`,
      [recipient.id, rendered.subject, rendered.html, isSimulated, eventId, assignment.id],
    );
    if (!inserted) continue;
    await recordNotificationEvent(inserted.id, 'CREATED', {
      template: 'AUTHORITY_EVENT_NOTIFICATION',
      eventId,
      authorityId,
      recipientMasked: maskEmail(recipient.email),
      demoMode: env.DEMO_MODE,
    });
    const delivery = await deliverEmail({
      notificationId: inserted.id,
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      isSimulated,
    });
    await markNotificationStatus(inserted.id, delivery.status, {
      providerMessageId: delivery.messageId,
      error: delivery.error,
    });
    await recordNotificationEvent(inserted.id, delivery.event, {
      demoMode: env.DEMO_MODE,
      recipientMasked: delivery.recipient ? maskEmail(delivery.recipient) : maskEmail(recipient.email),
    });
    results.push({
      id: inserted.id,
      status: delivery.status,
      recipientMasked: delivery.recipient ? maskEmail(delivery.recipient) : maskEmail(recipient.email),
      providerMessageId: delivery.messageId ?? null,
      error: delivery.error ?? null,
    });
  }

  const sent = results.filter((item) => item.status === 'SENT').length;
  const failed = results.filter((item) => item.status === 'FAILED').length;
  const simulated = results.filter((item) => item.status === 'SIMULATED').length;
  if (results.length === 0 && skippedRecent > 0) {
    throw conflict('A notification was already sent to every active member within the last 10 minutes. Check delivery records before resending.');
  }
  const delivered = sent > 0;
  const actionType = delivered ? 'NOTIFICATION_SENT' : 'NOTIFICATION_FAILED';
  const summary = delivered
    ? `Email dispatch accepted for ${sent} recipient(s); ${failed} failed; ${simulated} simulated; ${skippedRecent} skipped as recent duplicates.${env.DEMO_MODE ? ' DEMO_MODE: delivery may be redirected to the demonstration recipient.' : ''} Provider acceptance is not proof of inbox delivery.`
    : `No email was delivered. ${failed} failed; ${simulated} simulated; ${skippedRecent} skipped as recent duplicates. ${emailConfigured ? 'Check the provider error records.' : 'Email provider is not configured.'}`;

  const outcome = await withTransaction(async (client) => {
    const current = await client.query<{ id: string; status: EventAuthorityStatus; withdrawn_at: string | null }>(
      `SELECT id, status, withdrawn_at FROM event_authority
       WHERE event_id=$1 AND authority_id=$2 FOR UPDATE`,
      [eventId, authorityId],
    );
    const row = current.rows[0];
    if (!row) throw notFound('Event is not assigned to this authority.');
    if (row.withdrawn_at) throw conflict('Authority assignment has been withdrawn.');
    let nextStatus = row.status;
    if (delivered) {
      if (row.status === 'AUTHORITY_NOTIFIED' || canTransitionAuthorityStatus(row.status, 'AUTHORITY_NOTIFIED')) {
        const deadlines = authorityDeadlines(event.severity);
        await client.query(
          `UPDATE event_authority
           SET status='AUTHORITY_NOTIFIED', notified_at=COALESCE(notified_at, now()),
               acknowledgement_due_at=COALESCE(acknowledgement_due_at, $2),
               resolution_due_at=COALESCE(resolution_due_at, $3), updated_at=now()
           WHERE id=$1`,
          [row.id, deadlines.acknowledgementDueAt.toISOString(), deadlines.resolutionDueAt.toISOString()],
        );
        nextStatus = 'AUTHORITY_NOTIFIED';
      }
    } else if (
      row.status !== 'AUTHORITY_NOTIFIED' &&
      canTransitionAuthorityStatus(row.status, 'NOTIFICATION_FAILED')
    ) {
      await client.query(
        `UPDATE event_authority SET status='NOTIFICATION_FAILED', updated_at=now() WHERE id=$1`,
        [row.id],
      );
      nextStatus = 'NOTIFICATION_FAILED';
    }
    const action = await client.query<{ id: string }>(
      `INSERT INTO event_authority_actions
         (event_authority_id, event_id, authority_id, user_id, actor_type, action_type, previous_status,
          new_status, channel, delivery_reference, response, evidence_ids, notes)
       VALUES ($1,$2,$3,NULL,'SYSTEM',$4,$5,$6,'EMAIL',$7,NULL,'{}'::uuid[], $8)
       RETURNING id`,
      [
        row.id,
        eventId,
        authorityId,
        actionType,
        row.status,
        nextStatus,
        results.map((item) => item.providerMessageId ?? item.id).join(', ').slice(0, 2000) || null,
        summary,
      ],
    );
    return { actionId: action.rows[0].id, previousStatus: row.status, nextStatus };
  });

  await appendTimeline(eventId, actor, {
    entryType: 'AUTHORITY_ACTION',
    summary: delivered
      ? `Authority notified by email (${sent} accepted)`
      : 'Authority email notification failed',
    detail: {
      authorityId,
      eventAuthorityId: assignment.id,
      actionType,
      sent,
      failed,
      simulated,
      skippedRecent,
      demoMode: env.DEMO_MODE,
    },
    evidenceIds: [],
    dedupeKey: `authority-notify:${outcome.actionId}`,
  });
  await audit({
    actorId: actor.id ?? null,
    action: delivered ? 'AUTHORITY_NOTIFICATION_DISPATCHED' : 'AUTHORITY_NOTIFICATION_FAILED',
    entityType: 'event_authority',
    entityId: assignment.id,
    after: {
      eventId,
      authorityId,
      sent,
      failed,
      simulated,
      skippedRecent,
      demoMode: env.DEMO_MODE,
    },
  });

  return {
    eventAuthorityId: assignment.id,
    authorityStatus: outcome.nextStatus,
    delivered,
    sent,
    failed,
    simulated,
    skippedRecent,
    demoMode: env.DEMO_MODE,
    notifications: results,
    actionId: outcome.actionId,
  };
}
