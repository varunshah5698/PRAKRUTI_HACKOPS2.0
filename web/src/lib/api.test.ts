import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('api request', () => {
  it('returns parsed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true })));
    await expect(api.get<{ ok: boolean }>('/test')).resolves.toEqual({ ok: true });
  });

  it('throws ApiError with the server message on a 500 when retries are disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const error = await api.get('/test', { retries: 0 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, message: 'boom' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api.delete('/test')).resolves.toBeUndefined();
  });

  it('retries a GET after a transient 503', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: 'UNAVAILABLE', message: 'restarting' } }, 503))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = api.get<{ ok: boolean }>('/test');
    await vi.advanceTimersByTimeAsync(600);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a POST, so a report is never submitted twice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: { code: 'UNAVAILABLE', message: 'restarting' } }, 503));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.post('/reports', {})).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails after the GET retry budget when the API is unreachable', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = api.get('/test').catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(5_100);
    const error = await pending;

    expect(error).toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
