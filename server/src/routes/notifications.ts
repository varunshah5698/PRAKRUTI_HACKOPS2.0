import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../middleware/errors.js';
import { env } from '../config/env.js';
import { acknowledgeNotification } from '../services/notifications.js';
import { getAlertForEmail, renderAlertEmail, recordNotificationEvent, markNotificationStatus } from '../services/email.js';

export const notificationsRouter = Router();

notificationsRouter.get('/webhook', (_req, res) => {
  res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for delivery webhooks.' } });
});

notificationsRouter.post('/webhook', async (req, res, next) => {
  try {
    if (!env.EMAIL_WEBHOOK_SECRET) {
      res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'Email webhook secret is not configured.' } });
      return;
    }
    const secret = req.header('x-webhook-secret');
    if (secret !== env.EMAIL_WEBHOOK_SECRET) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook secret.' } });
      return;
    }
    const body = z
      .object({
        providerMessageId: z.string().min(1),
        status: z.enum(['delivered', 'failed', 'bounced']),
        error: z.string().max(1000).optional(),
      })
      .parse(req.body);
    const notification = await one<{ id: string }>('SELECT id FROM notifications WHERE provider_message_id=$1', [
      body.providerMessageId,
    ]);
    if (!notification) throw notFound('Notification not found for provider message id.');
    if (body.status === 'delivered') {
      await markNotificationStatus(notification.id, 'DELIVERED');
    } else {
      await markNotificationStatus(notification.id, 'FAILED', { error: body.error ?? body.status });
    }
    await recordNotificationEvent(notification.id, `PROVIDER_${body.status.toUpperCase()}`, body);
    res.json({ message: 'Delivery status recorded.' });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 30)));
    const rows = await query<Record<string, unknown>>(
      `SELECT n.id, n.alert_id, n.incident_id, n.report_id, n.audience, n.channel, n.template, n.subject, n.status,
              n.provider_message_id, n.sent_at, n.delivered_at, n.error, n.is_simulated, n.created_at,
              n.acknowledged_at,
              COALESCE(a.public_ref, i.public_ref, r.public_ref) AS alert_ref,
              COALESCE(a.category, i.category, r.category) AS alert_category,
              COALESCE(a.level, i.risk_level) AS alert_level,
              COALESCE(a.trigger_type, 'INCIDENT_UPDATE') AS trigger_type,
              r.status AS report_status,
              COALESCE(l.name, il.name, rl.name) AS locality_name
       FROM notifications n
       LEFT JOIN environmental_alerts a ON a.id=n.alert_id
       LEFT JOIN environmental_incidents i ON i.id=n.incident_id
       LEFT JOIN environmental_reports r ON r.id=n.report_id
       LEFT JOIN localities l ON l.id=a.locality_id
       LEFT JOIN localities il ON il.id=i.locality_id
       LEFT JOIN localities rl ON rl.id=r.locality_id
       WHERE n.user_id=$1 AND n.simulation_session_id IS NULL AND ($2::text IS NULL OR n.status=$2)
       ORDER BY n.created_at DESC LIMIT $3 OFFSET $4`,
      [req.user!.id, status, pageSize, (page - 1) * pageSize],
    );
    const total = await one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND simulation_session_id IS NULL AND ($2::text IS NULL OR status=$2)`,
      [req.user!.id, status],
    );
    res.json({ notifications: rows, total: total?.count ?? 0, page, pageSize });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.get('/preferences', async (req, res, next) => {
  try {
    const prefs = await one<Record<string, unknown>>('SELECT * FROM user_preferences WHERE user_id=$1', [req.user!.id]);
    res.json({
      preferences: prefs,
      provider: {
        configured: env.EMAIL_PROVIDER === 'smtp' && Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD),
        mode: env.EMAIL_PROVIDER,
        demoMode: env.DEMO_MODE,
        demoRecipientConfigured: Boolean(env.DEMO_EMAIL_RECIPIENT),
        note:
          'In DEMO_MODE, emails are only sent to the configured demonstration recipient. Otherwise notifications are stored as SIMULATED records. DELIVERED is only set by a provider webhook.',
      },
    });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.put('/preferences', async (req, res, next) => {
  try {
    const body = z
      .object({
        alertCategories: z.array(z.enum(['air', 'water', 'waste', 'industrial'])).min(1),
        notifyEmail: z.boolean(),
        localityId: z.string().uuid().nullable().optional(),
        radiusKm: z.number().min(0.5).max(100).nullable().optional(),
        consent: z.boolean(),
      })
      .parse(req.body);
    if (body.notifyEmail && !body.consent) throw badRequest('Consent is required for email notifications.');
    await query(
      `INSERT INTO user_preferences (user_id, alert_categories, notify_email, locality_id, radius_km, consent_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (user_id) DO UPDATE SET alert_categories=EXCLUDED.alert_categories,
         notify_email=EXCLUDED.notify_email, locality_id=EXCLUDED.locality_id, radius_km=EXCLUDED.radius_km,
         consent_at=EXCLUDED.consent_at, updated_at=now()`,
      [
        req.user!.id,
        body.alertCategories,
        body.notifyEmail,
        body.localityId ?? null,
        body.radiusKm ?? null,
        body.notifyEmail && body.consent ? new Date().toISOString() : null,
      ],
    );
    res.json({ message: 'Notification preferences updated.' });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const ok = await acknowledgeNotification(req.params.id, req.user!.id);
    if (!ok) throw notFound('Notification not found.');
    res.json({ message: 'Notification acknowledged.' });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.get('/:id/preview', async (req, res, next) => {
  try {
    const notification = await one<{ id: string; user_id: string; alert_id: string | null; audience: string; template: string; subject: string; body_html: string }>(
      'SELECT id, user_id, alert_id, audience, template, subject, body_html FROM notifications WHERE id=$1',
      [req.params.id],
    );
    if (!notification) throw notFound('Notification not found.');
    const isAuthority = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'].includes(req.user!.role);
    if (notification.user_id !== req.user!.id && !isAuthority) throw forbidden('This notification is private.');
    res.json({ notification });
  } catch (error) {
    next(error);
  }
});

export const notificationTemplatesRouter = Router();
notificationTemplatesRouter.use(requireAuth);
notificationTemplatesRouter.get('/:alertId', async (req, res, next) => {
  try {
    if (!['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'].includes(req.user!.role)) {
      throw forbidden('Authority role required to preview templates.');
    }
    const alert = await getAlertForEmail(req.params.alertId);
    if (!alert) throw notFound('Alert not found.');
    res.json({
      public: renderAlertEmail(alert, 'PUBLIC', alert.level === 'CRITICAL' ? 'PUBLIC_CRITICAL' : 'PUBLIC_EARLY_WARNING'),
      authority: renderAlertEmail(alert, 'AUTHORITY', alert.level === 'CRITICAL' ? 'AUTHORITY_CRITICAL' : 'AUTHORITY_EARLY_WARNING'),
      recovery: {
        public: renderAlertEmail({ ...alert, level: 'RECOVERY' }, 'PUBLIC', 'PUBLIC_RECOVERY'),
        authority: renderAlertEmail({ ...alert, level: 'RECOVERY' }, 'AUTHORITY', 'AUTHORITY_RECOVERY'),
      },
      note: 'Preview only. No email is sent by this endpoint.',
    });
  } catch (error) {
    next(error);
  }
});
