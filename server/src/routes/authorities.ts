import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  AUTHORITY_LEVELS,
  AUTHORITY_MEMBERSHIP_ROLES,
  AUTHORITY_MEMBERSHIP_STATUSES,
  AUTHORITY_ACTION_TYPES,
  EVENT_AUTHORITY_STATUSES,
} from '../types.js';
import {
  actionTargetStatus,
  authorityEventDetail,
  authorityEvents,
  createAuthority,
  createMembership,
  getAuthority,
  listAuthorities,
  membershipsForUser,
  recordAuthorityAction,
} from '../services/authority.js';

export const authoritiesRouter = Router();
authoritiesRouter.use(requireAuth);

const mutationLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
const actor = (req: Express.Request) => ({ id: req.user!.id, type: 'USER' as const });

const authoritySchema = z
  .object({
    code: z.string().trim().min(2).max(80),
    name: z.string().trim().min(3).max(240),
    abbreviation: z.string().trim().max(40).nullable().optional(),
    level: z.enum(AUTHORITY_LEVELS),
    parentId: z.string().uuid().nullable().optional(),
    officialUrl: z.string().url().max(1000).nullable().optional(),
    officialContacts: z.record(z.string(), z.unknown()).optional(),
    reportingChannels: z.array(z.unknown()).optional(),
    dataFeeds: z.array(z.unknown()).optional(),
    coverageCountry: z.string().trim().max(80).nullable().optional(),
    coverageState: z.string().trim().max(120).nullable().optional(),
    coverageDistrict: z.string().trim().max(120).nullable().optional(),
    coverageCity: z.string().trim().max(120).nullable().optional(),
    jurisdictionArea: z.unknown().nullable().optional(),
    verificationStatus: z.enum(['SOURCE_VERIFIED', 'PARTIALLY_VERIFIED', 'UNVERIFIED', 'DISPUTED']).optional(),
    sourceUrl: z.string().url().max(1000).nullable().optional(),
    notes: z.string().trim().max(3000).nullable().optional(),
  })
  .strict();

authoritiesRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ authorities: await listAuthorities() });
  } catch (error) {
    next(error);
  }
});

authoritiesRouter.get('/:id', async (req, res, next) => {
  try {
    res.json({ authority: await getAuthority(z.string().uuid().parse(req.params.id)) });
  } catch (error) {
    next(error);
  }
});

authoritiesRouter.post('/', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    res.status(201).json({ authority: await createAuthority(authoritySchema.parse(req.body), actor(req)) });
  } catch (error) {
    next(error);
  }
});

authoritiesRouter.post('/:id/memberships', mutationLimiter, requireRole('SYSTEM_ADMIN'), async (req, res, next) => {
  try {
    const authorityId = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        userId: z.string().uuid(),
        membershipRole: z.enum(AUTHORITY_MEMBERSHIP_ROLES),
        status: z.enum(AUTHORITY_MEMBERSHIP_STATUSES).optional(),
        verificationSource: z.string().trim().max(500).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json({ membership: await createMembership(authorityId, body, actor(req)) });
  } catch (error) {
    next(error);
  }
});

export const authorityPortalRouter = Router();
authorityPortalRouter.use(requireAuth);

authorityPortalRouter.get('/me', async (req, res, next) => {
  try {
    res.json({ memberships: await membershipsForUser(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

authorityPortalRouter.get('/events', async (req, res, next) => {
  try {
    const status = z.enum(EVENT_AUTHORITY_STATUSES).optional().parse(req.query.status);
    res.json({ events: await authorityEvents(req.user!.id, status) });
  } catch (error) {
    next(error);
  }
});

authorityPortalRouter.get('/events/:id', async (req, res, next) => {
  try {
    const eventId = z.string().uuid().parse(req.params.id);
    const authorityId = z.string().uuid().parse(req.query.authorityId);
    res.json(await authorityEventDetail(req.user!.id, eventId, authorityId));
  } catch (error) {
    next(error);
  }
});

authorityPortalRouter.post('/events/:id/actions', mutationLimiter, async (req, res, next) => {
  try {
    const eventId = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        authorityId: z.string().uuid(),
        actionType: z.enum(AUTHORITY_ACTION_TYPES),
        channel: z.string().trim().max(120).nullable().optional(),
        deliveryReference: z.string().trim().max(500).nullable().optional(),
        response: z.string().trim().max(4000).nullable().optional(),
        evidenceIds: z.array(z.string().uuid()).max(100).optional(),
        notes: z.string().trim().max(4000).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    if (body.actionType === 'NOTIFICATION_SENT' && (!body.channel || !body.deliveryReference)) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'NOTIFICATION_SENT requires channel and deliveryReference. This records a manual notification; it does not prove external delivery.',
        },
      });
      return;
    }
    res.status(201).json({
      action: await recordAuthorityAction(req.user!.id, eventId, body.authorityId, body, actor(req)),
      targetStatus: actionTargetStatus(body.actionType),
    });
  } catch (error) {
    next(error);
  }
});
