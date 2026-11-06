import { Router, type Request } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest } from '../middleware/errors.js';
import {
  EVENT_CATEGORIES,
  EVENT_ENTITY_TYPES,
  EVENT_SEVERITIES,
  EVENT_STATUSES,
  EVIDENCE_FRESHNESS_STATUSES,
  EVIDENCE_RELIABILITY_CLASSES,
  EVIDENCE_TYPES,
  EVIDENCE_VERIFICATION_STATUSES,
} from '../types.js';
import {
  addEvidence,
  correlateEvents,
  createEvent,
  getEventOrThrow,
  linkSource,
  listEvents,
  listEvidence,
  listTimeline,
  transitionEvent,
  type EventActor,
} from '../services/event-intelligence.js';
import { ingestDisasterFeeds } from '../services/event-ingest.js';
import { analyzeEvent, getAnalyses, getForecasts } from '../services/event-analysis.js';
import { generateRecommendations, listRecommendations } from '../services/event-recommendations.js';
import { assignEventAuthorities, autoMapAuthorities, getEventAuthorities } from '../services/authority.js';
import { RECOMMENDATION_AUDIENCES } from '../types.js';

export const eventIntelligenceRouter = Router();
eventIntelligenceRouter.use(requireAuth);

const mutationLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
const actor = (req: Request): EventActor => ({ id: req.user!.id, type: 'USER' });

function parseBbox(value: string | undefined): [number, number, number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw badRequest('bbox must be minLng,minLat,maxLng,maxLat.');
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat) {
    throw badRequest('bbox is outside valid geographic bounds.');
  }
  return [minLng, minLat, maxLng, maxLat];
}

const listSchema = z.object({
  category: z.enum(EVENT_CATEGORIES).optional(),
  status: z.enum(EVENT_STATUSES).optional(),
  severity: z.enum(EVENT_SEVERITIES).optional(),
  sourceId: z.string().trim().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  bbox: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

eventIntelligenceRouter.get('/', async (req, res, next) => {
  try {
    const query = listSchema.parse(req.query);
    res.json(
      await listEvents({
        ...query,
        bbox: parseBbox(query.bbox),
      }),
    );
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.get('/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    res.json({ event: await getEventOrThrow(id) });
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.get('/:id/evidence', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await getEventOrThrow(id);
    res.json({ evidence: await listEvidence(id, req.user!.role) });
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.get('/:id/timeline', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await getEventOrThrow(id);
    res.json({ timeline: await listTimeline(id) });
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.get('/:id/analysis', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await getEventOrThrow(id);
    res.json({ analyses: await getAnalyses(id) });
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.get('/:id/forecasts', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await getEventOrThrow(id);
    res.json({ forecasts: await getForecasts(id) });
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.get('/:id/recommendations', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const audience = z.enum(RECOMMENDATION_AUDIENCES).optional().parse(req.query.audience);
    res.json({ recommendations: await listRecommendations(id, audience ?? null, req.user!.role) });
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.get('/:id/authorities', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    res.json({ authorities: await getEventAuthorities(id) });
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.post('/:id/authorities', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({ authorityIds: z.array(z.string().uuid()).max(50).optional(), autoMap: z.boolean().optional() })
      .strict()
      .parse(req.body);
    if (body.autoMap) {
      res.status(201).json(await autoMapAuthorities(id, actor(req)));
      return;
    }
    if (!body.authorityIds?.length) throw badRequest('authorityIds or autoMap is required.');
    res.status(201).json(await assignEventAuthorities(id, body.authorityIds, actor(req)));
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.post('/:id/recommendations', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    res.status(201).json(await generateRecommendations(id, actor(req)));
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.post('/ingest', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    res.json(await ingestDisasterFeeds(actor(req)));
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.post('/:id/analyze', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    res.json(await analyzeEvent(id, actor(req)));
  } catch (error) {
    next(error);
  }
});

const createSchema = z
  .object({
    eventKey: z.string().trim().min(3).max(240).optional(),
    category: z.enum(EVENT_CATEGORIES),
    title: z.string().trim().min(3).max(240),
    description: z.string().trim().max(4000).nullable().optional(),
    severity: z.enum(EVENT_SEVERITIES).default('UNKNOWN'),
    startAt: z.string().datetime({ offset: true }).nullable().optional(),
    lastObservedAt: z.string().datetime({ offset: true }).nullable().optional(),
    detectedAt: z.string().datetime({ offset: true }).nullable().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    affectedArea: z.unknown().nullable().optional(),
    adminArea: z.string().trim().max(160).nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    dataQuality: z.string().trim().max(80).nullable().optional(),
    detectionSource: z.string().trim().max(100).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const evidenceSchema = z
  .object({
    evidenceType: z.enum(EVIDENCE_TYPES),
    sourceId: z.string().trim().max(100).nullable().optional(),
    sourceName: z.string().trim().max(200).nullable().optional(),
    sourceUrl: z.string().trim().url().max(1000).nullable().optional(),
    sourceRecordId: z.string().trim().max(240).nullable().optional(),
    sourceEntityType: z.string().trim().max(80).nullable().optional(),
    sourceEntityId: z.string().trim().max(160).nullable().optional(),
    title: z.string().trim().max(300).nullable().optional(),
    rawContent: z.unknown().nullable().optional(),
    observedAt: z.string().datetime({ offset: true }).nullable().optional(),
    publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    verificationStatus: z.enum(EVIDENCE_VERIFICATION_STATUSES).default('SOURCE_REPORTED'),
    reliabilityClass: z.enum(EVIDENCE_RELIABILITY_CLASSES).default('UNKNOWN'),
    freshnessStatus: z.enum(EVIDENCE_FRESHNESS_STATUSES).default('UNKNOWN'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const linkSchema = z
  .object({
    entityType: z.enum(EVENT_ENTITY_TYPES),
    entityId: z.string().trim().min(1).max(160),
    relationship: z.string().trim().min(2).max(120),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();

const correlationSchema = z
  .object({
    relatedEventId: z.string().uuid(),
    relationship: z.string().trim().min(2).max(120),
    confidence: z.number().min(0).max(1).nullable().optional(),
    reason: z.string().trim().max(2000).nullable().optional(),
    distanceM: z.number().nonnegative().nullable().optional(),
    timeDeltaSeconds: z.number().int().nullable().optional(),
  })
  .strict();

const statusSchema = z
  .object({
    status: z.enum(EVENT_STATUSES),
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

eventIntelligenceRouter.post('/', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    const result = await createEvent(createSchema.parse(req.body), actor(req));
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.post('/:id/evidence', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const result = await addEvidence(id, evidenceSchema.parse(req.body), actor(req));
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.post('/:id/links', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const result = await linkSource(id, linkSchema.parse(req.body), actor(req));
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.post('/:id/correlations', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = correlationSchema.parse(req.body);
    const result = await correlateEvents(id, body.relatedEventId, body, actor(req));
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

eventIntelligenceRouter.post('/:id/status', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = statusSchema.parse(req.body);
    res.json(await transitionEvent(id, body.status, actor(req), body.reason ?? null));
  } catch (error) {
    next(error);
  }
});
