import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { healthSnapshot } from '../services/telemetry.js';
import { probeWeather } from '../services/citizen-weather.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('SYSTEM_ADMIN'));

adminRouter.get('/health', async (_req, res, next) => {
  try {
    res.json(await healthSnapshot());
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/weather-probe', async (req, res, next) => {
  try {
    const point = z
      .object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) })
      .parse(req.query);
    res.json({ request: point, fetchedAt: new Date().toISOString(), result: await probeWeather(point.lat, point.lng) });
  } catch (error) {
    next(error);
  }
});
