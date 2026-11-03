import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let api: (typeof import('./api'))['api'];

beforeEach(async () => {
  vi.resetModules();
  ({ api } = await import('./api'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function proxyError() {
  return new Response('', { status: 500, headers: { 'Content-Type': 'text/plain' } });
}

describe('api request retry', () => {
  it('fails fast when the API was never reachable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(proxyError());
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/test')).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a GET through a restart after recent success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ ready: true }))
      .mockResolvedValueOnce(proxyError())
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/warm');
    await expect(api.get<{ ok: boolean }>('/test')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives a network failure one short retry, then fails fast', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/test')).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a JSON 500 from the API itself', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, 500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/test')).rejects.toMatchObject({ status: 500, message: 'boom' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a POST because it may have side effects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(proxyError());
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.post('/test', {})).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
