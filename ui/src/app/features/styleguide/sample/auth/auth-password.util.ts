/** The sample's password policy (the real one comes from the server): at least 12 characters, at most 72 characters. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 72;

/** `idle`: not judged yet (nothing typed); `met` / `unmet` only after the person typed. */
export type PasswordRuleState = 'idle' | 'met' | 'unmet';
export type PasswordRuleId = 'length' | 'letter' | 'symbol' | 'match';

export interface PasswordRule {
  readonly id: PasswordRuleId;
  readonly state: PasswordRuleState;
}

export interface PasswordCheck {
  readonly rules: readonly PasswordRule[];
  /** How many characters the password has when that is over the limit; `null` while it is within it. */
  readonly overLimit: number | null;
  /** Every rule is met and the password is within the limit. */
  readonly valid: boolean;
}

const characters = (text: string): number => [...text].length;

/**
 * The live checks under a new-password field, in plain language: length, a letter, a digit or symbol, and — when
 * there is a confirmation field — that both match. A rule is `idle` (neither met nor unmet) while its field is
 * empty, so an empty form does not look "satisfied". The limit counts characters (never bytes) and is reported
 * only when it is exceeded. Pure.
 */
export function checkPassword(password: string, confirm: string | null = null): PasswordCheck {
  const typed = password.length > 0;
  const judge = (ok: boolean): PasswordRuleState => (!typed ? 'idle' : ok ? 'met' : 'unmet');
  const rules: PasswordRule[] = [
    { id: 'length', state: judge(characters(password) >= PASSWORD_MIN) },
    { id: 'letter', state: judge(/\p{L}/u.test(password)) },
    { id: 'symbol', state: judge(/[^\p{L}\s]/u.test(password)) },
  ];
  if (confirm !== null) {
    rules.push({ id: 'match', state: confirm.length === 0 ? 'idle' : confirm === password && typed ? 'met' : 'unmet' });
  }
  const length = characters(password);
  return {
    rules,
    overLimit: length > PASSWORD_MAX ? length : null,
    valid: typed && rules.every((rule) => rule.state === 'met') && length <= PASSWORD_MAX,
  };
}

/** How many things stand in the way (unmet or not yet met rules, plus the limit). */
export function passwordProblems(check: PasswordCheck): number {
  return check.rules.filter((rule) => rule.state !== 'met').length + (check.overLimit === null ? 0 : 1);
}
