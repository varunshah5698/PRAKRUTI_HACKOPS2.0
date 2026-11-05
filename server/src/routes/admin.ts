import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest } from '../middleware/errors.js';
import { healthSnapshot, recordEmail, recordFailure } from '../services/telemetry.js';
import { locationKey, monitorCitizenWeather, probeWeather } from '../services/citizen-weather.js';
import { emailConfigured, emailProviderLabel, env } from '../config/env.js';
import { deliverEmail, markNotificationStatus, recordNotificationEvent, renderTestEmail, resolvedFromAddress } from '../services/email.js';
import { brevoConfigured, parseSender, resolvedSender, verifyBrevoSender } from '../services/brevo.js';
import { one, query } from '../db/pool.js';

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

const e2eLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 2, standardHeaders: true, legacyHeaders: false });

adminRouter.post('/e2e/weather-alert', e2eLimiter, async (req, res, next) => {
  try {
    const body = z
      .object({ aEmail: z.string().trim().email().max(200), bEmail: z.string().trim().email().max(200) })
      .strict()
      .parse(req.body);
    const domain = env.E2E_TEST_DOMAIN.toLowerCase().replace(/^@/, '');
    const aEmail = body.aEmail.toLowerCase();
    const bEmail = body.bEmail.toLowerCase();
    if (aEmail === bEmail) throw badRequest('Two distinct test addresses are required.');
    for (const email of [aEmail, bEmail]) {
      if (!email.endsWith(`@${domain}`)) throw badRequest(`E2E test recipients must use @${domain}.`);
    }

    const a = { name: 'E2E Citizen A', email: aEmail, lat: 19.1234, lng: 72.8888, label: 'E2E Mumbai' };
    const b = { name: 'E2E Citizen B', email: bEmail, lat: 18.5678, lng: 73.9123, label: 'E2E Pune' };
    const aKey = locationKey(a.lat, a.lng);
    const bKey = locationKey(b.lat, b.lng);

    const upsertUser = async (citizen: typeof a) => {
      const row = await one<{ id: string }>(
        `INSERT INTO users (name, email, password_hash, role, account_status, email_verified, onboarding_completed)
         VALUES ($1,$2,'!e2e-no-login!','PUBLIC','ACTIVE',true,true)
         ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role='PUBLIC', account_status='ACTIVE',
           email_verified=true, onboarding_completed=true, updated_at=now()
         RETURNING id`,
        [citizen.name, citizen.email],
      );
      if (!row) throw new Error('Could not create the E2E citizen.');
      await query(
        `INSERT INTO user_preferences
           (user_id, weather_notifications, news_notifications, latitude, longitude, location_label,
            weather_consent_at, consent_at, updated_at)
         VALUES ($1,true,false,$2,$3,$4,now(),now(),now())
         ON CONFLICT (user_id) DO UPDATE SET weather_notifications=true, news_notifications=false,
           latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, location_label=EXCLUDED.location_label,
           weather_consent_at=now(), consent_at=now(), updated_at=now()`,
        [row.id, citizen.lat, citizen.lng, citizen.label],
      );
      return row.id;
    };

    const aId = await upsertUser(a);
    const bId = await upsertUser(b);
    await query(`DELETE FROM notifications WHERE user_id IN ($1,$2) AND template='WEATHER_ALERT'`, [aId, bId]);
    await query(`DELETE FROM weather_events WHERE location_key = ANY($1::text[])`, [[aKey, bKey]]);
    await query(`DELETE FROM citizen_weather_readings WHERE location_key = ANY($1::text[])`, [[aKey, bKey]]);

    const counts = async () => {
      const rows = await query<{ user_id: string; count: number }>(
        `SELECT user_id, COUNT(*)::int AS count FROM notifications
         WHERE user_id IN ($1,$2) AND template='WEATHER_ALERT' GROUP BY user_id`,
        [aId, bId],
      );
      return {
        a: rows.find((row) => row.user_id === aId)?.count ?? 0,
        b: rows.find((row) => row.user_id === bId)?.count ?? 0,
      };
    };

    const runPhase = async (aTemp: number, bTemp: number, aEnabled: boolean) => {
      await query(`UPDATE user_preferences SET weather_notifications=$2, updated_at=now() WHERE user_id=$1`, [aId, aEnabled]);
      const worker = await monitorCitizenWeather({
        testOnly: true,
        testMode: true,
        fixtures: [
          { latitude: a.lat, longitude: a.lng, temperatureC: aTemp, relativeHumidity: 55, precipitationMm: 0, windSpeedKmh: 10, windGustKmh: 18, weatherCode: 0 },
          { latitude: b.lat, longitude: b.lng, temperatureC: bTemp, relativeHumidity: 50, precipitationMm: 0, windSpeedKmh: 8, windGustKmh: 15, weatherCode: 0 },
        ],
      });
      return { worker, counts: await counts() };
    };

    const phase1 = await runPhase(46, 30, true);
    const phase2 = await runPhase(46, 30, true);
    const phase3 = await runPhase(48, 30, false);

    const history = await query<{
      user_id: string;
      email: string;
      id: string;
      subject: string;
      status: string;
      provider_message_id: string | null;
      error: string | null;
      created_at: string;
      condition: string | null;
      severity: string | null;
      measured_value: number | null;
      unit: string | null;
      source_id: string | null;
    }>(
      `SELECT n.user_id, u.email, n.id, n.subject, n.status, n.provider_message_id, n.error, n.created_at,
              e.condition, e.severity, e.measured_value::float8 AS measured_value, e.unit, e.source_id
       FROM notifications n JOIN users u ON u.id=n.user_id
       LEFT JOIN weather_events e ON e.id=n.weather_event_id
       WHERE n.user_id IN ($1,$2) AND n.template='WEATHER_ALERT'
       ORDER BY n.created_at`,
      [aId, bId],
    );
    const events = history.length
      ? await query<{ notification_id: string; detail: Record<string, unknown> }>(
          `SELECT notification_id, detail FROM notification_events
           WHERE notification_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
          [history.map((row) => row.id)],
        )
      : [];
    const eventMap = new Map(events.map((row) => [row.notification_id, row.detail]));
    const mask = (email: string) => email.replace(/^(.*?)(@.*)$/, (_match, local: string, domain: string) => `${local.slice(0, 6)}***${domain}`);

    res.json({
      enabled: true,
      provider: emailProviderLabel,
      emailConfigured,
      testAccounts: {
        a: { id: aId, email: mask(a.email), location: a.label, latitude: a.lat, longitude: a.lng },
        b: { id: bId, email: mask(b.email), location: b.label, latitude: b.lat, longitude: b.lng },
      },
      fixtures: { a: '46°C HIGH, then 48°C CRITICAL after opt-out', b: '30°C NORMAL' },
      phases: { phase1, phase2, phase3 },
      history: history.map((row) => {
        const detail = eventMap.get(row.id) ?? {};
        return {
          citizen: row.user_id === aId ? 'A' : 'B',
          email: mask(row.email),
          notificationId: row.id,
          subject: row.subject,
          status: row.status,
          providerMessageId: row.provider_message_id,
          httpStatus: typeof detail.httpStatus === 'number' ? detail.httpStatus : null,
          e2e: detail.e2e === true,
          error: row.error,
          condition: row.condition,
          severity: row.severity,
          measuredValue: row.measured_value,
          unit: row.unit,
          source: row.source_id,
          createdAt: row.created_at,
        };
      }),
      note: 'Controlled E2E fixture. No real weather observation, real citizen, or real emergency condition was used. Citizen A is opted out after phase 3; the test domain is excluded from the production worker.',
    });
  } catch (error) {
    next(error);
  }
});
