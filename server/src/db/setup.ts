import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const reset = process.argv.includes('--reset');

function parts(urlString: string) {
  const url = new URL(urlString);
  return {
    database: url.pathname.replace(/^\//, '') || 'enviropulse',
    adminUrl: (() => {
      const u = new URL(urlString);
      u.pathname = '/postgres';
      return u.toString();
    })(),
  };
}

const { database, adminUrl } = parts(env.DATABASE_URL);

async function ensureDatabase() {
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
      console.log(`Created database ${database}`);
    }
  } finally {
    await admin.end();
  }
}

export async function main() {
  let client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
  } catch (error) {
    // Only fall back to the admin connection when the database is missing;
    // managed providers may not expose any other database.
    if ((error as { code?: string }).code !== '3D000') throw error;
    await ensureDatabase();
    client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
    await client.connect();
  }
  try {
    if (reset) {
      console.log('Dropping application tables…');
      await client.query(`
        DROP TABLE IF EXISTS
          recommendation_evidence, action_recommendations, event_forecasts, event_analysis_evidence, event_analysis, event_timeline, event_correlations, event_evidence, event_links, disaster_events,
          audit_logs, simulation_events, simulation_sessions, ingestion_jobs,
          notification_events, notifications, regulatory_standards, regulatory_documents,
          corrective_actions, investigation_notes, incident_assignments, environmental_incidents,
          alert_history, environmental_alerts, risk_factor_breakdowns, risk_assessments,
          ml_predictions, model_registry, ai_assessments, report_evidence, environmental_reports,
          weather_observations, citizen_weather_readings, weather_events, environmental_observations, pollutant_types, station_health,
          monitoring_stations, password_resets, user_preferences, users, wards, localities,
          data_sources, app_config, service_health
        CASCADE;
      `);
    }
    const schema = await fs.readFile(path.join(here, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('Schema ready (PostGIS + application tables).');
  } finally {
    await client.end();
  }
}

// Run when invoked directly (node dist/db/setup.js, npm run db:setup);
// bootstrap.ts imports main() so it can retry a database that is still starting.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error);
    if (process.env.RENDER === 'true' && !process.env.DATABASE_URL) {
      console.error(
        'DATABASE_URL is not set. Add a Render Postgres database to this service (or set DATABASE_URL to its internal connection string) and redeploy.',
      );
    }
    process.exit(1);
  });
}
