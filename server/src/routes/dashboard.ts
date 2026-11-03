import { Router } from 'express';
import { getDashboard } from '../services/dashboard.js';
import { requireAuth } from '../middleware/auth.js';
import { integrationStatus } from '../services/sources.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/summary', async (_req, res, next) => {
  try {
    const dashboard = await getDashboard();
    res.json({ ...dashboard, integrations: integrationStatus() });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/categories', async (_req, res, next) => {
  try {
    const dashboard = await getDashboard();
    res.json({ categories: dashboard.categories, generatedAt: dashboard.generatedAt, demoMode: dashboard.demoMode });
  } catch (error) {
    next(error);
  }
});
