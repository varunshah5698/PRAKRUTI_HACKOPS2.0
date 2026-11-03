import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, isSmallTalk } from './analyst.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider retry', () => {
  it('retries a 5xx and returns the later successful response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetry('https://river.test/chat', { method: 'POST' });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails immediately on a non-retryable 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithRetry('https://river.test/chat', { method: 'POST' })).rejects.toThrow('River AI HTTP 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('conversational small talk', () => {
  it('recognises greetings and pleasantries', () => {
    for (const question of ['hi', 'Hello!', 'hey there', 'hi, how are you?', 'Namaste ji', 'good morning', 'thanks', 'thank you so much', 'bye', 'see you']) {
      expect(isSmallTalk(question)).toBe(true);
    }
  });

  it('leaves real questions to the evidence analyst', () => {
    for (const question of [
      'hi, what is the PM2.5 level at Bandra?',
      'Hello, show me the forecast',
      'Which areas show rising PM2.5?',
      'What should an authority investigate next?',
    ]) {
      expect(isSmallTalk(question)).toBe(false);
    }
  });
});
