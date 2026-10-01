/** A heading level below the page's `h1` (M35.6). */
export type SfHeadingLevel = 2 | 3 | 4 | 5 | 6;

/** Input transform for a heading `level`: accepts numbers and strings (`level="3"`), clamped to 2–6, default 2. */
export function headingLevelAttribute(value: unknown): SfHeadingLevel {
  const level = Math.round(Number(value));
  if (!Number.isFinite(level)) {
    return 2;
  }
  return Math.min(6, Math.max(2, level)) as SfHeadingLevel;
}
