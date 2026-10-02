#!/usr/bin/env node
/**
 * Raw key listener lint (M35.14). Keyboard shortcuts go through the shortcut registry (`ShortcutService`): a component
 * declares what it answers to and takes it back when it goes away. So no code listens for keys on `document` or
 * `window` on its own — not with `addEventListener('keydown' …)`, not with `@HostListener('document:keydown…')`, not
 * with a `(document:keydown…)` host or template binding.
 *
 * Allowed: the registry itself, the overlay stack (it closes the topmost overlay on Escape and traps Tab) and the
 * tooltip directive (a tooltip hides on Escape). Element-level `(keydown)` handlers are fine — they are a component
 * handling its own focus, not a shortcut. Scans `src/app/**` `*.ts` and `*.html` except specs.
 *
 * Usage: node scripts/check-keydown-listeners.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(uiRoot, 'src', 'app');

const ALLOWED = [
  'core/ui/shortcut.service.ts',
  'shared/overlay/overlay-stack.ts',
  'shared/directives/sf-tooltip.directive.ts',
];

const KEY_EVENT = String.raw`key(?:down|up|press)`;
const PATTERNS = [
  // @HostListener('document:keydown.escape'), host: { '(window:keydown)': … }, <x (document:keydown)="…">
  new RegExp(String.raw`(?:document|window|body):${KEY_EVENT}`, 'g'),
  // document.addEventListener('keydown', …), this.document.addEventListener(…), window.addEventListener(…)
  new RegExp(String.raw`(?:document|window)\s*\.\s*(?:addEventListener|removeEventListener)\s*\(\s*['"\`]${KEY_EVENT}['"\`]`, 'g'),
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|html)$/.test(path) && !path.endsWith('.spec.ts')) yield path;
  }
}

const findings = [];
for (const file of walk(appRoot)) {
  const name = relative(appRoot, file).split(sep).join('/');
  if (ALLOWED.includes(name)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (PATTERNS.some((pattern) => ((pattern.lastIndex = 0), pattern.test(line)))) {
      findings.push(`${name}:${index + 1}  ${line.trim()}`);
    }
  });
}

if (findings.length > 0) {
  console.error(`Raw key listeners on document/window — register the shortcut with ShortcutService instead (${findings.length}):`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log('No raw document/window key listeners outside the shortcut registry, the overlay stack and tooltips.');
