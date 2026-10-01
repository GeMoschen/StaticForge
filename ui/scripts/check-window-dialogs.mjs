#!/usr/bin/env node
/**
 * Browser dialog lint (M35.7). The app asks through `ConfirmService` (and shows messages through toasts and banners),
 * never through the browser's own blocking dialogs: `window.confirm`, `window.prompt`, `window.alert` — called with or
 * without the `window.` prefix.
 *
 * Until the screens migrate it only WARNS (lists every call, exit 0). `--strict` (M35.27 switches `npm run lint` to it)
 * fails on any call. Scans `src/app/**` `*.ts` except specs; comments are skipped.
 *
 * Usage: node scripts/check-window-dialogs.mjs [--strict]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(uiRoot, 'src', 'app');
const strict = process.argv.includes('--strict');

// `confirm(`, `window.confirm(`, `globalThis.alert(` — not `this.confirms.confirm(` or `service.prompt(`.
const CALL = /(?:^|[^\w.$])(?:(?:window|globalThis|self)\s*\.\s*)?(confirm|prompt|alert)\s*\(/g;
const MEMBER_CALL = /(?:window|globalThis|self)\s*\.\s*(confirm|prompt|alert)\s*\(/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) yield path;
  }
}

/** Blanks comments and string contents but keeps every newline, so line numbers stay right. */
function code(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, (m, lead) => lead + blank(m.slice(lead.length)))
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, blank);
}

const findings = [];
for (const file of walk(appRoot)) {
  const source = code(readFileSync(file, 'utf8'));
  const seen = new Set();
  for (const pattern of [MEMBER_CALL, CALL]) {
    for (const match of source.matchAll(pattern)) {
      const index = match.index + match[0].indexOf(match[1]);
      if (seen.has(index)) continue;
      // A method or function of our own with the same name (`confirm(): void {`, `function confirm(`) is no call.
      const before = source.slice(Math.max(0, match.index - 20), match.index + 1);
      const after = source.slice(index);
      if (/\bfunction\s*$/.test(before) || /^\w+\s*\([^)]*\)\s*(?::[^{;]+)?\{/.test(after.split('\n')[0])) continue;
      seen.add(index);
      const line = source.slice(0, index).split('\n').length;
      findings.push(`${relative(uiRoot, file).split(sep).join('/')}:${line}  ${match[1]}()`);
    }
  }
}

if (!findings.length) {
  console.log('Browser dialog check passed (no window.confirm/prompt/alert).');
  process.exit(0);
}
const label = strict ? 'Error' : 'Warning';
console.log(`${label}: ${findings.length} browser dialog call(s) — use ConfirmService (or a toast/banner) instead:`);
for (const finding of findings.sort()) console.log(`  ${finding}`);
process.exit(strict ? 1 : 0);
