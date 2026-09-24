import { describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { meetsPolicy, passwordRuleChecks } from './password-rules.util';

type PasswordPolicyView = components['schemas']['PasswordPolicyView'];

const plain: PasswordPolicyView = { minLength: 12, requireMixed: false, maxBytes: 72 };
const mixed: PasswordPolicyView = { minLength: 8, requireMixed: true, maxBytes: 72 };

describe('passwordRuleChecks', () => {
  it('checks the length in characters, not UTF-16 units', () => {
    expect(passwordRuleChecks(plain, 'short')[0]).toEqual({ label: 'At least 12 characters', met: false });
    expect(passwordRuleChecks(plain, 'long-enough-!')[0].met).toBe(true);
    // Eleven emoji are eleven characters but 22 UTF-16 units.
    expect(passwordRuleChecks(plain, '😀'.repeat(11))[0].met).toBe(false);
  });

  it('flags a password past the byte ceiling', () => {
    const checks = passwordRuleChecks(plain, 'ä'.repeat(40));
    expect(checks[1].met).toBe(false);
    expect(meetsPolicy(checks)).toBe(false);
  });

  it('asks for a letter and a digit or symbol only when the policy requires it', () => {
    expect(passwordRuleChecks(plain, 'abcdefghijklm')).toHaveLength(2);
    const lettersOnly = passwordRuleChecks(mixed, 'abcdefghij');
    expect(lettersOnly.map((c) => c.met)).toEqual([true, true, true, false]);
    expect(meetsPolicy(passwordRuleChecks(mixed, 'abcdefg1'))).toBe(true);
    expect(passwordRuleChecks(mixed, '12345678')[2].met).toBe(false);
  });

  it('has nothing to check before the policy loaded', () => {
    expect(passwordRuleChecks(null, 'x')).toEqual([]);
    expect(meetsPolicy([])).toBe(false);
  });
});
