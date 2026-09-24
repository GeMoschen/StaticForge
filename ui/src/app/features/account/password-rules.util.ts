import type { components } from '../../core/api/generated/schema.d.ts';

type PasswordPolicyView = components['schemas']['PasswordPolicyView'];

export interface PasswordRuleCheck {
  label: string;
  met: boolean;
}

/**
 * The live checks shown under a new-password field, mirroring the server's `PasswordPolicy`: a minimum length in
 * characters (code points), the BCrypt ceiling in UTF-8 bytes, and — when the policy requires it — a letter and a
 * digit or symbol. The server stays the judge; these only tell the user before they submit.
 */
export function passwordRuleChecks(policy: PasswordPolicyView | null, password: string): PasswordRuleCheck[] {
  if (!policy) {
    return [];
  }
  const minLength = Math.max(1, policy.minLength ?? 1);
  const checks: PasswordRuleCheck[] = [
    { label: `At least ${minLength} characters`, met: [...password].length >= minLength },
  ];
  if (policy.maxBytes) {
    checks.push({
      label: `At most ${policy.maxBytes} bytes (characters outside ASCII take 2–4)`,
      met: new TextEncoder().encode(password).length <= policy.maxBytes,
    });
  }
  if (policy.requireMixed) {
    checks.push({ label: 'At least one letter', met: /\p{L}/u.test(password) });
    checks.push({ label: 'At least one digit or symbol', met: /[^\p{L}\s]/u.test(password) });
  }
  return checks;
}

/** `true` when every check passes (and there is something to check). */
export function meetsPolicy(checks: PasswordRuleCheck[]): boolean {
  return checks.length > 0 && checks.every((c) => c.met);
}
