import { one, query } from '../db/pool.js';
import type { RiskAssessmentResult } from '../types.js';
import type { StationAssessment } from './risk.js';
import { createNotificationsForAlert } from './notifications.js';
import { emitEvent } from '../lib/events.js';

export interface CreatedAlert {
  id: string;
  publicRef: string;
  created: boolean;
  state: string;
}

async function nextRef(prefix: string, sequence: string): Promise<string> {
  const row = await one<{ value: string }>(`SELECT nextval('${sequence}')::text AS value`);
  const year = new Date().getFullYear();
  return `EP-${prefix}-${year}-${row?.value ?? Math.floor(Math.random() * 9000 + 1000)}`;
}

async function localityName(localityId: string | null): Promise<string | null> {
  if (!localityId) return null;
  const row = await one<{ name: string }>('SELECT name FROM localities WHERE id=$1', [localityId]);
  return row?.name ?? null;
}

function alertCopy(assessment: RiskAssessmentResult, stationName: string | null, locality: string | null) {
  const place = locality ?? stationName ?? 'Mumbai';
  const dominant = assessment.factors[0]?.detail ?? '';
  if (assessment.category === 'air') {
    if (assessment.alertState === 'EARLY_WARNING') {
      return {
        title: `Predictive air-quality warning · ${place}`,
        summary: `Persistence baseline indicates PM2.5 pressure for ${place}. ${dominant} This is an analytical forecast, not a confirmed regulatory violation.`,
      };
    }
    if (assessment.alertState === 'CRITICAL') {
      return {
        title: `Critical air-quality screening alert · ${place}`,
        summary: `Three consecutive hourly PM2.5 values at or above the NAAQS 24h threshold were recorded at ${stationName ?? place}. ${dominant} Screening only: an official determination requires a valid 24h average and authorised review.`,
      };
    }
    return {
      title: `Air-quality watch · ${place}`,
      summary: `Indicative pollutant load is elevated at ${stationName ?? place}. ${dominant} Screening against 24h NAAQS thresholds using hourly values; not an official exceedance.`,
    };
  }
  if (assessment.category === 'water') {
    return {
      title: `Water-quality ${assessment.alertState === 'CRITICAL' ? 'alert' : 'watch'} · ${place}`,
      summary: `Available water-quality measurements and report evidence triggered a ${assessment.alertState.toLowerCase()} state. ${dominant}. Reference criteria only; confirm sampling and applicability before any determination.`,
    };
  }
  if (assessment.category === 'waste') {
    return {
      title: `Waste-disposal ${assessment.alertState === 'CRITICAL' ? 'hotspot alert' : 'watch'} · ${place}`,
      summary: `Report evidence in ${place} reached a ${assessment.alertState.toLowerCase()} state. ${dominant}. Unverified complaints are not treated as confirmed violations.`,
    };
  }
  return {
    title: `Industrial emissions ${assessment.alertState === 'CRITICAL' ? 'alert' : 'watch'} · ${place}`,
    summary: `Industrial evidence in ${place} reached a ${assessment.alertState.toLowerCase()} state. ${dominant}. No legal threshold is applied by this ruleset; an investigation is required.`,
  };
}

