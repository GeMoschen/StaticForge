import { describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { checkPassword, passwordProblems } from './password-rules.util';

type PasswordPolicyView = components['schemas']['PasswordPolicyView'];

const plain: PasswordPolicyView = { minLength: 12, requireMixed: false, maxBytes: 72 };
const mixed: PasswordPolicyView = { minLength: 8, requireMixed: true, maxBytes: 72 };
const states = (check: ReturnType<typeof checkPassword>) => check.rules.map((rule) => `${rule.id}:${rule.state}`);

describe('checkPassword', () => {
  it('stays neutral while nothing is typed, so an empty form never looks satisfied', () => {
    const check = checkPassword(mixed, '', '');
    expect(states(check)).toEqual(['length:idle', 'letter:idle', 'symbol:idle', 'match:idle']);
    expect(check.valid).toBe(false);
  });

  it('judges the length in characters, not UTF-16 units', () => {
    expect(checkPassword(plain, 'short').rules[0]).toMatchObject({ id: 'length', state: 'unmet', min: 12 });
    expect(checkPassword(plain, 'long-enough-!').rules[0].state).toBe('met');
    // Eleven emoji are eleven characters but 22 UTF-16 units.
    expect(checkPassword(plain, '😀'.repeat(11)).rules[0].state).toBe('unmet');
  });

  it('asks for a letter and a digit or symbol only when the policy requires it', () => {
    expect(checkPassword(plain, 'abcdefghijklm').rules).toHaveLength(1);
    expect(states(checkPassword(mixed, 'abcdefghij'))).toEqual(['length:met', 'letter:met', 'symbol:unmet']);
    expect(checkPassword(mixed, 'abcdefg1').valid).toBe(true);
    expect(checkPassword(mixed, '12345678').rules[1].state).toBe('unmet');
  });

  it('checks the confirmation only when there is one, idle while it is empty', () => {
    expect(checkPassword(plain, 'long-enough-!', null).rules.map((r) => r.id)).toEqual(['length']);
    expect(checkPassword(plain, 'long-enough-!', '').rules.at(-1)?.state).toBe('idle');
    expect(checkPassword(plain, 'long-enough-!', 'long-enough-?').rules.at(-1)?.state).toBe('unmet');
    expect(checkPassword(plain, 'long-enough-!', 'long-enough-!').valid).toBe(true);
  });

  it('reports the limit only once it is exceeded, in characters for plain text', () => {
    expect(checkPassword(plain, 'a'.repeat(72)).overLimit).toBeNull();
    const over = checkPassword(plain, 'a'.repeat(80));
    expect(over.overLimit).toEqual({ characters: 80, max: 72, wide: false });
    expect(over.valid).toBe(false);
  });

  it('does not pretend a plain count for wide characters', () => {
    const over = checkPassword(plain, 'ä'.repeat(40));
    expect(over.overLimit).toEqual({ characters: 40, max: 72, wide: true });
  });

  it('has nothing to check before the policy loaded', () => {
    expect(checkPassword(null, 'x')).toEqual({ rules: [], overLimit: null, valid: false });
  });

  it('counts what stands in the way', () => {
    expect(passwordProblems(checkPassword(mixed, 'abc'))).toBe(2);
    expect(passwordProblems(checkPassword(mixed, 'abcdefg1'))).toBe(0);
  });
});
