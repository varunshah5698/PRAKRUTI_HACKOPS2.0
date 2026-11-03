import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('api request', () => {
  it('returns parsed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true })));
    await expect(api.get<{ ok: boolean }>('/test')).resolves.toEqual({ ok: true });
  });

  it('throws ApiError with the server message on a 500', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const error = await api.get('/test').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, message: 'boom' });
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api.delete('/test')).resolves.toBeUndefined();
  });

  it('fails immediately when the API is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/test')).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