export async function createOrUpdateAlert(
  assessment: RiskAssessmentResult,
  options: {
    stationId?: string | null;
    localityId?: string | null;
    stationName?: string | null;
    isSimulated?: boolean;
    simulationSessionId?: string | null;
    entityTypeOverride?: string;
    entityIdOverride?: string;
  } = {},
): Promise<CreatedAlert | null> {
  const entityType = options.entityTypeOverride ?? assessment.entityType;
  const entityId = options.entityIdOverride ?? assessment.entityId;
  if (assessment.alertState === 'NORMAL') return null;
  const triggerType =
    assessment.alertState === 'EARLY_WARNING'
      ? 'PREDICTIVE'
      : assessment.category === 'waste'
        ? 'REPORT_EVIDENCE'
        : 'OBSERVED';
  const locality = options.localityId ? await localityName(options.localityId) : null;
  const copy = alertCopy(assessment, options.stationName ?? null, locality);
  const existing = await one<{ id: string; public_ref: string; state: string; level: string }>(
    `SELECT id, public_ref, state, level FROM environmental_alerts
     WHERE category=$1 AND entity_type=$2 AND entity_id=$3 AND trigger_type=$4
       AND state NOT IN ('CLOSED','RECOVERY')
       AND triggered_at > now() - interval '6 hours'
     ORDER BY triggered_at DESC LIMIT 1`,
    [assessment.category, entityType, entityId, triggerType],
  );
  const model = triggerType === 'PREDICTIVE' ? await one<{ id: string }>(
    `SELECT id FROM model_registry WHERE name='persistence_baseline' AND version='v1' LIMIT 1`,
  ) : null;

  if (existing) {
    const rank: Record<string, number> = { WATCH: 1, EARLY_WARNING: 2, CRITICAL: 3 };
    const nextState = (rank[assessment.alertState] ?? 0) < (rank[existing.state] ?? 0) ? existing.state : assessment.alertState;
    if (existing.state !== nextState) {
      await query(
        `UPDATE environmental_alerts SET state=$2, level=$2, summary=$3, evidence=$4::jsonb,
           updated_at=now(), forecast_horizon_hours=$5, model_id=$6 WHERE id=$1`,
        [
          existing.id,
          nextState,
          copy.summary,
          JSON.stringify(assessment.supportingEvidence),
          triggerType === 'PREDICTIVE' ? 3 : null,
          model?.id ?? null,
        ],
      );
      await query(
        `INSERT INTO alert_history (alert_id, from_state, to_state, reason) VALUES ($1,$2,$3,$4)`,
        [existing.id, existing.state, nextState, `Risk assessment update (${assessment.rulesetVersion}).`],
      );
      await createNotificationsForAlert(existing.id);
      emitEvent('alert', { id: existing.id, publicRef: existing.public_ref, category: assessment.category, level: nextState, state: nextState, isSimulated: options.isSimulated ?? false });
    } else {
      await query(`UPDATE environmental_alerts SET summary=$2, evidence=$3::jsonb, updated_at=now() WHERE id=$1`, [
        existing.id,
        copy.summary,
        JSON.stringify(assessment.supportingEvidence),
      ]);
    }
    return { id: existing.id, publicRef: existing.public_ref, created: false, state: nextState };
  }

  // Cooldown: do not reopen the same level within two hours.
  const recent = await one<{ id: string }>(
    `SELECT id FROM environmental_alerts
     WHERE category=$1 AND entity_type=$2 AND entity_id=$3 AND trigger_type=$4
       AND triggered_at > now() - interval '2 hours' AND level=$5`,
    [assessment.category, entityType, entityId, triggerType, assessment.alertState],
  );
  if (recent) return { id: recent.id, publicRef: '', created: false, state: assessment.alertState };

  const publicRef = await nextRef('A', 'alert_ref_seq');
  const sourceEvidence = assessment.supportingEvidence.find(
    (e) => e.kind === 'OBSERVED' && typeof e.sourceId === 'string',
  );
  const sourceId = typeof sourceEvidence?.sourceId === 'string' ? sourceEvidence.sourceId : 'demo-network';
  const inserted = await one<{ id: string }>(
    `INSERT INTO environmental_alerts
       (public_ref, category, entity_type, entity_id, station_id, locality_id, level, state, trigger_type,
        title, summary, evidence, source_id, model_id, forecast_horizon_hours, is_simulated, simulation_session_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)
     RETURNING id`,
    [
      publicRef,
      assessment.category,
      entityType,
      entityId,
      options.stationId ?? (assessment.entityType === 'station' ? assessment.entityId : null),
      options.localityId ?? null,
      assessment.alertState,
      triggerType,
      copy.title,
      copy.summary,
      JSON.stringify(assessment.supportingEvidence),
      sourceId,
      model?.id ?? null,
      triggerType === 'PREDICTIVE' ? 3 : null,
      options.isSimulated ?? false,
      options.simulationSessionId ?? null,
    ],
  );
  if (!inserted) return null;
  await query(`INSERT INTO alert_history (alert_id, from_state, to_state, reason) VALUES ($1,NULL,$2,$3)`, [
    inserted.id,
    assessment.alertState,
    `Created by ${assessment.rulesetVersion}.`,
  ]);
  await createNotificationsForAlert(inserted.id);
  emitEvent('alert', {
    id: inserted.id,
    publicRef,
    category: assessment.category,
    level: assessment.alertState,
    state: assessment.alertState,
    isSimulated: options.isSimulated ?? false,
  });
  return { id: inserted.id, publicRef, created: true, state: assessment.alertState };
}

