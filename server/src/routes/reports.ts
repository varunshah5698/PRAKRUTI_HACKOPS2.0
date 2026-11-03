import { Router } from 'express';
import multer from 'multer';
import exifr from 'exifr';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query, one } from '../db/pool.js';
import { optionalAuth, requireAuth, VERIFIERS } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/errors.js';
import { isWithinMumbai, haversineKm } from '../services/geo.js';
import { saveEvidence, readEvidence, evidenceLimits } from '../services/storage.js';
import { analyzeEvidenceImage } from '../services/ai/analyst.js';
import { audit } from '../lib/audit.js';
import { nextPublicRef } from '../lib/refs.js';
import { REPORT_TRANSITIONS, type ReportStatus } from '../types.js';
import { evaluateWasteLocalities } from '../services/risk.js';
import { syncAlertsFromWasteAssessments } from '../services/alerts.js';
import { notifyReportStatusChange } from '../services/notifications.js';

export const reportsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: evidenceLimits.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!evidenceLimits.mimeTypes.includes(file.mimetype)) {
      cb(badRequest('Only JPEG, PNG or WebP photographs are accepted.'));
      return;
    }
    cb(null, true);
  },
});

const submitLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 12, standardHeaders: true, legacyHeaders: false });

async function enrichReport(reportId: string) {
  const stations = await query<Record<string, unknown>>(
    `SELECT s.id, s.code, s.name, s.station_type, s.health_status, s.is_simulated,
            ST_Distance(s.location, r.location)::float8 AS distance_m,
            (SELECT jsonb_object_agg(pollutant_code, jsonb_build_object('value', value::float8, 'unit', unit, 'observedAt', observed_at, 'sourceId', source_id, 'isSimulated', is_simulated))
             FROM (SELECT DISTINCT ON (pollutant_code) * FROM environmental_observations o
                   WHERE o.station_id=s.id AND o.observed_at > now() - interval '24 hours'
                   ORDER BY pollutant_code, observed_at DESC) latest) AS latest_readings
     FROM environmental_reports r
     JOIN monitoring_stations s ON ST_DWithin(s.location, r.location, 3000)
     WHERE r.id=$1 ORDER BY distance_m LIMIT 5`,
    [reportId],
  );
  const weather = await query<Record<string, unknown>>(
    `SELECT w.observed_at, w.temperature_c::float8, w.relative_humidity::float8, w.wind_speed_kmh::float8,
            w.wind_direction_deg::float8, w.precipitation_mm::float8, w.is_simulated, w.source_id,
            ST_Distance(w.location, r.location)::float8 AS distance_m
     FROM environmental_reports r
     JOIN weather_observations w ON ST_DWithin(w.location, r.location, 5000) AND w.kind='OBSERVATION'
     WHERE r.id=$1 ORDER BY w.observed_at DESC, distance_m LIMIT 1`,
    [reportId],
  );
  const nearbyReports = await query<Record<string, unknown>>(
    `SELECT r2.id, r2.public_ref, r2.category, r2.incident_type, r2.status, r2.verification_state, r2.submitted_at,
            ST_Distance(r2.location, r1.location)::float8 AS distance_m, r2.is_simulated
     FROM environmental_reports r1 JOIN environmental_reports r2 ON r2.id <> r1.id
     WHERE r1.id=$1 AND ST_DWithin(r2.location, r1.location, 500)
     ORDER BY distance_m LIMIT 8`,
    [reportId],
  );
  const alerts = await query<Record<string, unknown>>(
    `SELECT a.id, a.public_ref, a.category, a.level, a.state, a.trigger_type, a.title, a.triggered_at, a.is_simulated
     FROM environmental_reports r JOIN environmental_alerts a ON a.category=r.category AND a.state NOT IN ('CLOSED','RECOVERY')
     WHERE r.id=$1 AND a.simulation_session_id IS NULL AND (a.locality_id = r.locality_id OR (a.station_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM monitoring_stations s WHERE s.id=a.station_id AND ST_DWithin(s.location, r.location, 3000))))
     ORDER BY a.triggered_at DESC LIMIT 5`,
    [reportId],
  );
  const incidents = await query<Record<string, unknown>>(
    `SELECT i.id, i.public_ref, i.category, i.title, i.status, i.risk_level, i.detected_at,
            ST_Distance(i.location, r.location)::float8 AS distance_m, i.is_simulated
     FROM environmental_reports r JOIN environmental_incidents i ON i.category=r.category AND i.location IS NOT NULL
     WHERE r.id=$1 AND i.simulation_session_id IS NULL AND ST_DWithin(i.location, r.location, 3000)
     ORDER BY i.detected_at DESC LIMIT 5`,
    [reportId],
  );
  return { stations, weather: weather[0] ?? null, nearbyReports, alerts, incidents };
}

