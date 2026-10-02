import type { components } from '../../core/api/generated/schema.d.ts';

type PasswordPolicyView = components['schemas']['PasswordPolicyView'];

/** `idle`: not judged yet (nothing typed); `met` / `unmet` only after the person typed. */
export type PasswordRuleState = 'idle' | 'met' | 'unmet';
export type PasswordRuleId = 'length' | 'letter' | 'symbol' | 'match';

export interface PasswordRule {
  readonly id: PasswordRuleId;
  readonly state: PasswordRuleState;
  /** The number the rule's text names (the minimum length). */
  readonly min?: number;
}

/** The password is longer than the server accepts. The limit is told in characters; `wide` when it cannot be (non-ASCII). */
export interface PasswordOverLimit {
  readonly characters: number;
  readonly max: number;
  /** Characters outside the basic alphabet count more than one toward the server's limit: a plain count would mislead. */
  readonly wide: boolean;
}

export interface PasswordCheck {
  readonly rules: readonly PasswordRule[];
  /** Set only while the password is over the limit. */
  readonly overLimit: PasswordOverLimit | null;
  /** Every rule is met and the password is within the limit (and there is something to check). */
  readonly valid: boolean;
}

const NOTHING: PasswordCheck = { rules: [], overLimit: null, valid: false };

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/**
 * The live checks under a new-password field, mirroring the server's `PasswordPolicy` in plain language: the length in
 * characters, a letter and a digit or symbol (when the policy requires it) and — with a confirmation field — that both
 * match. A rule is `idle` while its field is empty, so an empty form never looks "satisfied". The server's ceiling
 * (BCrypt's 72 bytes) is only reported once exceeded, in characters where that is accurate. The server stays the
 * judge; this only tells the user before they submit. Pure.
 */
export function checkPassword(policy: PasswordPolicyView | null, password: string, confirm: string | null = null): PasswordCheck {
  if (!policy) {
    return NOTHING;
  }
  const typed = password.length > 0;
  const judge = (ok: boolean): PasswordRuleState => (!typed ? 'idle' : ok ? 'met' : 'unmet');
  const min = Math.max(1, policy.minLength ?? 1);
  const characters = [...password].length;
  const rules: PasswordRule[] = [{ id: 'length', state: judge(characters >= min), min }];
  if (policy.requireMixed) {
    rules.push({ id: 'letter', state: judge(/\p{L}/u.test(password)) });
    rules.push({ id: 'symbol', state: judge(/[^\p{L}\s]/u.test(password)) });
  }
  if (confirm !== null) {
    rules.push({ id: 'match', state: confirm.length === 0 ? 'idle' : typed && confirm === password ? 'met' : 'unmet' });
  }
  const bytes = utf8Length(password);
  const max = policy.maxBytes ?? 0;
  const overLimit: PasswordOverLimit | null = max > 0 && bytes > max ? { characters, max, wide: bytes !== characters } : null;
  return { rules, overLimit, valid: typed && overLimit === null && rules.every((rule) => rule.state === 'met') };
}

/** How many things stand in the way (rules not met yet, plus the limit). */
export function passwordProblems(check: PasswordCheck): number {
  return check.rules.filter((rule) => rule.state !== 'met').length + (check.overLimit === null ? 0 : 1);
}
