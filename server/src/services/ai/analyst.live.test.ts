import { describe, expect, it } from 'vitest';
import { answerQuestion } from './analyst.js';

// Opt-in: this test costs a real provider request and needs the local database.
const runLive = process.env.RUN_LIVE_AI === '1';

describe.skipIf(!runLive)('live River AI analyst', () => {
  it(
    'answers a website question with a grounded narrative',
    async () => {
      const answer = await answerQuestion({ question: 'What can this website do?', category: 'air' });
      expect(answer.status).toBe('COMPLETED');
      expect(answer.provider).toBe('RIVER_AI');
      expect(answer.narrative.length).toBeGreaterThan(80);
    },
    90_000,
  );
});
