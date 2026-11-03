import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { env, appConfig } from './config/env.js';
import { pool } from './db/pool.js';
import { ApiError } from './middleware/errors.js';
import { optionalAuth, requireAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { dashboardRouter } from './routes/dashboard.js';
import { mapRouter } from './routes/map.js';
import { predictionsRouter, risksRouter } from './routes/predictions.js';
import { reportsRouter, evidenceRouter } from './routes/reports.js';
import { alertsRouter } from './routes/alerts.js';
import { incidentsRouter } from './routes/incidents.js';
import { complianceRouter } from './routes/compliance.js';
import { notificationsRouter, notificationTemplatesRouter } from './routes/notifications.js';
import { simulationsRouter } from './routes/simulations.js';
import { aiRouter } from './routes/ai.js';
import { sourcesRouter, governanceRouter } from './routes/sources.js';
import { liveRouter } from './routes/live.js';
import { getDashboard } from './services/dashboard.js';
import { syncSourceCatalogue } from './services/sources.js';
import { ingestOpenMeteoWeather } from './services/ingest.js';
import { startLiveScheduler, stopLiveScheduler } from './services/live.js';
import { evaluateAllStations, evaluateWasteLocalities } from './services/risk.js';
import { syncAlertsFromStationAssessments, syncAlertsFromWasteAssessments } from './services/alerts.js';
import { addEventClient, clientCount, closeEventClients, removeEventClient } from './lib/events.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(
  cors({
    origin: [env.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(optionalAuth);
app.use(rateLimit({ windowMs: 60_000, limit: 400, standardHeaders: true, legacyHeaders: false }));

// Same-origin check for state-changing requests. Server-to-server webhooks have no Origin.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/api/v1/notifications/webhook') return next();
  const origin = req.header('origin');
  if (origin) {
    const allowed = [env.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'];
    if (!allowed.includes(origin)) {
      res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } });
      return;
    }
  }
  next();
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'connected',
      demoMode: env.DEMO_MODE,
      sseClients: clientCount(),
      time: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/public', publicRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/map', mapRouter);
app.use('/api/v1/predictions', predictionsRouter);
app.use('/api/v1/risks', risksRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/evidence', evidenceRouter);
app.use('/api/v1/alerts', alertsRouter);
app.use('/api/v1/incidents', incidentsRouter);
app.use('/api/v1/compliance', complianceRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/notification-templates', notificationTemplatesRouter);
app.use('/api/v1/simulations', simulationsRouter);
app.use('/api/v1/ai', aiRouter);
app.use('/api/v1/sources', sourcesRouter);
app.use('/api/v1/live', liveRouter);
app.use('/api/v1/governance', governanceRouter);

app.get('/api/v1/environment/categories', requireAuth, async (_req, res, next) => {
  try {
    const dashboard = await getDashboard();
    res.json({ categories: dashboard.categories, generatedAt: dashboard.generatedAt, demoMode: dashboard.demoMode });
  } catch (error) {
    next(error);
  }
});

// Alias mounted last so its blanket auth guard cannot intercept public report
// submission or public source-status routes defined above.
app.use('/api/v1', mapRouter);

app.get('/api/v1/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const id = addEventClient(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString(), demoMode: env.DEMO_MODE })}\n\n`);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    removeEventClient(id);
  });
});

const webDist = path.resolve(here, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
});

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    const reason = error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ');
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: `Invalid request — ${reason}`, details: error.flatten() },
    });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  console.error(`[api-error] ${req.method} ${req.path}`, error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Internal server error.' : error instanceof Error ? error.message : 'Unknown error',
    },
  });
});

async function startSchedulers() {
  if (env.NODE_ENV === 'test') return;
  await syncSourceCatalogue();
  startLiveScheduler();
  // Hourly forecast grids: the providers republish them on the hour, so a
  // 6-hourly refresh is enough between live current-reading polls.
  setInterval(() => {
    ingestOpenMeteoWeather().catch((error) => console.error('[forecast-job]', error));
  }, 6 * 60 * 60_000).unref();
  const runRiskCycle = async () => {
    try {
      const stationAssessments = await evaluateAllStations();
      await syncAlertsFromStationAssessments(stationAssessments);
      const waste = await evaluateWasteLocalities();
      await syncAlertsFromWasteAssessments(waste);
    } catch (error) {
      console.error('[risk-job]', error);
    }
  };
  setInterval(() => void runRiskCycle(), 5 * 60_000).unref();
  await runRiskCycle();
}

const server = app.listen(env.PORT, () => {
  console.log(`प्रकृति API listening on http://localhost:${env.PORT}`);
  console.log(`Demo mode: ${env.DEMO_MODE ? 'ON' : 'OFF'} · storage: ${appConfig.storageRoot}`);
  startSchedulers().catch((error) => console.error('[scheduler-start]', error));
  // Seed after the server is listening so Render's health check is not blocked
  // by live weather/CAMS calls. A single instance is assumed.
  if (env.NODE_ENV === 'production' && env.DEMO_MODE) {
    const seed = spawn(process.execPath, [path.join(here, 'db', 'seed.js'), '--if-empty'], { stdio: 'inherit' });
    seed.on('error', (error) => console.error('[seed]', error));
    seed.on('exit', (code) => {
      if (code !== 0) console.error(`[seed] exited with code ${code}`);
    });
  }
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down.`);
  stopLiveScheduler();
  closeEventClients();
  // Give in-flight requests (AI analyses can take ~30 s) time to finish after
  // Render switches traffic, then force the process down before SIGKILL.
  const graceMs = env.NODE_ENV === 'production' ? 25_000 : 1_000;
  const forceExit = setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, graceMs);
  forceExit.unref();
  server.close(() => {
    clearTimeout(forceExit);
    pool.end().finally(() => process.exit(0));
  });
  // Idle keep-alive sockets do not need to block shutdown; active requests do.
  server.closeIdleConnections();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export { app };
