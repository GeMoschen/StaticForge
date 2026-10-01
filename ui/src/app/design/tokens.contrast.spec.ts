import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contrast matrix (§24.7 / M7.1.2, rebuilt for the v2 tokens in M35.5).
 *
 * The token values are read from the source of truth — `_primitives.scss` and the light / dark mixins in
 * `_semantic.scss` — and `var(--x)` references are resolved, so a token edit that drops a pair below its threshold fails
 * CI here instead of surfacing in a manual review. Contrast is computed inline (WCAG 2.x relative luminance).
 *
 * Thresholds, in both themes:
 *   - text / background pairs                         >= 4.5:1
 *   - UI boundaries (control borders, focus ring,
 *     status and accent colours as icons / fills)      >= 3:1
 * Deliberately exempt (WCAG 1.4.3 / 1.4.11): `--sf-disabled-text` (disabled controls) and the decorative `--sf-border`
 * (dividers, cards). The disabled pair is still held to 2:1 so it stays legible.
 */

const DESIGN_DIR = resolve(process.cwd(), 'src/app/design');
const read = (file: string): string => readFileSync(resolve(DESIGN_DIR, file), 'utf8');

type TokenMap = Record<string, string>;

function parseDeclarations(block: string): TokenMap {
  const map: TokenMap = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map[m[1]] = m[2].trim();
  }
  return map;
}

/** The text between the braces of `@mixin <name> {`. */
function mixinBody(source: string, name: string): string {
  const start = source.indexOf(`@mixin ${name}`);
  if (start < 0) {
    throw new Error(`mixin ${name} not found`);
  }
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  throw new Error(`mixin ${name} is not closed`);
}

const primitives = parseDeclarations(read('_primitives.scss'));
const semantic = read('_semantic.scss');

/** A theme's tokens, resolved to their values; later mixins override earlier ones (a code palette over a theme). */
function resolveTheme(...mixins: string[]): TokenMap {
  const all: TokenMap = { ...primitives };
  for (const mixin of mixins) {
    Object.assign(all, parseDeclarations(mixinBody(semantic, mixin)));
  }
  const resolveValue = (value: string, seen: string[] = []): string => {
    const ref = /^var\((--[\w-]+)\)$/.exec(value);
    if (!ref) {
      return value;
    }
    if (seen.includes(ref[1]) || !(ref[1] in all)) {
      throw new Error(`cannot resolve ${value} (${seen.join(' -> ')})`);
    }
    return resolveValue(all[ref[1]], [...seen, ref[1]]);
  };
  const out: TokenMap = {};
  for (const [name, value] of Object.entries(all)) {
    out[name] = resolveValue(value);
  }
  return out;
}

const themes: Array<[name: string, tokens: TokenMap]> = [
  ['light', resolveTheme('sf-light-colors')],
  ['dark', resolveTheme('sf-dark-colors')],
];

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function srgbChannel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

