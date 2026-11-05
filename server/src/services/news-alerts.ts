import { env, emailConfigured } from '../config/env.js';
import { query, one } from '../db/pool.js';
import { deliverEmail, markNotificationStatus, recordNotificationEvent, renderCriticalNewsEmail } from './email.js';
import { getEnvironmentalNews, isCriticalNews, type NewsItem } from './news.js';
import { recordEmail, recordFailure, recordHeartbeat } from './telemetry.js';
import { withWorkerLock } from './worker-lock.js';

const MAX_AGE_MS = 72 * 60 * 60_000;

function recentEnough(item: NewsItem): boolean {
  if (!item.publishedAt) return true;
  const published = Date.parse(item.publishedAt);
  return !Number.isFinite(published) || Date.now() - published <= MAX_AGE_MS;
}

async function recipients(): Promise<Array<{ id: string; name: string; email: string }>> {
  return query<{ id: string; name: string; email: string }>(
    `SELECT u.id, u.name, u.email
     FROM users u JOIN user_preferences p ON p.user_id=u.id
     WHERE u.role='PUBLIC' AND u.account_status='ACTIVE' AND u.email_verified=true
       AND p.news_notifications=true AND p.news_consent_at IS NOT NULL
     ORDER BY u.created_at`,
  );
}

async function recentlyNotified(userId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `SELECT id FROM notifications
     WHERE user_id=$1 AND template='NEWS_ALERT' AND created_at > now() - ($2::int * interval '1 minute')
     LIMIT 1`,
    [userId, env.NEWS_MONITOR_COOLDOWN_MINUTES],
  );
  return Boolean(row);
}

export async function monitorCriticalNews(): Promise<{ items: number; emails: number; failed: number }> {
  const feed = await getEnvironmentalNews();
  const candidates = feed.items
    .filter(isCriticalNews)
    .filter(recentEnough)
    .slice(0, env.NEWS_MONITOR_MAX_ITEMS);
  if (candidates.length === 0) return { items: 0, emails: 0, failed: 0 };

  const users = await recipients();
  let emails = 0;
  let failed = 0;
  for (const item of candidates) {
    for (const user of users) {
      if (await recentlyNotified(user.id)) continue;
      const rendered = renderCriticalNewsEmail({
        name: user.name,
        title: item.title,
        summary: item.summary,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
      });
      const inserted = await one<{ id: string }>(
        `INSERT INTO notifications
           (user_id, audience, channel, template, subject, body_html, status, is_simulated, news_item_id)
         VALUES ($1,'PUBLIC','EMAIL','NEWS_ALERT',$2,$3,'QUEUED',false,$4)
         ON CONFLICT (news_item_id, user_id) WHERE news_item_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [user.id, rendered.subject, rendered.html, item.id],
      );
      if (!inserted) continue;
      if (!emailConfigured) {
        await markNotificationStatus(inserted.id, 'FAILED', { error: 'Email provider NOT_CONFIGURED.' });
        await recordNotificationEvent(inserted.id, 'NEWS_EMAIL_FAILED', { reason: 'NOT_CONFIGURED', newsItemId: item.id });
        await recordFailure('email:citizen-alerts', 'Email provider NOT_CONFIGURED.');
        failed += 1;
        continue;
      }
      const delivery = await deliverEmail({
        notificationId: inserted.id,
        to: user.email,
        subject: rendered.subject,
        html: rendered.html,
        isSimulated: false,
      });
      await query(`UPDATE notifications SET attempt_count=attempt_count+1 WHERE id=$1`, [inserted.id]);
      await markNotificationStatus(inserted.id, delivery.status, {
        providerMessageId: delivery.messageId,
        error: delivery.error,
      });
      await recordNotificationEvent(inserted.id, delivery.event, {
        newsItemId: item.id,
        recipient: delivery.recipient,
        messageId: delivery.messageId,
      });
      await recordEmail(delivery.status !== 'FAILED', delivery.error);
      if (delivery.status === 'FAILED') {
        await query(
          `UPDATE notifications SET next_retry_at = now() + ($2::int * interval '1 minute') WHERE id=$1`,
          [inserted.id, 2],
        );
        failed += 1;
      } else {
        emails += 1;
      }
    }
  }
  return { items: candidates.length, emails, failed };
}

let newsTimer: NodeJS.Timeout | null = null;
let newsRunning = false;

async function runNewsMonitor(): Promise<void> {
  if (newsRunning) return;
  newsRunning = true;
  try {
    const executed = await withWorkerLock('worker:critical-news', async () => {
      const result = await monitorCriticalNews();
      await recordHeartbeat('worker:critical-news', result);
      if (result.items > 0 || result.emails > 0 || result.failed > 0) {
        console.log(`[critical-news] items=${result.items} emails=${result.emails} failed=${result.failed}`);
      }
      return true;
    });
    if (!executed) return;
  } catch (error) {
    console.error('[critical-news] cycle failed', error);
  } finally {
    newsRunning = false;
  }
}

export function startNewsAlertScheduler(): void {
  if (!env.NEWS_MONITOR_ENABLED || newsTimer) return;
  console.log(`[critical-news] monitor enabled · every ${env.NEWS_MONITOR_INTERVAL_SECONDS}s`);
  newsTimer = setInterval(() => void runNewsMonitor(), env.NEWS_MONITOR_INTERVAL_SECONDS * 1000);
  newsTimer.unref();
  setTimeout(() => void runNewsMonitor(), 20_000).unref();
}

export function stopNewsAlertScheduler(): void {
  if (newsTimer) clearInterval(newsTimer);
  newsTimer = null;
}
