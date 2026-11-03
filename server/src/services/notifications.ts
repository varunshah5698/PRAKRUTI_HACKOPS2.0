import { env, emailConfigured } from '../config/env.js';
import { one, query } from '../db/pool.js';
import {
  deliverEmail,
  getAlertForEmail,
  markNotificationStatus,
  recordNotificationEvent,
  renderAlertEmail,
  renderIncidentUpdateEmail,
  renderReportStatusEmail,
  type IncidentForEmail,
  type ReportUpdateForEmail,
} from './email.js';

interface Recipient {
  id: string;
  name: string;
  email: string;
  role: string;
  locality_id: string | null;
  radius_km: number | null;
  categories: string[];
}

async function publicRecipients(alertId: string, category: string): Promise<Recipient[]> {
  return query<Recipient>(
    `SELECT u.id, u.name, u.email, u.role::text, p.locality_id, p.radius_km::float8,
            p.alert_categories AS categories
     FROM users u
     JOIN user_preferences p ON p.user_id = u.id
     WHERE u.role = 'PUBLIC' AND u.account_status = 'ACTIVE'
       AND p.notify_email = true AND p.consent_at IS NOT NULL
       AND $2 = ANY(p.alert_categories)
       AND (
         p.locality_id IS NULL
         OR p.locality_id = (SELECT locality_id FROM environmental_alerts WHERE id = $1)
         OR (
           p.radius_km IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM localities pref, environmental_alerts a
             WHERE pref.id = p.locality_id AND a.id = $1 AND a.locality_id IS NOT NULL
               AND ST_DWithin(pref.location, (SELECT location FROM localities WHERE id = a.locality_id), p.radius_km * 1000)
           )
         )
       )`,
    [alertId, category],
  );
}

export async function authorityRecipients(category: string): Promise<Recipient[]> {
  return query<Recipient>(
    `SELECT u.id, u.name, u.email, u.role::text, u.locality_id, NULL::float8 AS radius_km,
            ARRAY['air','water','waste','industrial']::text[] AS categories
     FROM users u
     WHERE u.role IN ('FIELD_OFFICER','ENVIRONMENTAL_ANALYST','AUTHORITY_ADMIN','SYSTEM_ADMIN')
       AND u.account_status = 'ACTIVE'
       AND (u.jurisdiction IS NULL OR u.jurisdiction ILIKE '%mumbai%' OR u.jurisdiction = $1)`,
    [category],
  );
}

// Critical alerts are safety broadcasts: every active account is notified,
// whether or not it opted into category preferences. Placeholder addresses keep
// their in-app record but are not sent to (see deliverEmail).
async function criticalRecipients(): Promise<Recipient[]> {
  return query<Recipient>(
    `SELECT u.id, u.name, u.email, u.role::text, u.locality_id, NULL::float8 AS radius_km,
            ARRAY['air','water','waste','industrial']::text[] AS categories
     FROM users u
     WHERE u.account_status = 'ACTIVE'`,
  );
}

function templateFor(audience: 'PUBLIC' | 'AUTHORITY', level: string): string {
  if (level === 'RECOVERY') return audience === 'PUBLIC' ? 'PUBLIC_RECOVERY' : 'AUTHORITY_RECOVERY';
  if (audience === 'PUBLIC') return level === 'CRITICAL' ? 'PUBLIC_CRITICAL' : 'PUBLIC_EARLY_WARNING';
  return level === 'CRITICAL' ? 'AUTHORITY_CRITICAL' : 'AUTHORITY_EARLY_WARNING';
}

