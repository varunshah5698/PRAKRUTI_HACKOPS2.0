import { Router } from 'express';
import { requireAuth, AUTHORITY_ADMIN_ROLES } from '../middleware/auth.js';
import { forbidden } from '../middleware/errors.js';
import { getLiveSnapshot, liveStatus, runLiveCycle } from '../services/live.js';

export const liveRouter = Router();
liveRouter.use(requireAuth);

liveRouter.get('/status', (_req, res) => {
  res.json(liveStatus());
});

liveRouter.get('/', async (req, res, next) => {
  try {
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : undefined;
    res.json({
      generatedAt: new Date().toISOString(),
      readings: await getLiveSnapshot(stationId),
      status: liveStatus(),
    });
  } catch (error) {
    next(error);
  }
});

liveRouter.post('/refresh', async (req, res, next) => {
  try {
    if (!AUTHORITY_ADMIN_ROLES.includes(req.user!.role)) throw forbidden('Authority administrator role required.');
    const result = await runLiveCycle();
    res.json({ message: 'Live polling cycle completed.', result });
  } catch (error) {
    next(error);
  }
});
