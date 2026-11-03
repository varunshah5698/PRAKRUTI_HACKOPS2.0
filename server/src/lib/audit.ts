import { query } from '../db/pool.js';

export async function audit(params: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}) {
  await query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before, after, ip)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [
      params.actorId ?? null,
      params.action,
      params.entityType,
      params.entityId ?? null,
      params.before === undefined ? null : JSON.stringify(params.before),
      params.after === undefined ? null : JSON.stringify(params.after),
      params.ip ?? null,
    ],
  );
}
