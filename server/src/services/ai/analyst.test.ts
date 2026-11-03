import { describe, expect, it } from 'vitest';
import { isSmallTalk } from './analyst.js';

describe('conversational small talk', () => {
  it('recognises greetings and pleasantries', () => {
    for (const question of ['hi', 'Hello!', 'hey there', 'hi, how are you?', 'Namaste', 'good morning', 'thanks', 'thank you so much', 'bye', 'see you']) {
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
