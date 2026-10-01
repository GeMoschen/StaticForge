import { TEXT_CONTRAST, UI_CONTRAST } from '../contrast.util';

/**
 * The semantic colour tokens of `design/_semantic.scss` as the style guide shows them (M35.9), each with the contrast
 * pairs that matter for it — the same pairs and thresholds as `design/tokens.contrast.spec.ts`. Token names are given
 * without the `--sf-` prefix.
 */
export interface ContrastCheck {
  readonly fg: string;
  readonly bg: string;
  /** The minimum ratio; `null` for a decorative colour that has none (shown for information). */
  readonly min: number | null;
}

export interface ColorToken {
  readonly name: string;
  readonly checks: readonly ContrastCheck[];
}

export interface ColorGroup {
  readonly id: string;
  /** `styleguide.page.colors.groups.*` key. */
  readonly key: string;
  readonly tokens: readonly ColorToken[];
}

const SURFACES = ['bg', 'surface', 'surface-raised', 'surface-sunken'];
const PLAIN_SURFACES = ['bg', 'surface', 'surface-raised'];
const SYNTAX = [
  'keyword', 'type', 'attr', 'atom', 'string', 'number', 'comment', 'function', 'special', 'operator', 'tag',
  'fmt-tag', 'fmt-attr', 'fmt-string', 'fmt-keyword', 'fmt-number', 'fmt-comment', 'fmt-punct',
];

/** A foreground token, checked on each background. */
const fg = (name: string, backgrounds: readonly string[], min: number | null): ColorToken => ({
  name,
  checks: backgrounds.map((bg) => ({ fg: name, bg, min })),
});

/** A background token, checked with each foreground on it. */
const bg = (name: string, foregrounds: readonly string[], min: number | null = TEXT_CONTRAST): ColorToken => ({
  name,
  checks: foregrounds.map((f) => ({ fg: f, bg: name, min })),
});

const status = (tone: string): ColorToken[] => [
  fg(tone, PLAIN_SURFACES, UI_CONTRAST),
  bg(`${tone}-subtle`, [`${tone}-text`]),
  fg(`${tone}-text`, [`${tone}-subtle`, ...PLAIN_SURFACES], TEXT_CONTRAST),
];

export const COLOR_GROUPS: readonly ColorGroup[] = [
  {
    id: 'surfaces',
    key: 'styleguide.page.colors.groups.surfaces',
    tokens: [
      ...SURFACES.map((name) => bg(name, ['text', 'text-muted', 'text-subtle'])),
      { name: 'overlay', checks: [] },
    ],
  },
  {
    id: 'text',
    key: 'styleguide.page.colors.groups.text',
    tokens: [
      fg('text', SURFACES, TEXT_CONTRAST),
      fg('text-muted', SURFACES, TEXT_CONTRAST),
      fg('text-subtle', SURFACES, TEXT_CONTRAST),
      fg('text-inverse', ['success', 'danger', 'info'], TEXT_CONTRAST),
    ],
  },
  {
    id: 'borders',
    key: 'styleguide.page.colors.groups.borders',
    tokens: [fg('border', ['bg', 'surface'], null), fg('border-strong', SURFACES, UI_CONTRAST)],
  },
  {
    id: 'accent',
    key: 'styleguide.page.colors.groups.accent',
    tokens: [
      fg('accent', [...PLAIN_SURFACES, 'accent-subtle'], TEXT_CONTRAST),
      fg('accent-hover', [...PLAIN_SURFACES, 'accent-subtle'], TEXT_CONTRAST),
      bg('accent-subtle', ['accent', 'text']),
      fg('on-accent', ['accent', 'accent-hover'], TEXT_CONTRAST),
    ],
  },
  {
    id: 'status',
    key: 'styleguide.page.colors.groups.status',
    tokens: ['success', 'warning', 'danger', 'info'].flatMap(status),
  },
  {
    id: 'states',
    key: 'styleguide.page.colors.groups.states',
    tokens: [
      fg('focus-ring', SURFACES, UI_CONTRAST),
      bg('selection', ['text', 'text-muted']),
      bg('hover', ['text', 'text-muted']),
      bg('disabled-bg', ['text', 'text-muted']),
      fg('disabled-text', ['disabled-bg'], 2),
    ],
  },
  {
    id: 'chrome',
    key: 'styleguide.page.colors.groups.chrome',
    tokens: [
      bg('chrome-bg', ['chrome-text', 'chrome-text-muted', 'chrome-accent']),
      fg('chrome-text', ['chrome-bg', 'chrome-hover'], TEXT_CONTRAST),
      fg('chrome-text-muted', ['chrome-bg', 'chrome-hover'], TEXT_CONTRAST),
      fg('chrome-accent', ['chrome-bg', 'chrome-hover'], TEXT_CONTRAST),
      fg('chrome-border', ['chrome-bg'], null),
      bg('chrome-hover', ['chrome-text']),
    ],
  },
  {
    id: 'code',
    key: 'styleguide.page.colors.groups.code',
    tokens: [
      bg('code-bg', ['code-fg']),
      fg('code-fg', ['code-bg', 'code-active-line', 'code-selection'], TEXT_CONTRAST),
      bg('code-gutter-bg', ['code-gutter-fg']),
      fg('code-gutter-fg', ['code-gutter-bg'], TEXT_CONTRAST),
      bg('code-active-line', ['code-fg']),
      bg('code-selection', ['code-fg']),
      ...SYNTAX.map((name) => fg(`code-${name}`, ['code-bg'], TEXT_CONTRAST)),
    ],
  },
];

/** Every token name a group shows or checks against. */
export function colorTokenNames(groups: readonly ColorGroup[] = COLOR_GROUPS): string[] {
  const names = new Set<string>();
  for (const group of groups) {
    for (const token of group.tokens) {
      names.add(token.name);
      for (const check of token.checks) {
        names.add(check.fg);
        names.add(check.bg);
      }
    }
  }
  return [...names];
}
