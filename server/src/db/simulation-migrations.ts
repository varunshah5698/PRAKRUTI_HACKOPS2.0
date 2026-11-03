import { query } from './pool.js';

/**
 * Targeted, idempotent migration for the simulation tables. The full schema is
 * applied by bootstrap/docker/db:setup; this keeps long-running dev servers and
 * upgraded deployments working without a manual psql step.
 */
export async function ensureSimulationSchema(): Promise<void> {
  await query(`ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS scenario_version integer NOT NULL DEFAULT 1`);
  await query(`ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS weather_snapshot jsonb`);
  await query(`ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS recommendations_version integer NOT NULL DEFAULT 0`);
  await query(`CREATE INDEX IF NOT EXISTS simulation_sessions_scenario_idx ON simulation_sessions (scenario, created_at DESC)`);
}