async function createForRecipient(
  alertId: string,
  recipient: Recipient,
  audience: 'PUBLIC' | 'AUTHORITY',
  alertSimulated: boolean,
  simulationSessionId: string | null,
): Promise<boolean> {
  const alert = await getAlertForEmail(alertId);
  if (!alert) return false;
  const template = templateFor(audience, alert.level);
  const existing = await one<{ id: string }>(
    `SELECT id FROM notifications
     WHERE user_id=$1 AND alert_id=$2 AND template=$3 AND created_at > now() - interval '24 hours'`,
    [recipient.id, alertId, template],
  );
  if (existing) return false;

  const rendered = renderAlertEmail(alert, audience, template);
  const isSimulated = alertSimulated || !emailConfigured || (env.DEMO_MODE && !env.DEMO_EMAIL_RECIPIENT);
  const inserted = await one<{ id: string }>(
    `INSERT INTO notifications
       (user_id, alert_id, audience, channel, template, subject, body_html, status, is_simulated, simulation_session_id)
     VALUES ($1,$2,$3,'EMAIL',$4,$5,$6,'SIMULATED',$7,$8)
     RETURNING id`,
    [recipient.id, alertId, audience, template, rendered.subject, rendered.html, isSimulated, simulationSessionId],
  );
  if (!inserted) return false;
  await recordNotificationEvent(inserted.id, 'CREATED', {
    audience,
    template,
    demoMode: env.DEMO_MODE,
    recipientMasked: recipient.email.replace(/(^.).*(@.*$)/, '$1***$2'),
  });

  const delivery = await deliverEmail({
    notificationId: inserted.id,
    to: recipient.email,
    subject: rendered.subject,
    html: rendered.html,
    isSimulated,
  });
  await markNotificationStatus(inserted.id, delivery.status, {
    providerMessageId: delivery.messageId,
    error: delivery.error,
  });
  await recordNotificationEvent(inserted.id, delivery.event);
  return true;
}

export async function createNotificationsForAlert(
  alertId: string,
  options: { simulationSessionId?: string | null } = {},
): Promise<{ publicCreated: number; authorityCreated: number }> {
  const alert = await one<{
    id: string;
    category: string;
    is_simulated: boolean;
    simulation_session_id: string | null;
    level: string;
  }>('SELECT id, category, is_simulated, simulation_session_id, level FROM environmental_alerts WHERE id=$1', [alertId]);
  if (!alert) return { publicCreated: 0, authorityCreated: 0 };

  const sessionId = options.simulationSessionId ?? alert.simulation_session_id ?? null;
  const critical = alert.level === 'CRITICAL';
  const [publicUsers, authorityUsers, broadcastUsers] = await Promise.all([
    critical ? Promise.resolve<Recipient[]>([]) : publicRecipients(alertId, alert.category),
    authorityRecipients(alert.category),
    critical ? criticalRecipients() : Promise.resolve<Recipient[]>([]),
  ]);

  const targets = new Map<string, { recipient: Recipient; audience: 'PUBLIC' | 'AUTHORITY' }>();
  for (const user of publicUsers) targets.set(user.id, { recipient: user, audience: 'PUBLIC' });
  for (const user of broadcastUsers) {
    const audience = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'].includes(user.role)
      ? 'AUTHORITY'
      : 'PUBLIC';
    targets.set(user.id, { recipient: user, audience });
  }
  for (const user of authorityUsers) targets.set(user.id, { recipient: user, audience: 'AUTHORITY' });

  let publicCreated = 0;
  let authorityCreated = 0;
  for (const { recipient, audience } of targets.values()) {
    if (await createForRecipient(alertId, recipient, audience, alert.is_simulated, sessionId)) {
      if (audience === 'AUTHORITY') authorityCreated += 1;
      else publicCreated += 1;
    }
  }
  return { publicCreated, authorityCreated };
}

export async function acknowledgeNotification(notificationId: string, userId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `UPDATE notifications SET status='ACKNOWLEDGED', acknowledged_at=now()
     WHERE id=$1 AND user_id=$2 RETURNING id`,
    [notificationId, userId],
  );
  if (!row) return false;
  await recordNotificationEvent(notificationId, 'ACKNOWLEDGED', { userId });
  return true;
}


