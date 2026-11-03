import { describe, expect, it } from 'vitest';
import { countdown } from './NewsPage';

describe('newsroom countdown', () => {
  it('pads seconds and clamps late refreshes at zero', () => {
    expect(countdown(300_000)).toBe('5:00');
    expect(countdown(61_000)).toBe('1:01');
    expect(countdown(0)).toBe('0:00');
    expect(countdown(-5_000)).toBe('0:00');
  });
});