async function getReportRow(id: string) {
  return one<Record<string, unknown>>(
    `SELECT r.*, l.name AS locality_name, ST_Y(r.location::geometry)::float8 AS lat,
            ST_X(r.location::geometry)::float8 AS lng
     FROM environmental_reports r LEFT JOIN localities l ON l.id=r.locality_id WHERE r.id=$1`,
    [id],
  );
}

reportsRouter.post('/', optionalAuth, submitLimiter, upload.single('photo'), async (req, res, next) => {
  try {
    const schema = z.object({
      category: z.enum(['air', 'water', 'waste', 'industrial']),
      incidentType: z.string().trim().min(2).max(100),
      description: z.string().trim().min(15).max(4000),
      lat: z.coerce.number().finite(),
      lng: z.coerce.number().finite(),
      localityId: z.string().uuid(),
      occurredAt: z.string().datetime({ offset: true }),
      contactName: z.string().trim().max(120).optional().or(z.literal('')),
      contactEmail: z.string().trim().email().max(200).optional().or(z.literal('')),
      contactPhone: z.string().trim().max(40).optional().or(z.literal('')),
      consent: z
        .union([z.boolean(), z.string()])
        .transform((v) => v === true || v === 'true'),
    });
    const body = schema.parse(req.body);
    if (!body.consent) throw badRequest('Consent is required to submit a report.');
    if (!isWithinMumbai(body.lat, body.lng)) {
      throw badRequest('Report location must be inside the Greater Mumbai boundary.');
    }
    const locality = await one<{ id: string; name: string }>('SELECT id, name FROM localities WHERE id=$1', [
      body.localityId,
    ]);
    if (!locality) throw badRequest('Unknown Mumbai locality.');
    const occurredAt = new Date(body.occurredAt);
    if (occurredAt.getTime() > Date.now() + 10 * 60_000) throw badRequest('Incident time cannot be in the future.');

    const publicRef = await nextPublicRef('R', 'report_ref_seq');
    const row = await one<{ id: string }>(
      `INSERT INTO environmental_reports
         (public_ref, user_id, category, incident_type, description, location, locality_id, occurred_at,
          status, verification_state, contact_name, contact_email, contact_phone, consent, ai_vision_status, is_simulated)
       VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,$8,$9,'SUBMITTED','UNVERIFIED',$10,$11,$12,true,'NOT_CONFIGURED',false)
       RETURNING id`,
      [
        publicRef,
        req.user?.id ?? null,
        body.category,
        body.incidentType,
        body.description,
        body.lng,
        body.lat,
        body.localityId,
        occurredAt.toISOString(),
        body.contactName || null,
        body.contactEmail || null,
        body.contactPhone || null,
      ],
    );
    if (!row) throw badRequest('Report submission failed.');

    let visionStatus: 'COMPLETED' | 'NOT_CONFIGURED' | 'FAILED' = 'NOT_CONFIGURED';
    if (req.file) {
      const saved = await saveEvidence(req.file.buffer, req.file.mimetype, req.file.originalname);
      let exif: Record<string, unknown> | null = null;
      try {
        const parsed = await exifr.parse(req.file.buffer, { gps: true, pick: ['Make', 'Model', 'DateTimeOriginal', 'latitude', 'longitude'] });
        exif = parsed ?? null;
      } catch {
        exif = null;
      }
      let gpsConsistency = 'NO_GPS';
      const exifLat = exif?.latitude as number | undefined;
      const exifLng = exif?.longitude as number | undefined;
      if (typeof exifLat === 'number' && typeof exifLng === 'number') {
        const distance = haversineKm({ lat: exifLat, lng: exifLng }, { lat: body.lat, lng: body.lng });
        gpsConsistency = distance <= 2 ? 'MATCH' : 'MISMATCH';
      }
      await query(
        `INSERT INTO report_evidence
           (report_id, storage_key, original_name, mime_type, size_bytes, sha256, exif, gps_consistency, malware_scan_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'NOT_CONFIGURED')`,
        [
          row.id,
          saved.key,
          saved.originalName,
          saved.mime,
          saved.size,
          saved.sha256,
          exif ? JSON.stringify(exif) : null,
          gpsConsistency,
        ],
      );
      const vision = await analyzeEvidenceImage(req.file.buffer, saved.mime);
      visionStatus = vision.status;
      await query(
        `INSERT INTO ai_assessments (report_id, assessment_type, provider, model, status, output)
         VALUES ($1,'REPORT_VISUAL_ASSESSMENT',$2,$3,$4,$5::jsonb)`,
        [row.id, vision.provider, vision.provider === 'none' ? null : vision.provider, vision.status, JSON.stringify(vision.output)],
      );
    } else {
      await query(
        `INSERT INTO ai_assessments (report_id, assessment_type, provider, model, status, output)
         VALUES ($1,'REPORT_VISUAL_ASSESSMENT','none',NULL,'NOT_CONFIGURED',$2::jsonb)`,
        [
          row.id,
          JSON.stringify({
            status: 'NOT_CONFIGURED',
            reason: 'No photograph was attached, and no vision model is configured.',
            limitations: ['A photograph could not establish chemical composition, toxicity, concentration or legal responsibility.'],
          }),
        ],
      );
    }

    const nextStatus = visionStatus === 'COMPLETED' ? 'AI_ASSESSED' : 'AWAITING_VERIFICATION';
    await query(
      `UPDATE environmental_reports SET status=$2, ai_vision_status=$3, updated_at=now() WHERE id=$1`,
      [row.id, nextStatus, visionStatus],
    );
    await audit({
      actorId: req.user?.id ?? null,
      action: 'REPORT_SUBMITTED',
      entityType: 'environmental_report',
      entityId: row.id,
      after: { publicRef, category: body.category, status: nextStatus, visionStatus },
      ip: req.ip,
    });
    const enrichment = await enrichReport(row.id);
    res.status(201).json({
      report: {
        id: row.id,
        publicRef,
        status: nextStatus,
        verificationState: 'UNVERIFIED',
        isSimulated: false,
        aiVisionStatus: visionStatus,
      },
      aiVision:
        visionStatus === 'NOT_CONFIGURED'
          ? {
              status: 'NOT_CONFIGURED',
              message:
                'No vision-capable model is configured. The River text model is not assumed to inspect images. Initial visual assessment is unavailable.',
            }
          : { status: visionStatus },
      enrichment,
      note: 'A report is not an official violation. Verification requires an authorised reviewer.',
    });
  } catch (error) {
    if (error instanceof multer.MulterError) {
      next(badRequest(error.code === 'LIMIT_FILE_SIZE' ? 'Photograph must be 8 MB or smaller.' : error.message));
      return;
    }
    next(error);
  }
});

reportsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : null;
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const verification = typeof req.query.verification === 'string' ? req.query.verification : null;
    const localityId = typeof req.query.localityId === 'string' ? req.query.localityId : null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 20)));
    const isAuthority = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'].includes(req.user!.role);
    const rows = await query<Record<string, unknown>>(
      `SELECT r.id, r.public_ref, r.category, r.incident_type, r.description, r.status, r.verification_state,
              r.occurred_at, r.submitted_at, r.is_simulated, r.locality_id, l.name AS locality_name,
              ST_Y(r.location::geometry)::float8 AS lat, ST_X(r.location::geometry)::float8 AS lng,
              (SELECT COUNT(*)::int FROM report_evidence e WHERE e.report_id=r.id) AS evidence_count,
              (SELECT COUNT(*)::int FROM ai_assessments a WHERE a.report_id=r.id AND a.status='COMPLETED') AS ai_assessed
       FROM environmental_reports r LEFT JOIN localities l ON l.id=r.locality_id
       WHERE ($1::boolean OR r.user_id=$2)
         AND ($3::text IS NULL OR r.category=$3)
         AND ($4::text IS NULL OR r.status=$4)
         AND ($5::text IS NULL OR r.verification_state=$5)
         AND ($6::uuid IS NULL OR r.locality_id=$6)
       ORDER BY r.submitted_at DESC LIMIT $7 OFFSET $8`,
      [
        isAuthority,
        req.user!.id,
        category,
        status,
        verification,
        localityId,
        pageSize,
        (page - 1) * pageSize,
      ],
    );
    const total = await one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM environmental_reports r
       WHERE ($1::boolean OR r.user_id=$2)
         AND ($3::text IS NULL OR r.category=$3)
         AND ($4::text IS NULL OR r.status=$4)
         AND ($5::text IS NULL OR r.verification_state=$5)
         AND ($6::uuid IS NULL OR r.locality_id=$6)`,
      [isAuthority, req.user!.id, category, status, verification, localityId],
    );
    res.json({ reports: rows, total: total?.count ?? 0, page, pageSize });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const report = await getReportRow(req.params.id);
    if (!report) throw notFound('Report not found.');
    const isAuthority = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'].includes(req.user!.role);
    if (!isAuthority && report.user_id !== req.user!.id) throw forbidden('You can only view your own reports.');
    const [evidence, assessments, enrichment, auditRows] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT id, original_name, mime_type, size_bytes, sha256, gps_consistency, malware_scan_status, uploaded_at
         FROM report_evidence WHERE report_id=$1 ORDER BY uploaded_at`,
        [report.id],
      ),
      query<Record<string, unknown>>(
        `SELECT id, assessment_type, provider, model, status, output, created_at FROM ai_assessments
         WHERE report_id=$1 ORDER BY created_at DESC`,
        [report.id],
      ),
      enrichReport(String(report.id)),
      query<Record<string, unknown>>(
        `SELECT id, actor_id, action, after, created_at FROM audit_logs
         WHERE entity_type='environmental_report' AND entity_id=$1 ORDER BY created_at`,
        [report.id],
      ),
    ]);
    res.json({ report, evidence, aiAssessments: assessments, enrichment, audit: auditRows });
  } catch (error) {
    next(error);
  }
});

