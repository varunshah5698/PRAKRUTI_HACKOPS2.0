import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db/pool.js';
import { requireAuth, AUTHORITY, AUTHORITY_ADMIN_ROLES, VERIFIERS } from '../middleware/auth.js';
import { forbidden, notFound } from '../middleware/errors.js';
import { closeAlert } from '../services/alerts.js';
import { audit } from '../lib/audit.js';

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

alertsRouter.get('/', async (req, res, next) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : null;
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const trigger = typeof req.query.trigger === 'string' ? req.query.trigger : null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 30)));
    const rows = await query<Record<string, unknown>>(
      `SELECT a.id, a.public_ref, a.category, a.level, a.state, a.trigger_type, a.title, a.summary,
              a.triggered_at, a.updated_at, a.is_simulated, a.forecast_horizon_hours, a.source_id,
              s.name AS station_name, s.code AS station_code, l.name AS locality_name, a.locality_id,
              a.model_id, m.name AS model_name, m.version AS model_version,
              (SELECT COUNT(*)::int FROM environmental_incidents i WHERE i.source_alert_id=a.id) AS linked_incidents
       FROM environmental_alerts a
       LEFT JOIN monitoring_stations s ON s.id=a.station_id
       LEFT JOIN localities l ON l.id=a.locality_id
       LEFT JOIN model_registry m ON m.id=a.model_id
       WHERE a.simulation_session_id IS NULL
         AND ($1::text IS NULL OR a.category=$1)
         AND ($2::text IS NULL OR a.state=$2)
         AND ($3::text IS NULL OR a.trigger_type=$3)
       ORDER BY CASE a.state WHEN 'CRITICAL' THEN 0 WHEN 'EARLY_WARNING' THEN 1 WHEN 'WATCH' THEN 2 ELSE 3 END,
                a.triggered_at DESC LIMIT $4 OFFSET $5`,
      [category, state, trigger, pageSize, (page - 1) * pageSize],
    );
    res.json({ alerts: rows, page, pageSize });
  } catch (error) {
    next(error);
  }
});

alertsRouter.get('/:id', async (req, res, next) => {
  try {
    const alert = await one<Record<string, unknown>>(
      `SELECT a.*, s.name AS station_name, s.code AS station_code, s.health_status, s.is_simulated AS station_simulated,
              l.name AS locality_name, l.lat::float8 AS locality_lat, l.lng::float8 AS locality_lng,
              ST_Y(s.location::geometry)::float8 AS station_lat, ST_X(s.location::geometry)::float8 AS station_lng,
              m.name AS model_name, m.version AS model_version, m.status AS model_status
       FROM environmental_alerts a
       LEFT JOIN monitoring_stations s ON s.id=a.station_id
       LEFT JOIN localities l ON l.id=a.locality_id
       LEFT JOIN model_registry m ON m.id=a.model_id
       WHERE a.id=$1`,
      [req.params.id],
    );
    if (!alert) throw notFound('Alert not found.');
    const isAuthority = AUTHORITY.includes(req.user!.role);
    const [history, risks, incidents, notifications] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT h.from_state, h.to_state, h.reason, h.created_at, u.name AS actor_name
         FROM alert_history h LEFT JOIN users u ON u.id=h.actor_id
         WHERE h.alert_id=$1 ORDER BY h.created_at`,
        [alert.id],
      ),
      query<Record<string, unknown>>(
        `SELECT id, risk_score::float8, risk_level, confidence_score::float8, confidence_level, alert_state,
                method, supporting_evidence, missing_inputs, calculated_at, ruleset_version, is_simulated
         FROM risk_assessments WHERE entity_type=$1 AND entity_id=$2 ORDER BY calculated_at DESC LIMIT 5`,
        [alert.entity_type, alert.entity_id],
      ),
      isAuthority
        ? query<Record<string, unknown>>(
            `SELECT id, public_ref, title, status, risk_level, detected_at FROM environmental_incidents
             WHERE source_alert_id=$1 OR (category=$2 AND locality_id=$3) ORDER BY detected_at DESC LIMIT 5`,
            [alert.id, alert.category, alert.locality_id],
          )
        : Promise.resolve([]),
      isAuthority
        ? query<Record<string, unknown>>(
            `SELECT id, audience, template, status, created_at, sent_at, delivered_at, error, is_simulated
             FROM notifications WHERE alert_id=$1 ORDER BY created_at DESC LIMIT 20`,
            [alert.id],
          )
        : Promise.resolve([]),
    ]);
    res.json({ alert, history, riskAssessments: risks, linkedIncidents: incidents, notifications });
  } catch (error) {
    next(error);
  }
});

alertsRouter.post('/:id/close', async (req, res, next) => {
  try {
    if (!AUTHORITY_ADMIN_ROLES.includes(req.user!.role)) throw forbidden('Only an authority administrator can close an alert.');
    const body = z.object({ reason: z.string().min(5).max(1000) }).parse(req.body);
    const result = await closeAlert(req.params.id, req.user!.id, body.reason);
    if (!result) throw notFound('Alert not found.');
    await audit({
      actorId: req.user!.id,
      action: 'ALERT_CLOSED',
      entityType: 'environmental_alert',
      entityId: req.params.id,
      after: { reason: body.reason },
      ip: req.ip,
    });
    res.json({ message: 'Alert closed.', alert: result });
  } catch (error) {
    next(error);
  }
});

export { VERIFIERS };
