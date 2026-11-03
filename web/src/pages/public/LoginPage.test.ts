import { describe, expect, it } from 'vitest';
import { isValidEmail } from './login-validation';

describe('login email validation', () => {
  it('accepts ordinary and tagged addresses', () => {
    expect(isValidEmail('operator@enviropulse.local')).toBe(true);
    expect(isValidEmail(' analyst+field@example.co.in ')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('operator')).toBe(false);
    expect(isValidEmail('operator@enviropulse')).toBe(false);
    expect(isValidEmail('operator @enviropulse.com')).toBe(false);
  });
});