reportsRouter.patch('/:id/status', requireAuth, async (req, res, next) => {
  try {
    if (!VERIFIERS.includes(req.user!.role)) throw forbidden('Only authorised reviewers can change report status.');
    const body = z
      .object({ status: z.enum(['AWAITING_VERIFICATION', 'VERIFIED', 'UNVERIFIED', 'LINKED_TO_INVESTIGATION']), reason: z.string().min(5).max(1000) })
      .parse(req.body);
    const report = await getReportRow(req.params.id);
    if (!report) throw notFound('Report not found.');
    const current = String(report.status) as ReportStatus;
    const allowed = REPORT_TRANSITIONS[current] ?? [];
    if (!allowed.includes(body.status as ReportStatus)) {
      throw conflict(`Cannot move report from ${current} to ${body.status}.`);
    }
    if (body.status === 'LINKED_TO_INVESTIGATION') {
      throw badRequest('Link the report to an incident through the incident linkage endpoint.');
    }
    const verification = body.status === 'VERIFIED' ? 'VERIFIED' : body.status === 'UNVERIFIED' ? 'REJECTED' : report.verification_state;
    await query(
      `UPDATE environmental_reports SET status=$2, verification_state=$3, updated_at=now() WHERE id=$1`,
      [report.id, body.status, verification],
    );
    await audit({
      actorId: req.user!.id,
      action: 'REPORT_STATUS_CHANGED',
      entityType: 'environmental_report',
      entityId: String(report.id),
      before: { status: current, verification: report.verification_state },
      after: { status: body.status, verification, reason: body.reason },
      ip: req.ip,
    });
    const notified = await notifyReportStatusChange(String(report.id), { status: body.status, reason: body.reason });
    if (String(report.category) === 'waste' && (body.status === 'VERIFIED' || body.status === 'UNVERIFIED')) {
      const assessments = await evaluateWasteLocalities();
      await syncAlertsFromWasteAssessments(assessments, Boolean(report.is_simulated));
    }
    res.json({
      message: `Report moved to ${body.status}.`,
      status: body.status,
      verificationState: verification,
      citizenNotified: notified,
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.post('/:id/link-incident', requireAuth, async (req, res, next) => {
  try {
    if (!VERIFIERS.includes(req.user!.role)) throw forbidden('Only authorised reviewers can link reports to incidents.');
    const body = z.object({ incidentId: z.string().uuid(), reason: z.string().min(5).max(1000) }).parse(req.body);
    const report = await getReportRow(req.params.id);
    if (!report) throw notFound('Report not found.');
    if (report.status !== 'VERIFIED') throw conflict('Only a verified report can be linked to an incident.');
    const incident = await one<{ id: string; category: string }>('SELECT id, category FROM environmental_incidents WHERE id=$1', [
      body.incidentId,
    ]);
    if (!incident) throw notFound('Incident not found.');
    if (incident.category !== report.category) throw badRequest('Report and incident categories must match.');
    await query(`UPDATE environmental_reports SET status='LINKED_TO_INVESTIGATION', updated_at=now() WHERE id=$1`, [report.id]);
    await query(`UPDATE environmental_incidents SET source_report_id=COALESCE(source_report_id,$2), updated_at=now() WHERE id=$1`, [
      incident.id,
      report.id,
    ]);
    await audit({
      actorId: req.user!.id,
      action: 'REPORT_LINKED_TO_INCIDENT',
      entityType: 'environmental_report',
      entityId: String(report.id),
      after: { incidentId: incident.id, reason: body.reason },
      ip: req.ip,
    });
    await notifyReportStatusChange(String(report.id), { status: 'LINKED_TO_INVESTIGATION', reason: body.reason });
    res.json({ message: 'Report linked to incident.', incidentId: incident.id });
  } catch (error) {
    next(error);
  }
});

export const evidenceRouter = Router();
evidenceRouter.use(requireAuth);
evidenceRouter.get('/:id', async (req, res, next) => {
  try {
    const evidence = await one<{
      id: string;
      report_id: string;
      storage_key: string;
      mime_type: string;
      original_name: string | null;
      user_id: string | null;
    }>(
      `SELECT e.id, e.report_id, e.storage_key, e.mime_type, e.original_name, r.user_id
       FROM report_evidence e JOIN environmental_reports r ON r.id=e.report_id WHERE e.id=$1`,
      [req.params.id],
    );
    if (!evidence) throw notFound('Evidence not found.');
    const isAuthority = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'].includes(req.user!.role);
    if (!isAuthority && evidence.user_id !== req.user!.id) throw forbidden('This evidence is private.');
    const buffer = await readEvidence(evidence.storage_key);
    await audit({
      actorId: req.user!.id,
      action: 'EVIDENCE_VIEWED',
      entityType: 'report_evidence',
      entityId: evidence.id,
      ip: req.ip,
    });
    res.setHeader('Content-Type', evidence.mime_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${evidence.original_name ?? 'evidence'}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});
