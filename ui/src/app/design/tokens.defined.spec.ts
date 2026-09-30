import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Every `var(--sf-…)` used anywhere in `src/` must be defined in the design scss (`src/app/design/`). Before M35.5 a
 * dozen tokens were referenced but never defined, so those declarations silently fell back to `initial`.
 *
 * Exception: component-local sizing knobs (a host sets `--sf-code-height`, the editor reads it with a fallback). They
 * are listed here on purpose; a new one needs a deliberate entry, not a silent pass.
 */

const SRC = resolve(process.cwd(), 'src');
const DESIGN = join(SRC, 'app', 'design');

/** Custom properties a component declares itself, for its host/parent to override. */
const COMPONENT_LOCAL_KNOBS = new Set([
  '--sf-code-height',
  '--sf-code-min-height',
  '--sf-code-max-height',
  '--sf-cdl-min-height',
  '--sf-cdl-max-height',
  '--sf-octl-min-height',
  '--sf-octl-max-height',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(scss|ts|html)$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const files = walk(SRC);
const defined = new Set<string>();
const used = new Map<string, string[]>();

for (const file of files) {
  const text = stripComments(readFileSync(file, 'utf8'));
  const inDesign = file.startsWith(DESIGN + sep);
  if (inDesign) {
    for (const m of text.matchAll(/(--sf-[\w-]+)\s*:/g)) {
      defined.add(m[1]);
    }
  }
  for (const m of text.matchAll(/var\(\s*(--sf-[\w-]+)/g)) {
    const list = used.get(m[1]) ?? [];
    list.push(relative(SRC, file).split(sep).join('/'));
    used.set(m[1], list);
  }
}

describe('design tokens: no undefined var(--sf-…)', () => {
  it('finds the token definitions and usages', () => {
    expect(defined.size).toBeGreaterThan(100);
    expect(used.size).toBeGreaterThan(50);
    expect(defined.has('--sf-surface')).toBe(true);
  });

  it('defines every used custom property in src/app/design', () => {
    const undefinedTokens = [...used.entries()]
      .filter(([name]) => !defined.has(name) && !COMPONENT_LOCAL_KNOBS.has(name))
      .map(([name, where]) => `${name}  (${[...new Set(where)].slice(0, 3).join(', ')})`);
    expect(undefinedTokens).toEqual([]);
  });

  it('keeps the component-local knob list honest (each is used and not also a design token)', () => {
    for (const knob of COMPONENT_LOCAL_KNOBS) {
      expect(used.has(knob), `${knob} is unused: drop it from the list`).toBe(true);
      expect(defined.has(knob), `${knob} is a design token now: drop it from the list`).toBe(false);
    }
  });

  it('keeps every legacy alias defined and marked for removal in M35.27', () => {
    const aliases = readFileSync(join(DESIGN, '_aliases.scss'), 'utf8');
    for (const name of ['--sf-paper', '--sf-ink', '--sf-slate', '--sf-line', '--sf-signal', '--sf-radius', '--sf-muted',
      '--sf-canvas', '--sf-danger', '--sf-panel', '--sf-hover', '--sf-ink-soft', '--sf-surface-muted',
      '--sf-signal-muted', '--sf-shadow-md', '--sf-shadow-lg', '--sf-amber-700', '--sf-text-2xs']) {
      expect(defined.has(name), name).toBe(true);
    }
    expect(aliases).toContain('remove in M35.27');
  });
});
