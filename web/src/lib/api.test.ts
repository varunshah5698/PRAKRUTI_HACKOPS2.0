import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function proxyError() {
  return new Response('', { status: 500, headers: { 'Content-Type': 'text/plain' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api request retry', () => {
  it('retries a GET through a dev-proxy restart', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(proxyError()).mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get<{ ok: boolean }>('/test')).resolves.toEqual({ ok: true });
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
