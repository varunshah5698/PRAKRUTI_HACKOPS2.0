import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db/pool.js';
import { requireAuth, AUTHORITY, AUTHORITY_ADMIN_ROLES } from '../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../middleware/errors.js';
import { SCENARIOS, generateSimulation, persistSimulationSteps } from '../services/simulation.js';
import { createOrUpdateAlert } from '../services/alerts.js';
import { createNotificationsForAlert } from '../services/notifications.js';
import { getAlertForEmail, renderAlertEmail } from '../services/email.js';
import { nextPublicRef } from '../lib/refs.js';
import { audit } from '../lib/audit.js';
import type { RiskAssessmentResult } from '../types.js';

export const simulationsRouter = Router();
simulationsRouter.use(requireAuth);

simulationsRouter.get('/scenarios', (_req, res) => {
  res.json({
    scenarios: SCENARIOS,
    note: 'All simulation inputs and outputs are isolated with is_simulated=true and a simulation session id. Reset never touches real observations.',
  });
});

simulationsRouter.get('/', async (req, res, next) => {
  try {
    const isAuthority = AUTHORITY.includes(req.user!.role);
    const rows = await query<Record<string, unknown>>(
      `SELECT s.id, s.scenario, s.category, s.seed, s.status, s.current_step, s.total_steps, s.created_at, s.updated_at,
              s.is_simulated, st.name AS station_name, l.name AS locality_name, u.name AS created_by_name
       FROM simulation_sessions s
       LEFT JOIN monitoring_stations st ON st.id=s.station_id
       LEFT JOIN localities l ON l.id=s.locality_id
       LEFT JOIN users u ON u.id=s.created_by
       WHERE ($1::boolean OR s.created_by=$2)
       ORDER BY s.created_at DESC LIMIT 100`,
      [isAuthority, req.user!.id],
    );
    res.json({ sessions: rows });
  } catch (error) {
    next(error);
  }
});

simulationsRouter.post('/', async (req, res, next) => {
  try {
    if (!AUTHORITY.includes(req.user!.role)) throw forbidden('Authority role required to create a simulation.');
    const body = z
      .object({
        scenario: z.string().min(2),
        stationId: z.string().uuid().optional(),
        seed: z.number().int().min(1).max(1_000_000).default(42),
      })
      .parse(req.body);
    const scenario = SCENARIOS.find((s) => s.id === body.scenario);
    if (!scenario) throw badRequest('Unknown simulation scenario.');
    let stationId = body.stationId;
    if (!stationId) {
      const first = await one<{ id: string }>('SELECT id FROM monitoring_stations ORDER BY code LIMIT 1');
      if (!first) throw badRequest('No station available for simulation.');
      stationId = first.id;
    }
    const generated = await generateSimulation({ scenario, stationId, seed: body.seed });
    if (!generated.station) throw notFound('Station not found.');
    const row = await one<{ id: string }>(
      `INSERT INTO simulation_sessions
         (scenario, category, station_id, locality_id, seed, status, current_step, total_steps, created_by, is_simulated)
       VALUES ($1,$2,$3,$4,$5,'CREATED',0,$6,$7,true) RETURNING id`,
      [scenario.id, scenario.category, stationId, generated.station.locality_id, body.seed, generated.steps.length, req.user!.id],
    );
    if (!row) throw badRequest('Could not create simulation session.');
    await persistSimulationSteps(row.id, generated.steps);
    await audit({
      actorId: req.user!.id,
      action: 'SIMULATION_CREATED',
      entityType: 'simulation_session',
      entityId: row.id,
      after: { scenario: scenario.id, seed: body.seed, stationId, steps: generated.steps.length },
      ip: req.ip,
    });
    res.status(201).json({
      session: {
        id: row.id,
        scenario: scenario.id,
        category: scenario.category,
        seed: body.seed,
        status: 'CREATED',
        currentStep: 0,
        totalSteps: generated.steps.length,
        station: generated.station,
        isSimulated: true,
      },
      firstEvent: generated.steps[0],
      note: 'Simulation data is isolated. No real observation was modified.',
    });
  } catch (error) {
    next(error);
  }
});

