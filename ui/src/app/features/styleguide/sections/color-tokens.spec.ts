import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLOR_GROUPS } from './color-tokens';

/** The custom properties a mixin of `_semantic.scss` declares, without `--sf-`. */
function declaredIn(mixin: string): string[] {
  const source = readFileSync(resolve(process.cwd(), 'src/app/design/_semantic.scss'), 'utf8');
  const start = source.indexOf(`@mixin ${mixin}`);
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/--sf-([\w-]+)\s*:/g)].map((m) => m[1]);
}

describe('style guide colour tokens', () => {
  it('shows every semantic colour token of _semantic.scss, once', () => {
    const shown = COLOR_GROUPS.flatMap((group) => group.tokens.map((token) => token.name));
    expect(new Set(shown).size).toBe(shown.length);
    expect([...shown].sort()).toEqual(declaredIn('sf-light-colors').sort());
    expect([...shown].sort()).toEqual(declaredIn('sf-dark-colors').sort());
  });

  it('checks only pairs of tokens that exist', () => {
    const names = new Set(declaredIn('sf-light-colors'));
    for (const group of COLOR_GROUPS) {
      for (const token of group.tokens) {
        for (const check of token.checks) {
          expect(names.has(check.fg) && names.has(check.bg), `${check.fg} on ${check.bg}`).toBe(true);
          expect([check.fg, check.bg]).toContain(token.name);
        }
      }
    }
  });
});
