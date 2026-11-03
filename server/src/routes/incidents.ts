import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db/pool.js';
import { requireAuth, requireAuthority, AUTHORITY, AUTHORITY_ADMIN_ROLES, VERIFIERS } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/errors.js';
import { INCIDENT_TRANSITIONS, type IncidentStatus } from '../types.js';
import { audit } from '../lib/audit.js';
import { nextPublicRef } from '../lib/refs.js';
import { createIncidentUpdateNotifications } from '../services/notifications.js';
import { isWithinMumbai } from '../services/geo.js';

export const incidentsRouter = Router();
incidentsRouter.use(requireAuth, requireAuthority);

incidentsRouter.get('/', async (req, res, next) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : null;
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 30)));
    const rows = await query<Record<string, unknown>>(
      `SELECT i.id, i.public_ref, i.category, i.title, i.description, i.status, i.risk_level, i.detected_at,
              i.created_at, i.updated_at, i.is_simulated, i.locality_id, l.name AS locality_name,
              ST_Y(i.location::geometry)::float8 AS lat, ST_X(i.location::geometry)::float8 AS lng,
              u.name AS assigned_to_name, i.assigned_to,
              (SELECT COUNT(*)::int FROM investigation_notes n WHERE n.incident_id=i.id) AS note_count,
              (SELECT COUNT(*)::int FROM corrective_actions c WHERE c.incident_id=i.id) AS action_count,
              i.official_determination IS NOT NULL AS has_determination
       FROM environmental_incidents i
       LEFT JOIN localities l ON l.id=i.locality_id
       LEFT JOIN users u ON u.id=i.assigned_to
       WHERE i.simulation_session_id IS NULL
         AND ($1::text IS NULL OR i.category=$1)
         AND ($2::text IS NULL OR i.status=$2)
       ORDER BY i.detected_at DESC LIMIT $3 OFFSET $4`,
      [category, status, pageSize, (page - 1) * pageSize],
    );
    res.json({ incidents: rows, page, pageSize });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.post('/', async (req, res, next) => {
  try {
    if (!AUTHORITY.includes(req.user!.role)) throw forbidden('Authority role required.');
    const body = z
      .object({
        category: z.enum(['air', 'water', 'waste', 'industrial']),
        title: z.string().trim().min(5).max(200),
        description: z.string().trim().min(10).max(4000),
        localityId: z.string().uuid().nullable().optional(),
        lat: z.number().finite().nullable().optional(),
        lng: z.number().finite().nullable().optional(),
        riskLevel: z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']).default('MODERATE'),
        sourceAlertId: z.string().uuid().nullable().optional(),
        sourceReportId: z.string().uuid().nullable().optional(),
        reason: z.string().min(5).max(1000),
      })
      .parse(req.body);
    if (body.lat != null && body.lng != null && !isWithinMumbai(body.lat, body.lng)) {
      throw badRequest('Incident location must be inside Greater Mumbai.');
    }
    let localityId = body.localityId ?? null;
    let lat = body.lat ?? null;
    let lng = body.lng ?? null;
    if (body.sourceAlertId) {
      const alert = await one<{ locality_id: string | null; station_lat: number | null; station_lng: number | null }>(
        `SELECT a.locality_id, ST_Y(s.location::geometry)::float8 AS station_lat, ST_X(s.location::geometry)::float8 AS station_lng
         FROM environmental_alerts a LEFT JOIN monitoring_stations s ON s.id=a.station_id WHERE a.id=$1`,
        [body.sourceAlertId],
      );
      if (!alert) throw notFound('Source alert not found.');
      localityId = localityId ?? alert.locality_id;
      lat = lat ?? alert.station_lat;
      lng = lng ?? alert.station_lng;
    }
    if (body.sourceReportId) {
      const report = await one<{ locality_id: string | null; lat: number; lng: number; status: string; category: string }>(
        `SELECT locality_id, ST_Y(location::geometry)::float8 AS lat, ST_X(location::geometry)::float8 AS lng, status, category
         FROM environmental_reports WHERE id=$1`,
        [body.sourceReportId],
      );
      if (!report) throw notFound('Source report not found.');
      if (report.status !== 'VERIFIED') throw conflict('Only a verified report can be linked to a new incident.');
      if (report.category !== body.category) throw badRequest('Report and incident categories must match.');
      localityId = localityId ?? report.locality_id;
      lat = lat ?? report.lat;
      lng = lng ?? report.lng;
    }
    const publicRef = await nextPublicRef('I', 'incident_ref_seq');
    const row = await one<{ id: string }>(
      `INSERT INTO environmental_incidents
         (public_ref, category, title, description, locality_id, location, status, risk_level, detected_at,
          source_alert_id, source_report_id, created_by, is_simulated)
       VALUES ($1,$2,$3,$4,$5,
         CASE WHEN $6::float8 IS NOT NULL AND $7::float8 IS NOT NULL
           THEN ST_SetSRID(ST_MakePoint($7,$6),4326)::geography ELSE NULL END,
         'NEW',$8,now(),$9,$10,$11,false)
       RETURNING id`,
      [
        publicRef,
        body.category,
        body.title,
        body.description,
        localityId,
        lat,
        lng,
        body.riskLevel,
        body.sourceAlertId ?? null,
        body.sourceReportId ?? null,
        req.user!.id,
      ],
    );
    if (!row) throw badRequest('Incident creation failed.');
    if (body.sourceReportId) {
      await query(`UPDATE environmental_reports SET status='LINKED_TO_INVESTIGATION', updated_at=now() WHERE id=$1`, [
        body.sourceReportId,
      ]);
    }
    await query(`INSERT INTO investigation_notes (incident_id, author_id, note) VALUES ($1,$2,$3)`, [
      row.id,
      req.user!.id,
      `Incident created: ${body.reason}`,
    ]);
    await audit({
      actorId: req.user!.id,
      action: 'INCIDENT_CREATED',
      entityType: 'environmental_incident',
      entityId: row.id,
      after: { publicRef, category: body.category, sourceAlertId: body.sourceAlertId, sourceReportId: body.sourceReportId, reason: body.reason },
      ip: req.ip,
    });
    res.status(201).json({ incident: { id: row.id, publicRef, status: 'NEW' } });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.get('/:id', async (req, res, next) => {
  try {
    const incident = await one<Record<string, unknown>>(
      `SELECT i.*, l.name AS locality_name, ST_Y(i.location::geometry)::float8 AS lat, ST_X(i.location::geometry)::float8 AS lng,
              u.name AS assigned_to_name, u.email AS assigned_to_email,
              creator.name AS created_by_name,
              determiner.name AS determination_by_name,
              a.public_ref AS source_alert_ref, a.title AS source_alert_title,
              r.public_ref AS source_report_ref
       FROM environmental_incidents i
       LEFT JOIN localities l ON l.id=i.locality_id
       LEFT JOIN users u ON u.id=i.assigned_to
       LEFT JOIN users creator ON creator.id=i.created_by
       LEFT JOIN users determiner ON determiner.id=i.official_determination_by
       LEFT JOIN environmental_alerts a ON a.id=i.source_alert_id
       LEFT JOIN environmental_reports r ON r.id=i.source_report_id
       WHERE i.id=$1`,
      [req.params.id],
    );
    if (!incident) throw notFound('Incident not found.');
    const [notes, actions, assignments, reports, alerts, auditRows, notifications, nearbyReadings, standards] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT n.id, n.note, n.created_at, n.is_simulated, u.name AS author_name, u.role::text AS author_role
         FROM investigation_notes n LEFT JOIN users u ON u.id=n.author_id WHERE n.incident_id=$1 ORDER BY n.created_at`,
        [incident.id],
      ),
      query<Record<string, unknown>>(
        `SELECT c.*, u.name AS created_by_name FROM corrective_actions c LEFT JOIN users u ON u.id=c.created_by
         WHERE c.incident_id=$1 ORDER BY c.created_at`,
        [incident.id],
      ),
      query<Record<string, unknown>>(
        `SELECT a.id, a.assigned_at, a.note, u.name AS assigned_to_name, b.name AS assigned_by_name
         FROM incident_assignments a LEFT JOIN users u ON u.id=a.assigned_to LEFT JOIN users b ON b.id=a.assigned_by
         WHERE a.incident_id=$1 ORDER BY a.assigned_at`,
        [incident.id],
      ),
      query<Record<string, unknown>>(
        `SELECT r.id, r.public_ref, r.category, r.incident_type, r.description, r.status, r.verification_state,
                r.submitted_at, r.is_simulated
         FROM environmental_reports r
         WHERE r.id=$1 OR ($2::uuid IS NOT NULL AND r.locality_id=$2 AND r.category=$3)
         ORDER BY r.submitted_at DESC LIMIT 10`,
        [incident.source_report_id, incident.locality_id, incident.category],
      ),
      query<Record<string, unknown>>(
        `SELECT id, public_ref, level, state, trigger_type, title, summary, triggered_at, is_simulated
         FROM environmental_alerts WHERE (id=$1 OR ($2::uuid IS NOT NULL AND locality_id=$2 AND category=$3))
           AND (simulation_session_id IS NULL OR id=$1)
         ORDER BY triggered_at DESC LIMIT 10`,
        [incident.source_alert_id, incident.locality_id, incident.category],
      ),
      query<Record<string, unknown>>(
        `SELECT actor_id, action, before, after, created_at FROM audit_logs
         WHERE entity_type='environmental_incident' AND entity_id=$1 ORDER BY created_at`,
        [incident.id],
      ),
      query<Record<string, unknown>>(
        `SELECT id, audience, template, status, created_at, sent_at, delivered_at, is_simulated, alert_id, incident_id
         FROM notifications WHERE incident_id=$1 OR alert_id=$2 ORDER BY created_at DESC LIMIT 20`,
        [incident.id, incident.source_alert_id],
      ),
      query<Record<string, unknown>>(
        `SELECT s.id, s.name, s.code, s.station_type, s.is_simulated,
                ST_Distance(s.location, i.location)::float8 AS distance_m,
                (SELECT jsonb_object_agg(pollutant_code, jsonb_build_object('value', value::float8, 'unit', unit, 'observedAt', observed_at, 'sourceId', source_id, 'isSimulated', is_simulated))
                 FROM (SELECT DISTINCT ON (pollutant_code) * FROM environmental_observations o
                       WHERE o.station_id=s.id AND o.observed_at > now() - interval '24 hours'
                       ORDER BY pollutant_code, observed_at DESC) latest) AS latest_readings
         FROM environmental_incidents i JOIN monitoring_stations s ON i.location IS NOT NULL AND ST_DWithin(s.location, i.location, 5000)
         WHERE i.id=$1 ORDER BY distance_m LIMIT 5`,
        [incident.id],
      ),
      query<Record<string, unknown>>(
        `SELECT st.*, d.title AS document_title, d.authority, d.url, d.verification_status
         FROM regulatory_standards st JOIN regulatory_documents d ON d.id=st.document_id
         WHERE st.category=$1 ORDER BY st.parameter`,
        [incident.category],
      ),
    ]);
    res.json({
      incident,
      notes,
      correctiveActions: actions,
      assignments,
      relatedReports: reports,
      relatedAlerts: alerts,
      audit: auditRows,
      notifications,
      nearbyReadings,
      standards,
      lifecycle: INCIDENT_TRANSITIONS,
    });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.patch('/:id/status', async (req, res, next) => {
  try {
    if (!AUTHORITY.includes(req.user!.role)) throw forbidden('Authority role required.');
    const body = z.object({ status: z.string(), reason: z.string().min(5).max(2000) }).parse(req.body);
    const incident = await one<{ id: string; status: IncidentStatus; assigned_to: string | null }>(
      'SELECT id, status, assigned_to FROM environmental_incidents WHERE id=$1',
      [req.params.id],
    );
    if (!incident) throw notFound('Incident not found.');
    const target = body.status as IncidentStatus;
    const allowed = INCIDENT_TRANSITIONS[incident.status] ?? [];
    if (!allowed.includes(target)) throw conflict(`Cannot move incident from ${incident.status} to ${target}.`);
    if (target === 'CLOSED' && !AUTHORITY_ADMIN_ROLES.includes(req.user!.role)) {
      throw forbidden('Only an authority administrator or system administrator can close an incident.');
    }
    if (incident.status === 'NEW' && target === 'UNDER_REVIEW' && req.user!.role === 'FIELD_OFFICER') {
      throw forbidden('Field officers cannot validate their own assignment at review stage.');
    }
    if ((target === 'INVESTIGATION' || target === 'CORRECTIVE_ACTION') && !incident.assigned_to) {
      throw conflict('Assign the incident before starting field investigation.');
    }
    await query(
      `UPDATE environmental_incidents SET status=$2, updated_at=now(),
         closed_at=CASE WHEN $2='CLOSED' THEN now() ELSE closed_at END WHERE id=$1`,
      [incident.id, target],
    );
    await query(`INSERT INTO investigation_notes (incident_id, author_id, note) VALUES ($1,$2,$3)`, [
      incident.id,
      req.user!.id,
      `Status ${incident.status} → ${target}. Reason: ${body.reason}`,
    ]);
    await createIncidentUpdateNotifications(incident.id, `Status changed from ${incident.status} to ${target}. Reason: ${body.reason}`);
    await audit({
      actorId: req.user!.id,
      action: 'INCIDENT_STATUS_CHANGED',
      entityType: 'environmental_incident',
      entityId: incident.id,
      before: { status: incident.status },
      after: { status: target, reason: body.reason },
      ip: req.ip,
    });
    res.json({ message: `Incident moved to ${target}.`, status: target });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.post('/:id/notes', async (req, res, next) => {
  try {
    if (!VERIFIERS.includes(req.user!.role)) throw forbidden();
    const body = z.object({ note: z.string().trim().min(3).max(4000) }).parse(req.body);
    const incident = await one<{ id: string }>('SELECT id FROM environmental_incidents WHERE id=$1', [req.params.id]);
    if (!incident) throw notFound('Incident not found.');
    const row = await one<{ id: string }>(
      `INSERT INTO investigation_notes (incident_id, author_id, note) VALUES ($1,$2,$3) RETURNING id`,
      [incident.id, req.user!.id, body.note],
    );
    await audit({
      actorId: req.user!.id,
      action: 'INVESTIGATION_NOTE_ADDED',
      entityType: 'environmental_incident',
      entityId: incident.id,
      after: { noteId: row?.id, note: body.note },
      ip: req.ip,
    });
    res.status(201).json({ message: 'Investigation note added.', noteId: row?.id });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.post('/:id/assign', async (req, res, next) => {
  try {
    if (!AUTHORITY_ADMIN_ROLES.includes(req.user!.role)) throw forbidden('Only an authority administrator can assign incidents.');
    const body = z.object({ userId: z.string().uuid(), note: z.string().max(1000).optional() }).parse(req.body);
    const incident = await one<{ id: string; status: string }>('SELECT id, status FROM environmental_incidents WHERE id=$1', [
      req.params.id,
    ]);
    if (!incident) throw notFound('Incident not found.');
    const assignee = await one<{ id: string; name: string; role: string; account_status: string }>(
      'SELECT id, name, role::text, account_status FROM users WHERE id=$1',
      [body.userId],
    );
    if (!assignee || assignee.account_status !== 'ACTIVE') throw notFound('Assignee not found or inactive.');
    if (!AUTHORITY.includes(assignee.role as never)) throw badRequest('Assignee must have an authority role.');
    await query(`UPDATE environmental_incidents SET assigned_to=$2, status=CASE WHEN status='UNDER_REVIEW' THEN 'ASSIGNED' ELSE status END, updated_at=now() WHERE id=$1`, [
      incident.id,
      assignee.id,
    ]);
    await query(`INSERT INTO incident_assignments (incident_id, assigned_to, assigned_by, note) VALUES ($1,$2,$3,$4)`, [
      incident.id,
      assignee.id,
      req.user!.id,
      body.note ?? null,
    ]);
    await createIncidentUpdateNotifications(incident.id, `Incident assigned to ${assignee.name}. ${body.note ?? ''}`);
    await audit({
      actorId: req.user!.id,
      action: 'INCIDENT_ASSIGNED',
      entityType: 'environmental_incident',
      entityId: incident.id,
      after: { assignedTo: assignee.id, note: body.note },
      ip: req.ip,
    });
    res.json({ message: 'Incident assigned.' });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.post('/:id/actions', async (req, res, next) => {
  try {
    if (!VERIFIERS.includes(req.user!.role)) throw forbidden();
    const body = z
      .object({ description: z.string().trim().min(5).max(2000), dueAt: z.string().datetime({ offset: true }).optional() })
      .parse(req.body);
    const incident = await one<{ id: string }>('SELECT id FROM environmental_incidents WHERE id=$1', [req.params.id]);
    if (!incident) throw notFound('Incident not found.');
    const row = await one<{ id: string }>(
      `INSERT INTO corrective_actions (incident_id, description, status, due_at, created_by)
       VALUES ($1,$2,'RECOMMENDED',$3,$4) RETURNING id`,
      [incident.id, body.description, body.dueAt ?? null, req.user!.id],
    );
    await audit({
      actorId: req.user!.id,
      action: 'CORRECTIVE_ACTION_ADDED',
      entityType: 'environmental_incident',
      entityId: incident.id,
      after: { actionId: row?.id, description: body.description },
      ip: req.ip,
    });
    res.status(201).json({ message: 'Corrective action recorded.', actionId: row?.id });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.patch('/:id/actions/:actionId', async (req, res, next) => {
  try {
    if (!VERIFIERS.includes(req.user!.role)) throw forbidden();
    const body = z
      .object({
        status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED']),
        evidenceNote: z.string().max(2000).optional(),
      })
      .parse(req.body);
    const action = await one<{ id: string; incident_id: string; status: string }>(
      'SELECT id, incident_id, status FROM corrective_actions WHERE id=$1 AND incident_id=$2',
      [req.params.actionId, req.params.id],
    );
    if (!action) throw notFound('Corrective action not found.');
    if (body.status === 'VERIFIED' && !AUTHORITY_ADMIN_ROLES.includes(req.user!.role)) {
      throw forbidden('Only an authority administrator can verify a corrective action.');
    }
    await query(
      `UPDATE corrective_actions SET status=$2, completed_at=CASE WHEN $2 IN ('COMPLETED','VERIFIED') THEN now() ELSE completed_at END,
         evidence_note=COALESCE($3,evidence_note) WHERE id=$1`,
      [action.id, body.status, body.evidenceNote ?? null],
    );
    await audit({
      actorId: req.user!.id,
      action: 'CORRECTIVE_ACTION_UPDATED',
      entityType: 'environmental_incident',
      entityId: action.incident_id,
      before: { actionId: action.id, status: action.status },
      after: { status: body.status, evidenceNote: body.evidenceNote },
      ip: req.ip,
    });
    res.json({ message: 'Corrective action updated.' });
  } catch (error) {
    next(error);
  }
});

incidentsRouter.post('/:id/determination', async (req, res, next) => {
  try {
    if (!AUTHORITY_ADMIN_ROLES.includes(req.user!.role)) {
      throw forbidden('Only an authority administrator can record an official determination.');
    }
    const body = z
      .object({
        determination: z.string().trim().min(10).max(4000),
        basis: z.string().trim().min(5).max(4000),
      })
      .parse(req.body);
    const incident = await one<{ id: string; official_determination: string | null }>(
      'SELECT id, official_determination FROM environmental_incidents WHERE id=$1',
      [req.params.id],
    );
    if (!incident) throw notFound('Incident not found.');
    await query(
      `UPDATE environmental_incidents SET official_determination=$2, official_determination_by=$3,
         official_determination_at=now(), updated_at=now() WHERE id=$1`,
      [incident.id, body.determination, req.user!.id],
    );
    await query(`INSERT INTO investigation_notes (incident_id, author_id, note) VALUES ($1,$2,$3)`, [
      incident.id,
      req.user!.id,
      `Official determination recorded: ${body.determination}\nBasis: ${body.basis}`,
    ]);
    await audit({
      actorId: req.user!.id,
      action: 'OFFICIAL_DETERMINATION_RECORDED',
      entityType: 'environmental_incident',
      entityId: incident.id,
      before: { determination: incident.official_determination },
      after: { determination: body.determination, basis: body.basis },
      ip: req.ip,
    });
    res.json({ message: 'Official determination recorded with audit trail.' });
  } catch (error) {
    next(error);
  }
});