simulationsRouter.get('/:id', async (req, res, next) => {
  try {
    const session = await one<Record<string, unknown>>(
      `SELECT s.*, st.name AS station_name, st.code AS station_code, st.station_type,
              l.name AS locality_name, u.name AS created_by_name
       FROM simulation_sessions s
       LEFT JOIN monitoring_stations st ON st.id=s.station_id
       LEFT JOIN localities l ON l.id=s.locality_id
       LEFT JOIN users u ON u.id=s.created_by
       WHERE s.id=$1`,
      [req.params.id],
    );
    if (!session) throw notFound('Simulation session not found.');
    const events = await query<{ step: number; event_type: string; payload: Record<string, unknown> }>(
      `SELECT step, event_type, payload FROM simulation_events WHERE session_id=$1 AND step <= $2 ORDER BY step`,
      [session.id, session.current_step],
    );
    const [alerts, notifications, incidents] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT id, public_ref, category, level, state, trigger_type, title, summary, triggered_at, is_simulated
         FROM environmental_alerts WHERE simulation_session_id=$1 ORDER BY triggered_at`,
        [session.id],
      ),
      query<Record<string, unknown>>(
        `SELECT id, audience, template, subject, status, is_simulated, created_at
         FROM notifications WHERE simulation_session_id=$1 ORDER BY created_at DESC LIMIT 30`,
        [session.id],
      ),
      query<Record<string, unknown>>(
        `SELECT id, public_ref, title, status, risk_level, detected_at, is_simulated
         FROM environmental_incidents WHERE simulation_session_id=$1 ORDER BY detected_at`,
        [session.id],
      ),
    ]);
    res.json({
      session,
      scenario: SCENARIOS.find((s) => s.id === session.scenario) ?? null,
      events,
      alerts,
      notifications,
      incidents,
      isolation: {
        isSimulated: true,
        simulationSessionId: session.id,
        note: 'Synthetic readings and replay-generated warnings are isolated from real observations.',
      },
    });
  } catch (error) {
    next(error);
  }
});

async function transitionAlertForStep(
  session: { id: string; station_id: string; locality_id: string | null; scenario: string; station_name?: string },
  event: Record<string, unknown>,
  previousState: string | null,
) {
  const risk = event.risk as RiskAssessmentResult;
  if (!risk) return null;
  if (risk.alertState === 'NORMAL') {
    if (previousState && previousState !== 'NORMAL') {
      const existing = await one<{ id: string; state: string }>(
        `SELECT id, state FROM environmental_alerts WHERE simulation_session_id=$1 AND state NOT IN ('CLOSED','RECOVERY')
         ORDER BY triggered_at DESC LIMIT 1`,
        [session.id],
      );
      if (existing) {
        await query(`UPDATE environmental_alerts SET state='RECOVERY', level='RECOVERY', updated_at=now() WHERE id=$1`, [
          existing.id,
        ]);
        await query(
          `INSERT INTO alert_history (alert_id, from_state, to_state, reason) VALUES ($1,$2,'RECOVERY',$3)`,
          [existing.id, existing.state, 'Simulation recovery condition reached.'],
        );
        await createNotificationsForAlert(existing.id, { simulationSessionId: session.id });
        return { id: existing.id, state: 'RECOVERY' };
      }
    }
    return null;
  }
  if (event.suppressAlert) return null;
  const alert = await createOrUpdateAlert(risk, {
    stationId: session.station_id,
    localityId: session.locality_id,
    stationName: session.station_name ?? 'Simulation station',
    isSimulated: true,
    simulationSessionId: session.id,
    entityTypeOverride: risk.category === 'waste' ? 'simulation_locality' : 'simulation_station',
    entityIdOverride: session.id,
  });
  if (alert) {
    await query(
      `UPDATE simulation_events SET payload = jsonb_set(payload, '{alertId}', to_jsonb($3::text), true)
       WHERE session_id=$1 AND step=$2 AND event_type='READING'`,
      [session.id, Number(event.step), alert.id],
    );
  }
  return alert;
}

simulationsRouter.post('/:id/play', async (req, res, next) => {
  try {
    if (!AUTHORITY.includes(req.user!.role)) throw forbidden('Authority role required to control a simulation.');
    const session = await one<{ id: string; status: string; current_step: number; total_steps: number }>(
      'SELECT id, status, current_step, total_steps FROM simulation_sessions WHERE id=$1',
      [req.params.id],
    );
    if (!session) throw notFound('Simulation session not found.');
    if (session.current_step >= session.total_steps - 1) throw badRequest('Simulation is already at the final step. Reset to replay.');
    await query(`UPDATE simulation_sessions SET status='PLAYING', updated_at=now() WHERE id=$1`, [session.id]);
    res.json({ status: 'PLAYING' });
  } catch (error) {
    next(error);
  }
});

simulationsRouter.post('/:id/pause', async (req, res, next) => {
  try {
    if (!AUTHORITY.includes(req.user!.role)) throw forbidden('Authority role required to control a simulation.');
    const session = await one<{ id: string }>('SELECT id FROM simulation_sessions WHERE id=$1', [req.params.id]);
    if (!session) throw notFound('Simulation session not found.');
    await query(`UPDATE simulation_sessions SET status='PAUSED', updated_at=now() WHERE id=$1`, [session.id]);
    res.json({ status: 'PAUSED' });
  } catch (error) {
    next(error);
  }
});

simulationsRouter.post('/:id/step', async (req, res, next) => {
  try {
    if (!AUTHORITY.includes(req.user!.role)) throw forbidden('Authority role required to control a simulation.');
    const session = await one<{
      id: string;
      status: string;
      current_step: number;
      total_steps: number;
      station_id: string;
      locality_id: string | null;
      scenario: string;
      station_name: string;
    }>(
      `SELECT s.id, s.status, s.current_step, s.total_steps, s.station_id, s.locality_id, s.scenario,
              st.name AS station_name
       FROM simulation_sessions s JOIN monitoring_stations st ON st.id=s.station_id WHERE s.id=$1`,
      [req.params.id],
    );
    if (!session) throw notFound('Simulation session not found.');
    const nextStep = Math.min(session.total_steps - 1, session.current_step + 1);
    const previous = await one<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM simulation_events WHERE session_id=$1 AND step=$2 AND event_type='READING'`,
      [session.id, session.current_step],
    );
    const current = await one<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM simulation_events WHERE session_id=$1 AND step=$2 AND event_type='READING'`,
      [session.id, nextStep],
    );
    if (!current) throw notFound('Simulation event not found.');
    const previousState =
      (previous?.payload?.risk as RiskAssessmentResult | undefined)?.alertState ?? null;
    const alert = await transitionAlertForStep(
      {
        id: session.id,
        station_id: session.station_id,
        locality_id: session.locality_id,
        scenario: session.scenario,
        station_name: session.station_name,
      },
      current.payload,
      previousState,
    );
    const status = nextStep >= session.total_steps - 1 ? 'COMPLETED' : session.status === 'PLAYING' ? 'PLAYING' : 'PAUSED';
    await query(`UPDATE simulation_sessions SET current_step=$2, status=$3, updated_at=now() WHERE id=$1`, [
      session.id,
      nextStep,
      status,
    ]);
    res.json({
      step: nextStep,
      totalSteps: session.total_steps,
      status,
      event: current.payload,
      alert,
      isolation: { isSimulated: true, simulationSessionId: session.id },
    });
  } catch (error) {
    next(error);
  }
});

simulationsRouter.post('/:id/reset', async (req, res, next) => {
  try {
    if (!AUTHORITY.includes(req.user!.role)) throw forbidden('Authority role required to control a simulation.');
    const session = await one<{ id: string }>('SELECT id FROM simulation_sessions WHERE id=$1', [req.params.id]);
    if (!session) throw notFound('Simulation session not found.');
    await query(`UPDATE simulation_sessions SET current_step=0, status='RESET', updated_at=now() WHERE id=$1`, [session.id]);
    await audit({
      actorId: req.user!.id,
      action: 'SIMULATION_RESET',
      entityType: 'simulation_session',
      entityId: session.id,
      after: { note: 'Replay position reset. Simulation records retained. Real observations untouched.' },
      ip: req.ip,
    });
    res.json({ status: 'RESET', currentStep: 0, note: 'Replay reset. No real observations were modified or deleted.' });
  } catch (error) {
    next(error);
  }
});

simulationsRouter.post('/:id/email-preview', async (req, res, next) => {
  try {
    if (!AUTHORITY.includes(req.user!.role)) throw forbidden('Authority role required.');
    const alert = await one<{ id: string }>(
      `SELECT id FROM environmental_alerts WHERE simulation_session_id=$1 ORDER BY triggered_at DESC LIMIT 1`,
      [req.params.id],
    );
    if (!alert) {
      res.status(409).json({
        error: {
          code: 'NO_SIMULATED_ALERT',
          message: 'Advance the simulation until an alert transition occurs before previewing an email.',
        },
      });
      return;
    }
    const emailAlert = await getAlertForEmail(alert.id);
    if (!emailAlert) throw notFound('Simulated alert not found.');
    res.json({
      alertId: alert.id,
      public: renderAlertEmail(emailAlert, 'PUBLIC', emailAlert.level === 'CRITICAL' ? 'PUBLIC_CRITICAL' : 'PUBLIC_EARLY_WARNING'),
      authority: renderAlertEmail(
        emailAlert,
        'AUTHORITY',
        emailAlert.level === 'CRITICAL' ? 'AUTHORITY_CRITICAL' : 'AUTHORITY_EARLY_WARNING',
      ),
      routing: {
        demoMode: true,
        note: 'Replay-generated emails are stored as SIMULATED notifications. They are not sent to real mailing lists.',
      },
    });
  } catch (error) {
    next(error);
  }
});

simulationsRouter.post('/:id/incident', async (req, res, next) => {
  try {
    if (!AUTHORITY.includes(req.user!.role)) throw forbidden('Authority role required.');
    const session = await one<{
      id: string;
      category: string;
      station_id: string;
      locality_id: string | null;
      scenario: string;
      station_name: string;
      lat: number | null;
      lng: number | null;
    }>(
      `SELECT s.id, s.category, s.station_id, s.locality_id, s.scenario, st.name AS station_name,
              ST_Y(st.location::geometry)::float8 AS lat, ST_X(st.location::geometry)::float8 AS lng
       FROM simulation_sessions s JOIN monitoring_stations st ON st.id=s.station_id WHERE s.id=$1`,
      [req.params.id],
    );
    if (!session) throw notFound('Simulation session not found.');
    const alert = await one<{ id: string; title: string; summary: string; level: string }>(
      `SELECT id, title, summary, level FROM environmental_alerts WHERE simulation_session_id=$1
       ORDER BY triggered_at DESC LIMIT 1`,
      [session.id],
    );
    if (!alert) throw badRequest('No simulated alert exists yet. Advance the scenario first.');
    const publicRef = await nextPublicRef('I', 'incident_ref_seq');
    const incident = await one<{ id: string }>(
      `INSERT INTO environmental_incidents
         (public_ref, category, title, description, locality_id, location, status, risk_level, detected_at,
          source_alert_id, created_by, is_simulated, simulation_session_id)
       VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,'NEW',$8,now(),$9,$10,true,$11)
       RETURNING id`,
      [
        publicRef,
        session.category,
        `[SIMULATION] ${alert.title}`,
        `Replay-generated incident from scenario ${session.scenario}. ${alert.summary} This is simulation data and is not an official finding.`,
        session.locality_id,
        session.lng ?? 72.8777,
        session.lat ?? 19.076,
        alert.level === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        alert.id,
        req.user!.id,
        session.id,
      ],
    );
    if (!incident) throw badRequest('Could not create simulated incident.');
    await query(`INSERT INTO investigation_notes (incident_id, author_id, note, is_simulated) VALUES ($1,$2,$3,true)`, [
      incident.id,
      req.user!.id,
      'Simulation incident created from replay. No real observation was modified. No official determination has been made.',
    ]);
    await audit({
      actorId: req.user!.id,
      action: 'SIMULATION_INCIDENT_CREATED',
      entityType: 'environmental_incident',
      entityId: incident.id,
      after: { simulationSessionId: session.id, publicRef },
      ip: req.ip,
    });
    res.status(201).json({ incident: { id: incident.id, publicRef, status: 'NEW', isSimulated: true } });
  } catch (error) {
    next(error);
  }
});
