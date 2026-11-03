import { Router } from 'express';
import { requireAuth, AUTHORITY_ADMIN_ROLES } from '../middleware/auth.js';
import { forbidden } from '../middleware/errors.js';
import { DATA_SOURCE_CATALOGUE } from '../config/data-sources.js';
import { getSourceStatuses } from '../services/sources.js';
import { runAllIngestion } from '../services/ingest.js';
import { query } from '../db/pool.js';
import { audit } from '../lib/audit.js';

export const sourcesRouter = Router();

sourcesRouter.get('/status', async (_req, res, next) => {
  try {
    res.json({ sources: await getSourceStatuses() });
  } catch (error) {
    next(error);
  }
});

sourcesRouter.get('/catalogue', (_req, res) => {
  res.json({
    catalogue: DATA_SOURCE_CATALOGUE.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      provider: s.provider,
      documentationUrl: s.documentationUrl,
      attribution: s.attribution,
      configured: s.configured,
      notes: s.notes,
    })),
  });
});

sourcesRouter.use(requireAuth);

sourcesRouter.get('/jobs', async (_req, res, next) => {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT j.*, s.name AS source_name FROM ingestion_jobs j JOIN data_sources s ON s.id=j.source_id
       ORDER BY j.started_at DESC LIMIT 50`,
    );
    res.json({ jobs: rows });
  } catch (error) {
    next(error);
  }
});

sourcesRouter.post('/refresh', async (req, res, next) => {
  try {
    if (!AUTHORITY_ADMIN_ROLES.includes(req.user!.role)) throw forbidden('Authority administrator role required.');
    const results = await runAllIngestion();
    await audit({
      actorId: req.user!.id,
      action: 'SOURCE_INGESTION_TRIGGERED',
      entityType: 'data_source',
      entityId: 'all',
      after: results,
      ip: req.ip,
    });
    res.json({ message: 'Ingestion attempted for configured sources.', results });
  } catch (error) {
    next(error);
  }
});

export const governanceRouter = Router();
governanceRouter.use(requireAuth);
governanceRouter.get('/audit', async (req, res, next) => {
  try {
    const isAuthority = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'].includes(req.user!.role);
    if (!isAuthority) throw forbidden('Authority role required to view the audit ledger.');
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 50)));
    const rows = await query<Record<string, unknown>>(
      `SELECT a.id, a.actor_id, u.name AS actor_name, u.role::text AS actor_role, a.action, a.entity_type,
              a.entity_id, a.before, a.after, a.ip, a.created_at
       FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
       WHERE ($1::text IS NULL OR a.entity_type=$1)
       ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`,
      [entityType, pageSize, (page - 1) * pageSize],
    );
    res.json({ audit: rows, page, pageSize });
  } catch (error) {
    next(error);
  }
});
