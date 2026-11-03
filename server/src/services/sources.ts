import { emailConfigured, env, riverConfig, visionConfig } from '../config/env.js';
import { DATA_SOURCE_CATALOGUE } from '../config/data-sources.js';
import { one, query } from '../db/pool.js';
import type { DataSource } from '../config/data-sources.js';

export async function syncSourceCatalogue(): Promise<void> {
  for (const source of DATA_SOURCE_CATALOGUE) {
    let status: DataSource['status'] = source.configured ? 'STALE' : 'NOT_CONFIGURED';
    if (source.id === 'demo-network' || source.id === 'openfreemap') status = 'CONNECTED';
    if (source.id === 'ml-service') status = 'NOT_CONFIGURED';
    if (source.id === 'river-ai' && !riverConfig.configured) status = 'NOT_CONFIGURED';
    if (source.id === 'vision-ai' && !visionConfig.configured) status = 'NOT_CONFIGURED';
    if (source.id === 'email' && !emailConfigured) status = 'NOT_CONFIGURED';
    await query(
      `INSERT INTO data_sources (id, name, category, provider, status, attribution, documentation_url, notes, is_simulated)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, category=EXCLUDED.category, provider=EXCLUDED.provider,
         attribution=EXCLUDED.attribution, documentation_url=EXCLUDED.documentation_url,
         notes=EXCLUDED.notes, is_simulated=EXCLUDED.is_simulated, updated_at=now(),
         status = CASE
           WHEN data_sources.last_success_at IS NOT NULL AND data_sources.status IN ('CONNECTED','STALE','FAILED') THEN data_sources.status
           ELSE EXCLUDED.status END`,
      [
        source.id,
        source.name,
        source.category,
        source.provider,
        status,
        source.attribution || null,
        source.documentationUrl || null,
        source.notes,
        source.id === 'demo-network',
      ],
    );
  }
}

export async function markSourceAttempt(sourceId: string): Promise<void> {
  await query(`UPDATE data_sources SET last_attempt_at=now() WHERE id=$1`, [sourceId]);
}

export async function markSourceSuccess(sourceId: string, recordCount: number): Promise<void> {
  await query(
    `UPDATE data_sources SET status='CONNECTED', last_success_at=now(), last_attempt_at=now(),
       record_count=GREATEST(record_count, $2), error_message=NULL, updated_at=now() WHERE id=$1`,
    [sourceId, recordCount],
  );
}

export async function markSourceFailure(sourceId: string, message: string): Promise<void> {
  await query(
    `UPDATE data_sources SET status='FAILED', last_attempt_at=now(), error_message=$2, updated_at=now() WHERE id=$1`,
    [sourceId, message.slice(0, 500)],
  );
}

export async function getSourceStatuses(): Promise<DataSource[]> {
  const rows = await query<{
    id: string;
    name: string;
    category: string;
    provider: string;
    status: DataSource['status'];
    last_attempt_at: string | null;
    last_success_at: string | null;
    attribution: string | null;
    documentation_url: string | null;
    record_count: number;
    error_message: string | null;
    notes: string | null;
    is_simulated: boolean;
  }>('SELECT * FROM data_sources ORDER BY category, name');
  const now = Date.now();
  // A live poller is expected to succeed within a few intervals; anything older
  // is genuinely stale rather than merely slow.
  const weatherWindow = Math.max(5 * 60_000, env.LIVE_WEATHER_INTERVAL_SECONDS * 4 * 1000);
  const aqiWindow = Math.max(15 * 60_000, env.LIVE_AQI_INTERVAL_SECONDS * 4 * 1000);
  return rows.map((row) => {
    let status = row.status;
    // Only call a source LIVE when recent successful ingestion is evidenced.
    if (row.id === 'open-meteo-weather' && row.last_success_at) {
      const age = now - new Date(row.last_success_at).getTime();
      status = age <= weatherWindow ? 'CONNECTED' : 'STALE';
    }
    if (row.id === 'open-meteo-cams' && row.last_success_at) {
      const age = now - new Date(row.last_success_at).getTime();
      status = age <= aqiWindow ? 'CONNECTED' : 'STALE';
    }
    if (row.id === 'demo-network' && row.last_success_at) {
      const age = now - new Date(row.last_success_at).getTime();
      status = age <= Math.max(5 * 60_000, env.LIVE_SIMULATION_INTERVAL_SECONDS * 4 * 1000) ? 'CONNECTED' : 'STALE';
    }
    if (row.id === 'river-ai' && riverConfig.configured) status = row.status === 'FAILED' ? 'FAILED' : 'CONNECTED';
    if (row.id === 'email' && emailConfigured) status = 'CONNECTED';
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      provider: row.provider,
      status,
      lastAttemptAt: row.last_attempt_at ?? undefined,
      lastSuccessAt: row.last_success_at ?? undefined,
      attribution: row.attribution ?? undefined,
      documentationUrl: row.documentation_url ?? undefined,
      recordCount: row.record_count,
      errorMessage: row.error_message ?? undefined,
      notes: row.notes ?? undefined,
    };
  });
}

export async function sourceIsLive(id: string): Promise<boolean> {
  const row = await one<{ status: string; last_success_at: string | null }>(
    'SELECT status, last_success_at FROM data_sources WHERE id=$1',
    [id],
  );
  if (!row || !row.last_success_at) return false;
  return Date.now() - new Date(row.last_success_at).getTime() < 3 * 3_600_000;
}

export function integrationStatus() {
  return {
    demoMode: env.DEMO_MODE,
    riverAi: riverConfig.configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    visionAi: visionConfig.configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    email: emailConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    storage: env.STORAGE_DRIVER === 'local' ? 'LOCAL_PRIVATE' : 'S3_COMPATIBLE',
    cpcb: env.DATA_GOV_IN_API_KEY ? 'CONFIGURED' : 'NOT_CONFIGURED',
    mpcb: env.OPENAQ_API_KEY ? 'OPENAQ_SUBSET' : 'NOT_CONFIGURED',
    ml: env.ML_SERVICE_URL ? 'CONFIGURED' : 'NOT_CONFIGURED',
  };
}
