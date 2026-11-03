import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAuthority } from '../middleware/auth.js';
import { answerQuestion, stationAnalysis, aiStatus } from '../services/ai/analyst.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

aiRouter.get('/status', (_req, res) => {
  res.json(aiStatus());
});

aiRouter.use(requireAuthority);

aiRouter.post('/analyse', limiter, async (req, res, next) => {
  try {
    const body = z
      .object({
        stationId: z.string().uuid().optional(),
        localityId: z.string().uuid().optional(),
        reportId: z.string().uuid().optional(),
        category: z.enum(['air', 'water', 'waste', 'industrial']).optional(),
        type: z.enum(['observation', 'predictive', 'compliance', 'custom']).default('custom'),
        question: z.string().trim().min(5).max(1200).optional(),
      })
      .parse(req.body);
    if (body.type !== 'custom' && body.stationId) {
      const answer = await stationAnalysis(body.stationId, body.type);
      res.json(answer);
      return;
    }
    const question =
      body.question ??
      'Summarise the available environmental evidence for this context, separate observed, predicted, reported and estimated information, cite reference standards, list limitations and suggest next actions.';
    const answer = await answerQuestion({
      question,
      stationId: body.stationId ?? null,
      localityId: body.localityId ?? null,
      reportId: body.reportId ?? null,
      category: body.category ?? 'air',
    });
    res.json(answer);
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/chat', limiter, async (req, res, next) => {
  try {
    const body = z
      .object({
        question: z.string().trim().min(2).max(1200),
        stationId: z.string().uuid().optional(),
        localityId: z.string().uuid().optional(),
        reportId: z.string().uuid().optional(),
        category: z.enum(['air', 'water', 'waste', 'industrial']).optional(),
      })
      .parse(req.body);
    const answer = await answerQuestion({
      question: body.question,
      stationId: body.stationId ?? null,
      localityId: body.localityId ?? null,
      reportId: body.reportId ?? null,
      category: body.category ?? 'air',
    });
    res.json(answer);
  } catch (error) {
    next(error);
  }
});
