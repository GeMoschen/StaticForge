/**
 * An `input()` transform for optional numeric attributes (`maxlength="80"`, `[min]="0"`): a number, or `null` when the
 * attribute is absent, empty or not a number — so the native attribute is left off instead of becoming `NaN`.
 */
export function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
