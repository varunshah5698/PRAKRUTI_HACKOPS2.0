import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractNarrative, fetchWithRetry, isSmallTalk, parseModelJson, rankStationSnapshots, systemPrompt } from './analyst.js';

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

describe('station ranking', () => {
  it('ranks by full AQI, uses fresh pollutants and skips stale or non-air stations', () => {
    const now = Date.now();
    const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
    const ranked = rankStationSnapshots([
      {
        name: 'Chembur',
        code: 'B',
        stationType: 'AIR_CAAQMS',
        isSimulated: false,
        values: {
          pm25: { value: 78, value24h: 70, observedAt: ago(180), sourceId: 'openaq' },
          no2: { value: 100, value24h: 90, observedAt: ago(200), sourceId: 'openaq' },
        },
      },
      {
        name: 'Colaba',
        code: 'A',
        stationType: 'AIR_CAAQMS',
        isSimulated: true,
        values: { pm25: { value: 22, value24h: 20, observedAt: ago(10), sourceId: 'demo-network' } },
      },
      {
        name: 'Stale station',
        code: 'C',
        stationType: 'AIR_CAAQMS',
        isSimulated: false,
        values: { pm25: { value: 300, value24h: 280, observedAt: ago(7 * 60), sourceId: 'openaq' } },
      },
      {
        name: 'Water station',
        code: 'D',
        stationType: 'WATER_SAMPLING',
        isSimulated: true,
        values: { ph: { value: 7, value24h: 7, observedAt: ago(5), sourceId: 'demo-network' } },
      },
    ]);

    expect(ranked.map((row) => row.name)).toEqual(['Colaba', 'Chembur']);
    expect(ranked[0]).toMatchObject({ aqi: 37, category: 'Good', dominantPollutant: 'pm25', pm25: 22, isSimulated: true });
    expect(ranked[0].aqi24h).toBe(33);
    expect(ranked[1]).toMatchObject({ aqi: 160, category: 'Moderate', dominantPollutant: 'pm25', pm25: 78 });
    expect(ranked[1].aqi24h).toBe(133);
    expect(ranked[1].ageMinutes).toBe(180);
    expect(ranked[1].sources).toEqual(['openaq']);
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

describe('model JSON parsing', () => {
  it('parses double-encoded JSON', () => {
    const inner = { narrative: 'Grounded answer', observed: ['PM2.5 52 µg/m³'] };
    const parsed = parseModelJson(JSON.stringify(JSON.stringify(inner)));
    expect(parsed).toEqual(inner);
  });

  it('repairs pretty-printed JSON with raw newlines inside strings', () => {
    const text = '{\n  "narrative": "line one\nline two",\n  "observed": ["x"]\n}';
    const parsed = parseModelJson(text);
    expect(parsed?.narrative).toContain('line one');
    expect(parsed?.observed).toEqual(['x']);
  });

  it('recovers the narrative even when the rest of the JSON is broken', () => {
    expect(extractNarrative('{"narrative":"hello\\nworld","observed": [broken')).toBe('hello\nworld');
  });
});

describe('evidence grounding rules', () => {
  it('keeps news and citizen reports labelled as reported', () => {
    const prompt = systemPrompt();
    expect(prompt).toContain('focusedReport');
    expect(prompt).toContain('reportSummary');
    expect(prompt).toContain('News items are external RSS');
    expect(prompt).toContain('REPORTED and UNVERIFIED');
    expect(prompt).toContain('Never declare an official regulatory violation');
  });

  it('describes the website and the analytical method', () => {
    const prompt = systemPrompt();
    expect(prompt).toContain('PRAKRITI WEBSITE GUIDE');
    expect(prompt).toContain('/map');
    expect(prompt).toContain('/compliance');
    expect(prompt).toContain('ANALYTICAL METHOD');
    expect(prompt).toContain('You cannot click');
    expect(prompt).toContain('nextActions must be concrete');
  });
});
