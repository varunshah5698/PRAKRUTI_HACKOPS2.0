import { one, query } from '../db/pool.js';
import type { RiskAssessmentResult } from '../types.js';
import {
  buildSimulationRecommendations,
  type RecommendationConditions,
} from './simulation-recommendations.js';

interface SessionRow {
  id: string;
  scenario: string;
  category: string;
  total_steps: number;
  recommendations_version: number;
  station_name: string | null;
}

interface EventRow {
  step: number;
  payload: Record<string, unknown>;
}

type ReadingValues = Record<string, { value: number; unit: string; qualityState: string }>;

/**
 * Enrich an existing replay without touching its readings, risk scores, alerts
 * or timestamps. This is the migration path for sessions created before the
 * recommendation layer existed.
 */
export async function backfillSimulationSession(sessionId: string): Promise<{ sessions: number; events: number }> {
  const session = await one<SessionRow>(
    `SELECT s.id, s.scenario, s.category, s.total_steps, s.recommendations_version,
            st.name AS station_name
     FROM simulation_sessions s
     LEFT JOIN monitoring_stations st ON st.id=s.station_id
     WHERE s.id=$1`,
    [sessionId],
  );
  if (!session) return { sessions: 0, events: 0 };

  const events = await query<EventRow>(
    `SELECT step, payload FROM simulation_events
     WHERE session_id=$1 AND event_type='READING' ORDER BY step`,
    [sessionId],
  );

  let updated = 0;
  for (const event of events) {
    if (Array.isArray(event.payload.recommendations)) continue;
    const risk = event.payload.risk as RiskAssessmentResult | undefined;
    if (!risk) continue;

    const payloadStep = Number(event.payload.step ?? event.step);
    const recommendations = buildSimulationRecommendations({
      scenario: session.scenario,
      category: session.category,
      step: Number.isFinite(payloadStep) ? payloadStep : event.step,
      totalSteps: session.total_steps,
      stationName: session.station_name ?? 'Simulation station',
      risk,
      values: (event.payload.values ?? {}) as ReadingValues,
      conditions: (event.payload.conditions ?? null) as RecommendationConditions | null,
      neighbour: (() => {
        const neighbour = event.payload.neighbour as { name?: string; pm25?: number } | undefined;
        return neighbour?.name && typeof neighbour.pm25 === 'number'
          ? { name: neighbour.name, pm25: neighbour.pm25 }
          : null;
      })(),
      suppressAlert: Boolean(event.payload.suppressAlert),
    });

    await query(
      `UPDATE simulation_events
       SET payload = jsonb_set(payload, '{recommendations}', $3::jsonb, true)
       WHERE session_id=$1 AND step=$2 AND event_type='READING'`,
      [sessionId, event.step, JSON.stringify(recommendations)],
    );
    updated += 1;
  }

  await query(`UPDATE simulation_sessions SET recommendations_version=1 WHERE id=$1`, [sessionId]);
  return { sessions: 1, events: updated };
}

/**
 * Scan recent sessions that predate the recommendation layer. Safe to run on
 * every boot; sessions already marked with recommendations_version=1 are
 * skipped by the query.
 */
export async function backfillSimulationRecommendations(
  limit = 200,
): Promise<{ sessions: number; events: number }> {
  const sessions = await query<{ id: string }>(
    `SELECT id FROM simulation_sessions
     WHERE recommendations_version < 1
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  let events = 0;
  for (const session of sessions) {
    const result = await backfillSimulationSession(session.id);
    events += result.events;
  }
  return { sessions: sessions.length, events };
}