export async function syncAlertsFromStationAssessments(assessments: StationAssessment[]) {
  const created: CreatedAlert[] = [];
  for (const assessment of assessments) {
    if (assessment.alertState === 'NORMAL') {
      await maybeRecover(assessment.entityType, assessment.entityId);
      continue;
    }
    const alert = await createOrUpdateAlert(assessment, {
      stationId: assessment.station.id,
      localityId: assessment.station.localityId,
      stationName: assessment.station.name,
      isSimulated: assessment.station.isSimulated,
    });
    if (alert) created.push(alert);
  }
  return created;
}

export async function syncAlertsFromWasteAssessments(assessments: RiskAssessmentResult[], isSimulated = false) {
  const created: CreatedAlert[] = [];
  for (const assessment of assessments) {
    if (assessment.alertState === 'NORMAL') {
      await maybeRecover(assessment.entityType, assessment.entityId);
      continue;
    }
    const alert = await createOrUpdateAlert(assessment, { localityId: assessment.entityId, isSimulated });
    if (alert) created.push(alert);
  }
  return created;
}

export async function maybeRecover(entityType: string, entityId: string) {
  const open = await one<{ id: string; state: string }>(
    `SELECT id, state FROM environmental_alerts
     WHERE entity_type=$1 AND entity_id=$2 AND state NOT IN ('CLOSED','RECOVERY')
     ORDER BY triggered_at DESC LIMIT 1`,
    [entityType, entityId],
  );
  if (!open) return;
  const lastTwo = await query<{ alert_state: string }>(
    `SELECT alert_state FROM risk_assessments
     WHERE entity_type=$1 AND entity_id=$2 ORDER BY calculated_at DESC LIMIT 2`,
    [entityType, entityId],
  );
  if (lastTwo.length < 2 || lastTwo.some((r) => r.alert_state !== 'NORMAL')) return;
  await query(`UPDATE environmental_alerts SET state='RECOVERY', level='RECOVERY', updated_at=now() WHERE id=$1`, [open.id]);
  await query(`INSERT INTO alert_history (alert_id, from_state, to_state, reason) VALUES ($1,$2,'RECOVERY',$3)`, [
    open.id,
    open.state,
    'Two consecutive NORMAL risk assessments; configured recovery condition met.',
  ]);
  await createNotificationsForAlert(open.id);
}

export async function closeAlert(alertId: string, actorId: string, reason: string) {
  const alert = await one<{ id: string; state: string }>('SELECT id, state FROM environmental_alerts WHERE id=$1', [alertId]);
  if (!alert) return null;
  await query(`UPDATE environmental_alerts SET state='CLOSED', updated_at=now() WHERE id=$1`, [alertId]);
  await query(`INSERT INTO alert_history (alert_id, from_state, to_state, reason, actor_id) VALUES ($1,$2,'CLOSED',$3,$4)`, [
    alertId,
    alert.state,
    reason,
    actorId,
  ]);
  return { id: alertId, state: 'CLOSED' };
}
