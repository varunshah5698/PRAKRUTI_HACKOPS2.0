import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { healthSnapshot } from '../services/telemetry.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('SYSTEM_ADMIN'));

adminRouter.get('/health', async (_req, res, next) => {
  try {
    res.json(await healthSnapshot());
  } catch (error) {
    next(error);
  }
});