function check(tokens: TokenMap, fg: string, bg: string, min: number): void {
  const a = tokens[`--sf-${fg}`];
  const b = tokens[`--sf-${bg}`];
  expect(a, `--sf-${fg}`).toMatch(/^#[0-9a-f]{6}$/i);
  expect(b, `--sf-${bg}`).toMatch(/^#[0-9a-f]{6}$/i);
  expect(contrastRatio(a, b), `${fg} ${a} on ${bg} ${b}`).toBeGreaterThanOrEqual(min);
}

/** [foreground, background, minimum] triples, asserted in both themes. */
const pairs: Array<[string, string, number]> = [];
const add = (fgs: string[], bgs: string[], min: number): void => {
  for (const fg of fgs) for (const bg of bgs) pairs.push([fg, bg, min]);
};

const SURFACES = ['bg', 'surface', 'surface-raised', 'surface-sunken'];
// Text on every surface.
add(['text', 'text-muted', 'text-subtle'], SURFACES, 4.5);
// Text on interactive states.
add(['text', 'text-muted'], ['hover', 'selection', 'disabled-bg'], 4.5);
// Accent: as text / link on surfaces, and as a fill behind its label.
add(['accent', 'accent-hover'], ['bg', 'surface', 'surface-raised', 'accent-subtle'], 4.5);
add(['on-accent'], ['accent', 'accent-hover'], 4.5);
// Status text on its tinted background and on the plain surfaces.
for (const status of ['success', 'warning', 'danger', 'info']) {
  add([`${status}-text`], [`${status}-subtle`, 'bg', 'surface', 'surface-raised'], 4.5);
}
// A label on a solid status fill (warning is amber, too light for a label: it is only used as a tint plus its -text).
add(['text-inverse'], ['success', 'danger', 'info'], 4.5);
// Code editor.
const SYNTAX = [
  'keyword', 'type', 'attr', 'atom', 'string', 'number', 'comment', 'function', 'special', 'operator', 'tag',
  'fmt-tag', 'fmt-attr', 'fmt-string', 'fmt-keyword', 'fmt-number', 'fmt-comment', 'fmt-punct',
].map((n) => `code-${n}`);
add(SYNTAX, ['code-bg'], 4.5);
add(['code-fg'], ['code-bg', 'code-active-line', 'code-selection'], 4.5);
add(['code-gutter-fg'], ['code-gutter-bg'], 4.5);
// The dark top bar: its text and muted text, and the accent as active-item text.
add(['chrome-text', 'chrome-text-muted', 'chrome-accent'], ['chrome-bg', 'chrome-hover'], 4.5);

const boundaries: Array<[string, string, number]> = [];
const addBoundary = (fgs: string[], bgs: string[]): void => {
  for (const fg of fgs) for (const bg of bgs) boundaries.push([fg, bg, 3]);
};
addBoundary(['border-strong'], ['bg', 'surface', 'surface-raised', 'surface-sunken']);
addBoundary(['focus-ring'], ['bg', 'surface', 'surface-raised', 'surface-sunken']);
// Focus on the dark top bar uses the chrome accent as its ring.
addBoundary(['chrome-accent'], ['chrome-bg']);
addBoundary(['accent', 'success', 'warning', 'danger', 'info'], ['bg', 'surface', 'surface-raised']);

describe('design-token contrast matrix', () => {
  it('resolves the light and dark themes down to hex', () => {
    expect(themes[0][1]['--sf-accent']).toBe('#2563eb');
    expect(themes[0][1]['--sf-surface']).toBe('#ffffff');
    expect(themes[1][1]['--sf-bg']).toBe('#0f172a');
  });

  it('defines every semantic token in both themes', () => {
    const required = [
      'bg', 'surface', 'surface-raised', 'surface-sunken', 'overlay',
      'text', 'text-muted', 'text-subtle', 'text-inverse', 'border', 'border-strong',
      'accent', 'accent-hover', 'accent-subtle', 'on-accent',
      'success', 'success-subtle', 'success-text', 'warning', 'warning-subtle', 'warning-text',
      'danger', 'danger-subtle', 'danger-text', 'info', 'info-subtle', 'info-text',
      'focus-ring', 'selection', 'hover', 'disabled-bg', 'disabled-text',
    ];
    const light = Object.keys(themes[0][1]).filter((n) => !/-\d+$/.test(n));
    const dark = Object.keys(themes[1][1]).filter((n) => !/-\d+$/.test(n));
    expect(dark.sort()).toEqual(light.sort());
    for (const [, tokens] of themes) {
      for (const name of required) {
        expect(tokens[`--sf-${name}`], name).toBeDefined();
      }
    }
  });

  // The "refined" code palette (M35.9 decision 18): its syntax colours over each theme's editor background.
  const refined: Array<[name: string, mixin: string, tokens: TokenMap]> = [
    ['light', 'sf-light-code-refined', resolveTheme('sf-light-colors', 'sf-light-code-refined')],
    ['dark', 'sf-dark-code-refined', resolveTheme('sf-dark-colors', 'sf-dark-code-refined')],
  ];
  describe.each(refined)('refined code palette, %s theme', (_name, mixin, tokens) => {
    it('defines every syntax colour', () => {
      const own = parseDeclarations(mixinBody(semantic, mixin));
      for (const name of SYNTAX) {
        expect(own[`--sf-${name}`], name).toBeDefined();
      }
    });
    it.each(SYNTAX)('%s on code-bg >= 4.5:1', (fg) => check(tokens, fg, 'code-bg', 4.5));
  });

  describe.each(themes)('%s theme', (_name, tokens) => {
    it.each(pairs)('text/fill pair %s on %s >= %s:1', (fg, bg, min) => check(tokens, fg, bg, min));
    it.each(boundaries)('UI boundary %s on %s >= %s:1', (fg, bg, min) => check(tokens, fg, bg, min));
    it('disabled text stays legible (>= 2:1; exempt from 4.5:1)', () => check(tokens, 'disabled-text', 'disabled-bg', 2));
  });
});