export async function notifyReportStatusChange(
  reportId: string,
  update: { status: string; reason: string },
): Promise<boolean> {
  const report = await one<ReportUpdateForEmail & { user_id: string | null }>(
    `SELECT r.id, r.public_ref, r.category, r.incident_type, r.status, r.verification_state,
            r.is_simulated, r.user_id, l.name AS locality_name
     FROM environmental_reports r
     LEFT JOIN localities l ON l.id = r.locality_id
     WHERE r.id=$1`,
    [reportId],
  );
  // Anonymous submissions have no account to notify; the reference stays the only handle.
  if (!report?.user_id) return false;

  const recipient = await one<{ id: string; email: string; notify_email: boolean }>(
    `SELECT u.id, u.email, p.notify_email
     FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id
     WHERE u.id=$1 AND u.account_status='ACTIVE'`,
    [report.user_id],
  );
  if (!recipient) return false;

  const rendered = renderReportStatusEmail(report, update);
  const isSimulated = report.is_simulated || !emailConfigured || (env.DEMO_MODE && !env.DEMO_EMAIL_RECIPIENT);
  const inserted = await one<{ id: string }>(
    `INSERT INTO notifications
       (user_id, report_id, audience, channel, template, subject, body_html, status, is_simulated)
     VALUES ($1,$2,'PUBLIC','EMAIL','REPORT_STATUS_UPDATE',$3,$4,'SIMULATED',$5)
     RETURNING id`,
    [recipient.id, report.id, rendered.subject, rendered.html, isSimulated],
  );
  if (!inserted) return false;
  await recordNotificationEvent(inserted.id, 'CREATED', {
    template: 'REPORT_STATUS_UPDATE',
    reportId: report.id,
    status: update.status,
    emailOptIn: recipient.notify_email === true,
  });

  if (recipient.notify_email !== true) {
    await markNotificationStatus(inserted.id, 'SIMULATED', {
      error: 'In-app only: the account has email notifications switched off.',
    });
    return true;
  }

  const delivery = await deliverEmail({
    notificationId: inserted.id,
    to: recipient.email,
    subject: rendered.subject,
    html: rendered.html,
    isSimulated,
  });
  await markNotificationStatus(inserted.id, delivery.status, { providerMessageId: delivery.messageId, error: delivery.error });
  await recordNotificationEvent(inserted.id, delivery.event);
  return true;
}

export async function createIncidentUpdateNotifications(incidentId: string, update: string): Promise<number> {
  const incident = await one<IncidentForEmail & { is_simulated: boolean; simulation_session_id: string | null }>(
    `SELECT i.id, i.public_ref, i.title, i.category, i.status, i.risk_level, i.is_simulated,
            i.simulation_session_id, l.name AS locality_name, u.name AS assigned_to_name
     FROM environmental_incidents i
     LEFT JOIN localities l ON l.id=i.locality_id
     LEFT JOIN users u ON u.id=i.assigned_to
     WHERE i.id=$1`,
    [incidentId],
  );
  if (!incident) return 0;
  const recipients = await authorityRecipients(incident.category);
  const rendered = renderIncidentUpdateEmail(incident, update);
  let created = 0;
  for (const recipient of recipients) {
    const recent = await one<{ id: string }>(
      `SELECT id FROM notifications WHERE user_id=$1 AND incident_id=$2 AND template='AUTHORITY_INCIDENT_UPDATE'
       AND created_at > now() - interval '5 minutes'`,
      [recipient.id, incident.id],
    );
    if (recent) continue;
    const isSimulated = incident.is_simulated || !emailConfigured || (env.DEMO_MODE && !env.DEMO_EMAIL_RECIPIENT);
    const row = await one<{ id: string }>(
      `INSERT INTO notifications
         (user_id, incident_id, audience, channel, template, subject, body_html, status, is_simulated, simulation_session_id)
       VALUES ($1,$2,'AUTHORITY','EMAIL','AUTHORITY_INCIDENT_UPDATE',$3,$4,'SIMULATED',$5,$6)
       RETURNING id`,
      [recipient.id, incident.id, rendered.subject, rendered.html, isSimulated, incident.simulation_session_id],
    );
    if (!row) continue;
    await recordNotificationEvent(row.id, 'CREATED', { template: 'AUTHORITY_INCIDENT_UPDATE', incidentId: incident.id });
    const delivery = await deliverEmail({
      notificationId: row.id,
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      isSimulated,
    });
    await markNotificationStatus(row.id, delivery.status, { providerMessageId: delivery.messageId, error: delivery.error });
    await recordNotificationEvent(row.id, delivery.event);
    created += 1;
  }
  return created;
}
