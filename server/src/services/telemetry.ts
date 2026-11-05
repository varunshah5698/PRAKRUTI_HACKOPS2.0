import { one, query } from '../db/pool.js';

export interface HealthRow {
  key: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_heartbeat_at: string | null;
  last_error: string | null;
  success_count: string;
  failure_count: string;
  detail: unknown;
  updated_at: string;
}

export async function recordSuccess(key: string, detail?: unknown): Promise<void> {
  await query(
    `INSERT INTO service_health (key, last_success_at, success_count, detail, updated_at)
     VALUES ($1, now(), 1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET
       last_success_at=now(), success_count=service_health.success_count+1,
       last_error=NULL, detail=COALESCE(EXCLUDED.detail, service_health.detail), updated_at=now()`,
    [key, detail === undefined ? null : JSON.stringify(detail)],
  );
}

export async function recordFailure(key: string, error: string, detail?: unknown): Promise<void> {
  await query(
    `INSERT INTO service_health (key, last_failure_at, failure_count, last_error, detail, updated_at)
     VALUES ($1, now(), 1, $2, $3::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET
       last_failure_at=now(), failure_count=service_health.failure_count+1,
       last_error=EXCLUDED.last_error, detail=COALESCE(EXCLUDED.detail, service_health.detail), updated_at=now()`,
    [key, error.slice(0, 500), detail === undefined ? null : JSON.stringify(detail)],
  );
}

export async function recordHeartbeat(key: string, detail?: unknown): Promise<void> {
  await query(
    `INSERT INTO service_health (key, last_heartbeat_at, detail, updated_at)
     VALUES ($1, now(), $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET
       last_heartbeat_at=now(), detail=COALESCE(EXCLUDED.detail, service_health.detail), updated_at=now()`,
    [key, detail === undefined ? null : JSON.stringify(detail)],
  );
}

export async function recordEmail(ok: boolean, error?: string): Promise<void> {
  if (ok) {
    await recordSuccess('email:citizen-alerts');
  } else {
    await recordFailure('email:citizen-alerts', error ?? 'Email delivery failed.');
  }
}

export async function healthSnapshot(): Promise<Record<string, unknown>> {
  const rows = await query<HealthRow>('SELECT * FROM service_health ORDER BY key');
  const [monitored, retries, lastReading, lastNotification] = await Promise.all([
    one<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM users u JOIN user_preferences p ON p.user_id=u.id
       WHERE u.role='PUBLIC' AND u.account_status='ACTIVE' AND u.email_verified=true
         AND u.onboarding_completed=true AND p.weather_notifications=true
         AND p.weather_consent_at IS NOT NULL
         AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
         AND u.email NOT LIKE '%@fldubai.com'`,
    ),
    one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM notifications
       WHERE status='FAILED' AND next_retry_at IS NOT NULL`,
    ),
    one<{ latest: string | null }>('SELECT MAX(observed_at) AS latest FROM citizen_weather_readings'),
    one<{ latest: string | null }>(
      `SELECT MAX(created_at) AS latest FROM notifications WHERE template IN ('WEATHER_ALERT','NEWS_ALERT')`,
    ),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    services: rows.map((row) => ({
      key: row.key,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      lastHeartbeatAt: row.last_heartbeat_at,
      lastError: row.last_error,
      successes: Number(row.success_count),
      failures: Number(row.failure_count),
      detail:
        row.detail && /@|citizens|email/i.test(JSON.stringify(row.detail))
          ? null
          : row.detail,
      updatedAt: row.updated_at,
    })),
    workers: {
      citizenWeatherHeartbeat: rows.find((row) => row.key === 'worker:citizen-weather')?.last_heartbeat_at ?? null,
      criticalNewsHeartbeat: rows.find((row) => row.key === 'worker:critical-news')?.last_heartbeat_at ?? null,
    },
    monitoredCitizens: monitored?.count ?? 0,
    pendingNotificationRetries: retries?.count ?? 0,
    lastCitizenWeatherObservation: lastReading?.latest ?? null,
    lastCitizenNotificationAt: lastNotification?.latest ?? null,
    database: 'connected',
  };
}
