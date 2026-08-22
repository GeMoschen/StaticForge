import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contrast matrix (§24.7 / M7.1.2): verifies the design-token colour pairs in
 * tokens.scss against WCAG 2.x relative-luminance thresholds, computed inline
 * (no dependency). The token values are read directly from the source of
 * truth — `tokens.scss` — so a token edit that drops a pair below threshold
 * fails CI here rather than only surfacing in a manual review.
 *
 * Thresholds:
 *   - Body text (`--sf-ink`) on its canvases ≥ 7:1 (AAA).
 *   - UI / large text accents (`--sf-signal`, `--sf-jade`, `--sf-rust`) ≥ 4.5:1
 *     on their surfaces (AA large-text / UI components).
 */

const TOKENS_PATH = resolve(process.cwd(), 'src/app/design/tokens.scss');
const SOURCE = readFileSync(TOKENS_PATH, 'utf8');

type TokenMap = Record<string, string>;

/** Split the light (`:root`) block from the `[data-theme="dark"]` block. */
function parseThemeBlock(block: string): TokenMap {
  const map: TokenMap = {};
  const re = /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    map[match[1]] = match[2].toLowerCase();
  }
  return map;
}

const [lightBlock, darkBlock] = SOURCE.split('[data-theme="dark"]');
const light = parseThemeBlock(lightBlock);
const dark = parseThemeBlock(darkBlock);

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function srgbChannel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of a 6-digit hex colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

/** WCAG contrast ratio between two 6-digit hex colours (1..21). */
function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('design-token contrast matrix', () => {
  it('parses the light and dark token blocks', () => {
    expect(light['--sf-paper']).toBe('#f6f7f8');
    expect(dark['--sf-paper']).toBe('#0c0f12');
    expect(light['--sf-ink']).toBe('#101418');
    expect(dark['--sf-ink']).toBe('#e8ebee');
  });

  describe('body text (AAA ≥ 7:1)', () => {
    const pairs: Array<[theme: string, map: TokenMap]> = [
      ['light', light],
      ['dark', dark],
    ];

    it.each(pairs)('%s: --sf-ink on --sf-paper', (_theme, tokens) => {
      expect(contrastRatio(tokens['--sf-ink'], tokens['--sf-paper'])).toBeGreaterThanOrEqual(7);
    });

    it.each(pairs)('%s: --sf-ink on --sf-surface', (_theme, tokens) => {
      expect(contrastRatio(tokens['--sf-ink'], tokens['--sf-surface'])).toBeGreaterThanOrEqual(7);
    });

    it.each(pairs)('%s: --sf-slate (secondary text) on --sf-surface', (_theme, tokens) => {
      expect(contrastRatio(tokens['--sf-slate'], tokens['--sf-surface'])).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('UI / large text accents (AA ≥ 4.5:1)', () => {
    const accents = ['--sf-signal', '--sf-jade', '--sf-rust'] as const;
    const themes: Array<[theme: string, map: TokenMap]> = [
      ['light', light],
      ['dark', dark],
    ];

    for (const theme of themes) {
      for (const accent of accents) {
        it(`${theme[0]}: ${accent} on --sf-surface`, () => {
          expect(contrastRatio(theme[1][accent], theme[1]['--sf-surface'])).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    it('dark: --sf-amber on --sf-surface', () => {
      expect(contrastRatio(dark['--sf-amber'], dark['--sf-surface'])).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('--sf-amber (reserved "not on the record" signal)', () => {
    // Dark-theme amber passes AA (≥ 4.5:1). The light-theme token is
    // spec-verbatim (`#C77A0A`, §24.3) and yields ~3.4:1 on white — it meets
    // the large-text / graphical-object AA floor of 3:1 but not 4.5:1, so it
    // is asserted against 3:1 and flagged here as a known deviation.
    it('light: --sf-amber holds the large-text/graphical AA floor (≥ 3:1)', () => {
      expect(contrastRatio(light['--sf-amber'], light['--sf-surface'])).toBeGreaterThanOrEqual(3);
    });
    it('light: --sf-amber holds 3:1 on --sf-paper', () => {
      expect(contrastRatio(light['--sf-amber'], light['--sf-paper'])).toBeGreaterThanOrEqual(3);
    });
  });

  describe('button labels (white text on accent fills)', () => {
    it('light: white on --sf-signal', () => {
      expect(contrastRatio('#ffffff', light['--sf-signal'])).toBeGreaterThanOrEqual(4.5);
    });
    it('light: white on --sf-rust', () => {
      expect(contrastRatio('#ffffff', light['--sf-rust'])).toBeGreaterThanOrEqual(4.5);
    });
  });
});
