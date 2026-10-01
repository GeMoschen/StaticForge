/**
 * WCAG 2.x contrast maths for the style guide (M35.9): the same relative-luminance formula as the token contrast matrix
 * (`design/tokens.contrast.spec.ts`), applied to colours read from the computed styles of the current theme.
 */

/** Red, green, blue (0–255) and alpha (0–1). */
export type Rgba = readonly [r: number, g: number, b: number, a: number];

/** WCAG 1.4.3: normal text. */
export const TEXT_CONTRAST = 4.5;
/** WCAG 1.4.11: UI boundaries, icons and fills. */
export const UI_CONTRAST = 3;

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*([^)]*)\)$/i;

/**
 * Parses a colour as browsers serialise it (`rgb(r, g, b)`, `rgba(r, g, b, a)`, the space syntax with `/ alpha`) or as
 * written in the tokens (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`). Anything else (`transparent`, a `var()` that did not
 * resolve, an empty string) gives `null`.
 */
export function parseColor(value: string | null | undefined): Rgba | null {
  const text = (value ?? '').trim();
  const hex = HEX.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) {
      digits = [...digits].map((d) => d + d).join('');
    }
    const channel = (i: number) => parseInt(digits.slice(i * 2, i * 2 + 2), 16);
    return [channel(0), channel(1), channel(2), digits.length === 8 ? round(channel(3) / 255, 3) : 1];
  }
  const rgb = RGB.exec(text);
  if (!rgb) {
    return null;
  }
  const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) {
    return null;
  }
  const channels = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
  const alphaText = parts[3];
  const alpha = alphaText === undefined ? 1 : alphaText.endsWith('%') ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
  if ([...channels, alpha].some((n) => !Number.isFinite(n))) {
    return null;
  }
  return [clamp(channels[0], 255), clamp(channels[1], 255), clamp(channels[2], 255), clamp(alpha, 1)];
}

/** A translucent colour laid over an opaque background (the background's own alpha is ignored). */
export function composite(foreground: Rgba, background: Rgba): Rgba {
  const a = foreground[3];
  if (a >= 1) {
    return foreground;
  }
  const mix = (i: 0 | 1 | 2) => foreground[i] * a + background[i] * (1 - a);
  return [mix(0), mix(1), mix(2), 1];
}

function srgbChannel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: Rgba): number {
  return 0.2126 * srgbChannel(color[0]) + 0.7152 * srgbChannel(color[1]) + 0.0722 * srgbChannel(color[2]);
}

/** The WCAG contrast ratio (1–21) of a foreground on a background; a translucent foreground is laid over it first. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const fg = relativeLuminance(composite(foreground, background));
  const bg = relativeLuminance(background);
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

/** Whether a ratio meets a minimum. */
export function meetsContrast(ratio: number, minimum: number): boolean {
  return ratio >= minimum;
}

/**
 * A ratio for display: two decimals, rounded DOWN, so a pair just below a threshold never reads as meeting it
 * (4.499 shows as 4.49, not 4.50).
 */
export function formatRatio(ratio: number): string {
  return (Math.floor(ratio * 100) / 100).toFixed(2);
}

/** `#rrggbb`, or `#rrggbbaa` for a translucent colour. */
export function toHex(color: Rgba): string {
  const byte = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  const alpha = color[3] < 1 ? byte(color[3] * 255) : '';
  return `#${byte(color[0])}${byte(color[1])}${byte(color[2])}${alpha}`;
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
