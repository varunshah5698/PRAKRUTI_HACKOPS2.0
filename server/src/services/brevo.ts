import { env } from '../config/env.js';

export interface MailSender {
  email: string;
  name: string;
  formatted: string;
}

export interface BrevoSendResult {
  ok: boolean;
  httpStatus: number | null;
  messageId: string | null;
  error?: string;
  event: string;
  retryable: boolean;
  ambiguous: boolean;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseSender(value: string, nameOverride = ''): MailSender {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.*?)\s*<([^>]+)>\s*$/);
  const email = (match?.[2] ?? trimmed).trim().toLowerCase();
  const parsedName = (match?.[1] ?? '').trim();
  const name = nameOverride.trim() || parsedName || 'प्रकृति';
  return { email, name, formatted: `${name} <${email}>` };
}

export function resolvedSender(): MailSender {
  return parseSender(env.EMAIL_FROM, env.EMAIL_FROM_NAME);
}

export function brevoConfigured(): boolean {
  return env.EMAIL_PROVIDER.toLowerCase() === 'brevo' && Boolean(env.BREVO_API_KEY && resolvedSender().email);
}

function baseUrl(): string {
  return env.BREVO_API_BASE_URL.replace(/\/+$/, '');
}

function safeError(value: unknown): string {
  const text = String(value ?? 'Unknown Brevo error').slice(0, 400);
  return env.BREVO_API_KEY ? text.replaceAll(env.BREVO_API_KEY, '[redacted]') : text;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Brevo transactional email over HTTPS. This path must never construct a
 * Nodemailer/SMTP transport. A 2xx response means Brevo accepted the message;
 * it is not proof of inbox delivery.
 */
export async function sendBrevoEmail(params: { to: string; subject: string; html: string }): Promise<BrevoSendResult> {
  const sender = resolvedSender();
  if (!brevoConfigured()) {
    return {
      ok: false,
      httpStatus: null,
      messageId: null,
      error: 'Brevo is not configured (BREVO_API_KEY or EMAIL_FROM missing).',
      event: 'Brevo NOT_CONFIGURED. No email was sent.',
      retryable: false,
      ambiguous: false,
    };
  }
  if (!isEmail(params.to)) {
    return {
      ok: false,
      httpStatus: null,
      messageId: null,
      error: 'Recipient is not a valid email address.',
      event: 'Brevo rejected an invalid recipient before sending.',
      retryable: false,
      ambiguous: false,
    };
  }
  if (!isEmail(sender.email)) {
    return {
      ok: false,
      httpStatus: null,
      messageId: null,
      error: 'EMAIL_FROM is not a valid email address.',
      event: 'Brevo sender is invalid. No email was sent.',
      retryable: false,
      ambiguous: false,
    };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/smtp/email`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: sender.email, name: sender.name },
        to: [{ email: params.to }],
        subject: params.subject,
        htmlContent: params.html,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Brevo request failed';
    console.error(`[brevo] network/timeout · ${message}`);
    return {
      ok: false,
      httpStatus: null,
      messageId: null,
      error: `Brevo network/timeout: ${message}`.slice(0, 400),
      event: 'Brevo request timed out or the network failed. Delivery is unconfirmed; automatic retry is suppressed to avoid duplicates.',
      retryable: false,
      ambiguous: true,
    };
  }

  const payload = await readJson(response);
  const messageId =
    (typeof payload?.messageId === 'string' && payload.messageId) ||
    (Array.isArray(payload?.messageIds) && typeof payload.messageIds[0] === 'string' ? payload.messageIds[0] : null);

  if (response.ok) {
    console.log(`[brevo] accepted http=${response.status} messageId=${messageId ?? 'none'}`);
    return {
      ok: true,
      httpStatus: response.status,
      messageId,
      event: `Brevo accepted the message (HTTP ${response.status}, id ${messageId ?? 'n/a'}). Delivery is not confirmed until a provider event or recipient check.`,
      retryable: false,
      ambiguous: false,
    };
  }

  const detail =
    typeof payload?.message === 'string'
      ? payload.message
      : typeof payload?.error === 'string'
        ? payload.error
        : `HTTP ${response.status}`;
  const error = `Brevo rejected the request (HTTP ${response.status}): ${safeError(detail)}`;
  console.error(`[brevo] rejected http=${response.status} messageId=${messageId ?? 'none'} error=${error}`);
  return {
    ok: false,
    httpStatus: response.status,
    messageId,
    error,
    event:
      response.status === 429
        ? 'Brevo rate limit reached (HTTP 429). The message was not accepted and is safe to retry.'
        : response.status >= 500
          ? 'Brevo returned a server error. Delivery is unconfirmed; automatic retry is suppressed to avoid duplicates.'
          : 'Brevo rejected the message. It was not accepted.',
    retryable: response.status === 429,
    ambiguous: response.status >= 500,
  };
}

export async function verifyBrevoSender(): Promise<{
  configured: boolean;
  sender: MailSender;
  verified: boolean;
  httpStatus: number | null;
  error?: string;
}> {
  const sender = resolvedSender();
  if (!brevoConfigured()) {
    return {
      configured: false,
      sender,
      verified: false,
      httpStatus: null,
      error: 'Brevo is not configured (BREVO_API_KEY or EMAIL_FROM missing).',
    };
  }
  try {
    const response = await fetch(`${baseUrl()}/senders`, {
      headers: { accept: 'application/json', 'api-key': env.BREVO_API_KEY },
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      console.error(`[brevo] sender check failed http=${response.status}`);
      return {
        configured: true,
        sender,
        verified: false,
        httpStatus: response.status,
        error: `Brevo sender check failed (HTTP ${response.status}).`,
      };
    }
    const senders = Array.isArray(payload?.senders) ? payload.senders : [];
    const match = senders.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const row = entry as { email?: unknown; active?: unknown };
      return typeof row.email === 'string' && row.email.toLowerCase() === sender.email && row.active !== false;
    });
    console.log(`[brevo] sender check http=${response.status} verified=${Boolean(match)}`);
    return {
      configured: true,
      sender,
      verified: Boolean(match),
      httpStatus: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Brevo sender check failed';
    console.error(`[brevo] sender check network/timeout · ${message}`);
    return {
      configured: true,
      sender,
      verified: false,
      httpStatus: null,
      error: `Brevo sender check network/timeout: ${message}`.slice(0, 400),
    };
  }
}
