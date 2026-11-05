import { pool } from '../db/pool.js';

/**
 * Postgres session-level advisory lock. The lock and unlock must use the same
 * client, so this helper holds one connection for the duration of the job.
 * Safe when more than one API instance runs the scheduler.
 */
export async function withWorkerLock<T>(name: string, job: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [name]);
    if (!result.rows[0]?.locked) return null;
    try {
      return await job();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
    }
  } finally {
    client.release();
  }
}
