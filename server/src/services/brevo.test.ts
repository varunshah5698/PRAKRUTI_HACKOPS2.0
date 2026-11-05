import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('EMAIL_PROVIDER', 'brevo');
  vi.stubEnv('BREVO_API_KEY', 'test-brevo-key');
  vi.stubEnv('BREVO_API_BASE_URL', 'https://api.brevo.com/v3');
  vi.stubEnv('EMAIL_FROM', 'Prakriti Alerts <alerts@example.com>');
  vi.stubEnv('EMAIL_FROM_NAME', 'Prakriti');
  vi.stubEnv('DEMO_MODE', 'false');
  vi.restoreAllMocks();
});

async function loadBrevo() {
  return import('./brevo.js');
}

describe('Brevo HTTPS transactional email', () => {
  it('parses the configured sender and name without exposing secrets', async () => {
    const { parseSender, resolvedSender } = await loadBrevo();
    expect(parseSender('Alerts <alerts@example.com>', '')).toEqual({
      email: 'alerts@example.com',
      name: 'Alerts',
      formatted: 'Alerts <alerts@example.com>',
    });
    expect(resolvedSender()).toEqual({
      email: 'alerts@example.com',
      name: 'Prakriti',
      formatted: 'Prakriti <alerts@example.com>',
    });
  });

  it('posts to the Brevo HTTPS endpoint and returns acceptance plus message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'brevo-message-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { sendBrevoEmail } = await loadBrevo();
    const result = await sendBrevoEmail({
      to: 'citizen@example.org',
      subject: 'Test',
      html: '<p>Hello</p>',
    });
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(201);
    expect(result.messageId).toBe('brevo-message-1');
    expect(result.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['api-key']).toBe('test-brevo-key');
    const body = JSON.parse(String(init.body));
    expect(body.sender).toEqual({ email: 'alerts@example.com', name: 'Prakriti' });
    expect(body.to).toEqual([{ email: 'citizen@example.org' }]);
    expect(body.subject).toBe('Test');
    expect(body.htmlContent).toBe('<p>Hello</p>');
  });

  it('does not retry a hard 4xx rejection and does not leak the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { sendBrevoEmail } = await loadBrevo();
    const result = await sendBrevoEmail({ to: 'citizen@example.org', subject: 'Test', html: '<p>x</p>' });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(401);
    expect(result.retryable).toBe(false);
    expect(result.error).not.toContain('test-brevo-key');
  });

  it('retries rate limits but suppresses retries after ambiguous 5xx/network outcomes', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'rate limit' }), { status: 429 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'server error' }), { status: 503 }))
        .mockRejectedValueOnce(new Error('timed out')),
    );
    const { sendBrevoEmail } = await loadBrevo();
    const rate = await sendBrevoEmail({ to: 'citizen@example.org', subject: 'Test', html: '<p>x</p>' });
    const server = await sendBrevoEmail({ to: 'citizen@example.org', subject: 'Test', html: '<p>x</p>' });
    const network = await sendBrevoEmail({ to: 'citizen@example.org', subject: 'Test', html: '<p>x</p>' });
    expect(rate.retryable).toBe(true);
    expect(server.retryable).toBe(false);
    expect(server.ambiguous).toBe(true);
    expect(network.retryable).toBe(false);
    expect(network.ambiguous).toBe(true);
  });

  it('verifies the configured sender against the Brevo verified sender list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          senders: [
            { email: 'other@example.com', active: true },
            { email: 'alerts@example.com', active: true },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { verifyBrevoSender } = await loadBrevo();
    const result = await verifyBrevoSender();
    expect(result.verified).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.sender.email).toBe('alerts@example.com');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.brevo.com/v3/senders');
  });

  it('uses Brevo in deliverEmail and never constructs an SMTP transport', async () => {
    const createTransport = vi.fn();
    vi.doMock('nodemailer', () => ({ default: { createTransport } }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: 'm-2' }), { status: 201 })),
    );
    const { deliverEmail } = await import('./email.js');
    const result = await deliverEmail({
      notificationId: '00000000-0000-0000-0000-000000000000',
      to: 'citizen@testmail.dev',
      subject: 'Test',
      html: '<p>x</p>',
      isSimulated: false,
    });
    expect(result.status).toBe('SENT');
    expect(result.httpStatus).toBe(201);
    expect(result.messageId).toBe('m-2');
    expect(createTransport).not.toHaveBeenCalled();
  });
});
