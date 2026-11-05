import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { healthSnapshot, recordEmail, recordFailure } from '../services/telemetry.js';
import { probeWeather } from '../services/citizen-weather.js';
import { emailConfigured, emailProviderLabel, env } from '../config/env.js';
import { deliverEmail, markNotificationStatus, recordNotificationEvent, renderTestEmail, resolvedFromAddress } from '../services/email.js';
import { brevoConfigured, parseSender, resolvedSender, verifyBrevoSender } from '../services/brevo.js';
import { one } from '../db/pool.js';

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

adminRouter.get('/email/status', async (_req, res, next) => {
  try {
    const brevo = env.EMAIL_PROVIDER.toLowerCase() === 'brevo';
    const sender = brevo ? resolvedSender() : parseSender(resolvedFromAddress());
    const verification = brevo ? await verifyBrevoSender() : null;
    res.json({
      provider: emailProviderLabel,
      providerMode: env.EMAIL_PROVIDER,
      configured: emailConfigured,
      sender: {
        email: sender.email,
        name: sender.name,
        formatted: sender.formatted,
        verified: verification ? verification.verified : null,
      },
      brevo: brevo
        ? {
            configured: brevoConfigured(),
            verified: verification?.verified ?? false,
            httpStatus: verification?.httpStatus ?? null,
            error: verification?.error,
          }
        : null,
      smtpInUse: !brevo && env.EMAIL_PROVIDER.toLowerCase() !== 'console',
      note: 'A 2xx Brevo response means API acceptance only. Inbox delivery requires a provider event or recipient check.',
    });
  } catch (error) {
    next(error);
  }
});

const emailTestLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 3, standardHeaders: true, legacyHeaders: false });

adminRouter.post('/email/test', emailTestLimiter, async (req, res, next) => {
  try {
    const body = z.object({ to: z.string().trim().email().max(200) }).strict().parse(req.body);
    if (!emailConfigured) {
      await recordFailure('email:citizen-alerts', 'Email provider NOT_CONFIGURED.');
      res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'Email provider is not configured.' } });
      return;
    }
    const rendered = renderTestEmail(req.user!.name);
    const inserted = await one<{ id: string }>(
      `INSERT INTO notifications (user_id, audience, channel, template, subject, body_html, status, is_simulated)
       VALUES ($1,'AUTHORITY','EMAIL','EMAIL_TEST',$2,$3,'SIMULATED',false) RETURNING id`,
      [req.user!.id, rendered.subject, rendered.html],
    );
    if (!inserted) throw new Error('Could not record the diagnostic notification.');
    const delivery = await deliverEmail({
      notificationId: inserted.id,
      to: body.to,
      subject: rendered.subject,
      html: rendered.html,
      isSimulated: false,
    });
    await markNotificationStatus(inserted.id, delivery.status, {
      providerMessageId: delivery.messageId,
      error: delivery.error,
    });
    await recordNotificationEvent(inserted.id, delivery.event, {
      recipientMasked: body.to.replace(/(^.).*(@.*$)/, '$1***$2'),
      messageId: delivery.messageId,
      httpStatus: delivery.httpStatus ?? null,
      provider: emailProviderLabel,
      accepted: delivery.status === 'SENT',
    });
    await recordEmail(delivery.status !== 'FAILED', delivery.error);
    const responseSender = env.EMAIL_PROVIDER.toLowerCase() === 'brevo'
      ? resolvedSender()
      : parseSender(resolvedFromAddress());
    res.status(delivery.status === 'FAILED' ? 502 : 200).json({
      provider: emailProviderLabel,
      status: delivery.status,
      accepted: delivery.status === 'SENT',
      delivered: false,
      httpStatus: delivery.httpStatus ?? null,
      messageId: delivery.messageId ?? null,
      error: delivery.error,
      event: delivery.event,
      sender: { email: responseSender.email, name: responseSender.name, formatted: resolvedFromAddress() },
    });
  } catch (error) {
    next(error);
  }
});
