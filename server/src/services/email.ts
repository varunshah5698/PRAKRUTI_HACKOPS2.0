import nodemailer from 'nodemailer';
import { env, emailConfigured } from '../config/env.js';
import { one, query } from '../db/pool.js';

export interface AlertForEmail {
  id: string;
  public_ref: string;
  category: string;
  level: string;
  state: string;
  trigger_type: string;
  title: string;
  summary: string;
  locality_name: string | null;
  station_name: string | null;
  triggered_at: string;
  evidence: unknown[];
  is_simulated: boolean;
  forecast_horizon_hours: number | null;
  model_name: string | null;
  model_version: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  air: 'Air pollution',
  water: 'Water pollution',
  waste: 'Unsafe waste disposal',
  industrial: 'Industrial emissions',
};

function shell(title: string, intro: string, body: string, footerNote: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f5f1;font-family:Inter,Arial,sans-serif;color:#151817;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f1;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #dfe3d8;border-radius:16px;overflow:hidden">
<tr><td style="background:#101317;padding:20px 24px;color:#f3f5f7">
  <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#b5e36b">प्रकृति</div>
  <div style="font-size:20px;font-weight:700;margin-top:6px">${escapeHtml(title)}</div>
</td></tr>
<tr><td style="padding:24px">
  <p style="margin:0 0 16px;font-size:15px;line-height:1.55">${escapeHtml(intro)}</p>
  ${body}
  <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#5b655f">${escapeHtml(footerNote)}</p>
</td></tr>
<tr><td style="padding:16px 24px;background:#f8f9f5;border-top:1px solid #e7eae2;font-size:11px;line-height:1.5;color:#6b756f">
  Automated environmental intelligence notification. It is not an official regulatory determination.
  Sources and timestamps are shown in the application. Map data © OpenStreetMap contributors. Weather by Open-Meteo.
</td></tr>
</table></td></tr></table></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function detailRows(rows: Array<[string, string | null | undefined]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;font-size:13px">${rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:7px 0;border-bottom:1px solid #edf0e8;color:#68726c;width:42%">${escapeHtml(k)}</td><td style="padding:7px 0;border-bottom:1px solid #edf0e8;font-weight:600">${escapeHtml(String(v))}</td></tr>`,
    )
    .join('')}</table>`;
}

function publicBody(alert: AlertForEmail): string {
  const timeframe =
    alert.trigger_type === 'PREDICTIVE'
      ? `Expected window: next ${alert.forecast_horizon_hours ?? 3} hours (analytical forecast, not a confirmed event).`
      : 'This notice describes observed or reported conditions. Official verification may still be required.';
  return `${detailRows([
    ['Locality', alert.locality_name ?? 'Mumbai'],
    ['Category', CATEGORY_LABEL[alert.category] ?? alert.category],
    ['Alert level', alert.level.replace(/_/g, ' ')],
    ['Detected', new Date(alert.triggered_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ['Evidence', alert.summary],
    ['Timeframe', timeframe],
  ])}
  <div style="background:#f6f8f0;border-left:3px solid #b5e36b;padding:12px 14px;font-size:13px;line-height:1.55">
    <strong>Precautionary measures</strong><br>
    Reduce prolonged outdoor exertion if you are sensitive to air pollution. Keep windows closed during visible smoke or dust.
    Avoid contact with discoloured or foul-smelling water. Do not burn waste. Report new evidence through the platform.
  </div>`;
}

function authorityBody(alert: AlertForEmail): string {
  return `${detailRows([
    ['Reference', alert.public_ref],
    ['Category', CATEGORY_LABEL[alert.category] ?? alert.category],
    ['Trigger', alert.trigger_type],
    ['Level', alert.level.replace(/_/g, ' ')],
    ['Station', alert.station_name],
    ['Locality', alert.locality_name],
    ['Detected', new Date(alert.triggered_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ['Model', alert.model_name ? `${alert.model_name} ${alert.model_version ?? ''}` : 'Not applicable'],
    ['Horizon', alert.forecast_horizon_hours ? `${alert.forecast_horizon_hours} hours` : 'Observed condition'],
  ])}
  <p style="font-size:13px;line-height:1.55"><strong>Evidence summary.</strong> ${escapeHtml(alert.summary)}</p>
  <div style="background:#fff8ec;border-left:3px solid #e88a43;padding:12px 14px;font-size:13px;line-height:1.55">
    <strong>Recommended next steps</strong><br>
    Review the linked evidence and timestamps, confirm data quality, check nearby stations and reports, and record an inspection or repeat-sampling decision.
    A predictive warning is not a confirmed regulatory violation. Only an authorised officer may record an official determination.
  </div>`;
}

export function renderAlertEmail(
  alert: AlertForEmail,
  audience: 'PUBLIC' | 'AUTHORITY',
  template: string,
): { subject: string; html: string } {
  const category = CATEGORY_LABEL[alert.category] ?? alert.category;
  const locality = alert.locality_name ?? 'Mumbai';
  if (template === 'PUBLIC_RECOVERY' || template === 'AUTHORITY_RECOVERY') {
    const subject = `Recovery notice · ${category} · ${locality}`;
    return {
      subject,
      html: shell(
        'Conditions improving',
        `The ${category.toLowerCase()} alert for ${locality} has moved to recovery. Continue to follow official guidance.`,
        detailRows([
          ['Reference', alert.public_ref],
          ['Locality', locality],
          ['Category', category],
          ['Status', 'RECOVERY'],
          ['Updated', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
        ]),
        'Recovery indicates that configured criteria are no longer met. It does not erase the historical event or any investigation.',
      ),
    };
  }
  if (audience === 'AUTHORITY') {
    const subject = `${alert.level === 'CRITICAL' ? 'Critical' : 'Authority'} ${alert.trigger_type === 'PREDICTIVE' ? 'predictive warning' : 'alert'} · ${category} · ${locality}`;
    return {
      subject,
      html: shell(
        alert.trigger_type === 'PREDICTIVE' ? 'Predictive environmental warning' : 'Environmental alert requiring review',
        `A ${alert.level.replace(/_/g, ' ').toLowerCase()} condition is recorded for ${locality}. Review the evidence before taking action.`,
        authorityBody(alert),
        'Authority notification. Generated from application records. A predictive warning is not a confirmed regulatory violation.',
      ),
    };
  }
  const isCritical = alert.level === 'CRITICAL';
  const subject = isCritical
    ? `Critical ${category.toLowerCase()} alert · ${locality}`
    : `Environmental early warning · ${category} · ${locality}`;
  return {
    subject,
    html: shell(
      isCritical ? 'Critical environmental alert' : 'Environmental early warning',
      `${category} conditions in ${locality} have reached a ${alert.level.replace(/_/g, ' ').toLowerCase()} level.`,
      publicBody(alert),
      alert.is_simulated
        ? 'SIMULATION DATA: this notification was generated from a demonstration scenario and was not sent to a real mailing list.'
        : 'This is an automated alert, not an official regulatory determination.',
    ),
  };
}

export interface ReportUpdateForEmail {
  id: string;
  public_ref: string;
  category: string;
  incident_type: string;
  status: string;
  verification_state: string;
  locality_name: string | null;
  is_simulated: boolean;
}

const REPORT_STATUS_COPY: Record<string, string> = {
  AWAITING_VERIFICATION: 'An authorised officer is now reviewing your report.',
  VERIFIED: 'An authorised officer verified your report.',
  UNVERIFIED: 'An authorised officer reviewed your report and could not verify it.',
  LINKED_TO_INVESTIGATION: 'Your verified report is now part of an official investigation.',
};

export function renderReportStatusEmail(
  report: ReportUpdateForEmail,
  update: { status: string; reason: string },
): { subject: string; html: string } {
  const category = CATEGORY_LABEL[report.category] ?? report.category;
  const subject = `Report ${update.status.replace(/_/g, ' ').toLowerCase()} · ${report.public_ref}`;
  const outcome = REPORT_STATUS_COPY[update.status] ?? `Your report moved to ${update.status.replace(/_/g, ' ')}.`;
  return {
    subject,
    html: shell(
      'Authority response to your report',
      outcome,
      `${detailRows([
        ['Reference', report.public_ref],
        ['Reported', `${report.incident_type.replace(/_/g, ' ')} — ${category.toLowerCase()}`],
        ['Locality', report.locality_name ?? 'Mumbai'],
        ['Current status', update.status.replace(/_/g, ' ')],
        ['Verification', report.verification_state.replace(/_/g, ' ')],
        ['Updated', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
      ])}
      <p style="font-size:13px;line-height:1.55"><strong>Officer note.</strong> ${escapeHtml(update.reason)}</p>
      <div style="background:#f6f8f0;border-left:3px solid #b5e36b;padding:12px 14px;font-size:13px;line-height:1.55">
        Sign in and open <strong>My reports</strong> to read the full verification trail. You can add further evidence to the
        same reference if conditions change.
      </div>`,
      report.is_simulated
        ? 'SIMULATION DATA: this notification came from a demonstration record and was not sent to a real mailing list.'
        : 'A report is only an official violation once an authorised officer verifies it.',
    ),
  };
}

function isGmailTransport(): boolean {
  return env.EMAIL_PROVIDER === 'gmail' || env.SMTP_HOST.toLowerCase().endsWith('gmail.com');
}

export function resolvedFromAddress(): string {
  const configured = env.EMAIL_FROM.trim();
  if (env.SMTP_USER && (!configured || configured.includes('enviropulse.local'))) {
    return `प्रकृति Alerts <${env.SMTP_USER}>`;
  }
  return configured;
}

function createTransport() {
  if (isGmailTransport()) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    });
  }
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
}

export function renderTestEmail(name: string): { subject: string; html: string } {
  const provider = isGmailTransport() ? 'Gmail' : 'SMTP';
  return {
    subject: 'प्रकृति email delivery test',
    html: shell(
      'Email delivery test',
      `Hello ${name}, this message confirms that ${provider} delivery is working for this account.`,
      detailRows([
        ['Provider', provider],
        ['Recipient account', name],
        ['Sent', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
        ['Trigger', 'Manual test from notification settings'],
      ]),
      'If you did not request this test, you can ignore it. Critical environmental alerts will use the same channel.',
    ),
  };
}

export async function deliverEmail(params: {
  notificationId: string;
  to: string;
  subject: string;
  html: string;
  isSimulated: boolean;
}): Promise<{ status: 'SIMULATED' | 'SENT' | 'FAILED'; recipient?: string; messageId?: string; error?: string; event: string }> {
  if (params.isSimulated) {
    return { status: 'SIMULATED', event: 'Simulation record: no email was sent.' };
  }
  if (!emailConfigured) {
    return { status: 'SIMULATED', event: 'Email provider NOT_CONFIGURED. Notification stored for review; no email sent.' };
  }
  let recipient = params.to;
  if (env.DEMO_MODE) {
    if (!env.DEMO_EMAIL_RECIPIENT) {
      return {
        status: 'SIMULATED',
        event: 'DEMO_MODE is on but DEMO_EMAIL_RECIPIENT is empty. No email sent.',
      };
    }
    recipient = env.DEMO_EMAIL_RECIPIENT;
  } else if (/(\.local|@example\.(com|org))$/i.test(recipient)) {
    return { status: 'SIMULATED', recipient, event: 'Placeholder address; notification stored, no email sent.' };
  }
  try {
    const transporter = createTransport();
    const info = await transporter.sendMail({
      from: resolvedFromAddress(),
      to: recipient,
      subject: env.DEMO_MODE ? `[DEMO] ${params.subject}` : params.subject,
      html: params.html,
    });
    return {
      status: 'SENT',
      recipient,
      messageId: info.messageId,
      event: `${isGmailTransport() ? 'Gmail' : 'SMTP'} accepted message for ${recipient}. Delivery is not confirmed until a provider webhook marks it DELIVERED.`,
    };
  } catch (error) {
    return {
      status: 'FAILED',
      recipient,
      error: error instanceof Error ? error.message : 'Unknown email error',
      event: 'Email delivery failed.',
    };
  }
}

export async function recordNotificationEvent(notificationId: string, event: string, detail?: unknown) {
  await query(`INSERT INTO notification_events (notification_id, event, detail) VALUES ($1,$2,$3::jsonb)`, [
    notificationId,
    event,
    detail ? JSON.stringify(detail) : null,
  ]);
}

export async function markNotificationStatus(
  notificationId: string,
  status: 'SIMULATED' | 'SENT' | 'DELIVERED' | 'FAILED',
  extra: { providerMessageId?: string; error?: string } = {},
) {
  await query(
    `UPDATE notifications SET status=$2, sent_at = CASE WHEN $2 IN ('SENT','DELIVERED') THEN COALESCE(sent_at, now()) ELSE sent_at END,
       delivered_at = CASE WHEN $2='DELIVERED' THEN now() ELSE delivered_at END,
       provider_message_id = COALESCE($3, provider_message_id), error = COALESCE($4, error)
     WHERE id=$1`,
    [notificationId, status, extra.providerMessageId ?? null, extra.error ?? null],
  );
}

export async function getAlertForEmail(alertId: string): Promise<AlertForEmail | null> {
  return one<AlertForEmail>(
    `SELECT a.id, a.public_ref, a.category, a.level, a.state, a.trigger_type, a.title, a.summary,
            l.name AS locality_name, s.name AS station_name, a.triggered_at, a.evidence,
            a.is_simulated, a.forecast_horizon_hours,
            m.name AS model_name, m.version AS model_version
     FROM environmental_alerts a
     LEFT JOIN localities l ON l.id = a.locality_id
     LEFT JOIN monitoring_stations s ON s.id = a.station_id
     LEFT JOIN model_registry m ON m.id = a.model_id
     WHERE a.id = $1`,
    [alertId],
  );
}

export interface IncidentForEmail {
  id: string;
  public_ref: string;
  title: string;
  category: string;
  status: string;
  risk_level: string;
  locality_name: string | null;
  assigned_to_name: string | null;
  is_simulated: boolean;
}

export function renderIncidentUpdateEmail(
  incident: IncidentForEmail,
  update: string,
): { subject: string; html: string } {
  const category = CATEGORY_LABEL[incident.category] ?? incident.category;
  const subject = `Incident update · ${incident.public_ref} · ${incident.status.replace(/_/g, ' ')}`;
  return {
    subject,
    html: shell(
      'Incident update',
      `An environmental incident assigned to your authority workflow has been updated.`,
      `${detailRows([
        ['Reference', incident.public_ref],
        ['Title', incident.title],
        ['Category', category],
        ['Status', incident.status.replace(/_/g, ' ')],
        ['Risk', incident.risk_level],
        ['Locality', incident.locality_name ?? 'Mumbai'],
        ['Assigned to', incident.assigned_to_name ?? 'Unassigned'],
        ['Updated', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
      ])}
      <p style="font-size:13px;line-height:1.55"><strong>Update.</strong> ${escapeHtml(update)}</p>
      <div style="background:#fff8ec;border-left:3px solid #e88a43;padding:12px 14px;font-size:13px;line-height:1.55">
        Review the evidence and audit trail in the incident workspace. Only an authorised officer may record an official determination.
      </div>`,
      incident.is_simulated
        ? 'SIMULATION DATA: this incident update was generated from a demonstration scenario and was not sent to a real mailing list.'
        : 'Authority incident update. Not an official determination.',
    ),
  };
}
