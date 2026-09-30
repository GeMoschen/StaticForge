#!/usr/bin/env node
/**
 * Design-token lint (M35.5). Components take every colour, stacking order and size from the tokens in
 * `src/app/design/`; nothing outside that folder may hard-code one.
 *
 * ERRORS (checked against a baseline):
 *   - colour literals: hex (`#rgb`, `#rrggbb`, `#rrggbbaa`), `rgb()/rgba()/hsl()/hsla()`, and the keywords `white` /
 *     `black` as a colour value;
 *   - raw `z-index`: anything but `var(--sf-z-…)` (alone or inside `calc()`), `auto`, `inherit`, `initial`, `unset`.
 * WARNINGS (never fail): px literals other than `0` and `1px` hairlines — summarised, `--list` prints each one.
 *
 * What is scanned: `src/**` `*.scss`, the `styles: [\`…\`]` blocks and `zIndex:` properties of `*.ts`, and `style="…"`
 * attributes / `<style>` of `*.html` and inline templates. Comments, `*.spec.ts` and `src/app/design/` are skipped.
 * There are deliberately no other exemptions: the code-editor theme reads its colours from `--sf-code-*` tokens (the
 * palettes live in `design/_semantic.scss`), so its files need none. User-entered colour data (the colour field editor)
 * is not style and is not scanned.
 *
 * Baseline (`tokens.baseline.json`, file -> { colors, zIndex }), like the i18n lint:
 *  - a file that is not in the baseline must be clean (new files are clean from the start);
 *  - a baselined file may not get MORE findings of either kind than its entry;
 *  - fewer is fine but reported; `--update-baseline` lowers entries and drops clean files — it never raises one.
 *    `--init-baseline` writes the baseline from scratch (first run only; review the diff).
 *
 * Usage: node scripts/check-tokens.mjs [--list] [--update-baseline | --init-baseline]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(scriptDir, '..');
const srcRoot = join(uiRoot, 'src');
const designDir = join(srcRoot, 'app', 'design') + sep;
const baselinePath = join(scriptDir, 'tokens.baseline.json');
const args = new Set(process.argv.slice(2));

const COLOR_FUNCTION = /\b(?:rgba?|hsla?)\(/g;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
const COLOR_KEYWORD = /(?:^|[\s:(,])(?:white|black)(?=[\s;,)!]|$)/g;
const PX_LITERAL = /(?<![\w.-])(?:[2-9]|\d{2,})(?:\.\d+)?px\b/g;

// ── Helpers ──────────────────────────────────────────────────────────────────

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Blanks comments but keeps every newline, so line numbers stay right. */
function stripComments(text, { lineComments }) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (lineComments) out = out.replace(/(^|[^:'"`\w])\/\/.*$/gm, (m, lead) => lead + blank(m.slice(lead.length)));
  return out;
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/** The value of a declaration: the text after the first `:` up to `;`, `}` or the end of the line. */
function declarationsIn(css) {
  const out = [];
  for (const match of css.matchAll(/([\w-]+)\s*:\s*([^;{}\n]+)/g)) {
    out.push({ property: match[1], value: match[2], index: match.index + match[0].indexOf(match[2]) });
  }
  return out;
}

const Z_OK = /^(?:auto|inherit|initial|unset|revert|(?:calc\(\s*)?var\(\s*--sf-z-[\w-]+\s*\)(?:\s*[-+*/]\s*\d+\s*\))?)\s*(?:!important)?$/;

/** Findings in a piece of CSS: { kind: 'color' | 'zIndex' | 'px', index, text }. */
export function scanCss(css) {
  const findings = [];
  for (const { property, value, index } of declarationsIn(css)) {
    if (/^z-?index$/i.test(property)) {
      if (!Z_OK.test(value.trim())) findings.push({ kind: 'zIndex', index, text: `z-index: ${value.trim()}` });
      continue;
    }
    if (property.startsWith('--')) continue; // a custom property definition outside design/ (component knobs) is scanned via its value below
    for (const m of value.matchAll(COLOR_FUNCTION)) findings.push({ kind: 'color', index: index + m.index, text: value.trim() });
    for (const m of value.matchAll(HEX_COLOR)) findings.push({ kind: 'color', index: index + m.index, text: m[0] });
    if (/color|background|border|outline|fill|stroke|shadow/i.test(property)) {
      for (const m of value.matchAll(COLOR_KEYWORD)) findings.push({ kind: 'color', index: index + m.index, text: m[0].trim() });
    }
    for (const m of value.matchAll(PX_LITERAL)) findings.push({ kind: 'px', index: index + m.index, text: `${property}: ${m[0]}` });
  }
  return findings;
}

function scanScss(source) {
  return scanCss(stripComments(source, { lineComments: true }));
}

/** Blocks of CSS text inside a TypeScript component: `styles: [\`…\`]` and `zIndex:` properties. */
function scanTs(source) {
  const findings = [];
  const code = stripComments(source, { lineComments: true });
  for (const block of code.matchAll(/\bstyles\s*:\s*\[([\s\S]*?)\]\s*[,}]/g)) {
    const start = block.index + block[0].indexOf(block[1]);
    for (const str of block[1].matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
      const offset = start + str.index + 1;
      for (const f of scanCss(str[1])) findings.push({ ...f, index: offset + f.index });
    }
  }
  for (const m of code.matchAll(/\bzIndex\s*:\s*([^,}\n]+)/g)) {
    if (!Z_OK.test(m[1].trim().replace(/^['"`]|['"`]$/g, ''))) {
      findings.push({ kind: 'zIndex', index: m.index, text: `zIndex: ${m[1].trim()}` });
    }
  }
  // Inline style attributes in an inline template.
  for (const t of code.matchAll(/\btemplate\s*:\s*`((?:[^`\\]|\\.)*)`/g)) {
    const offset = t.index + t[0].indexOf('`') + 1;
    for (const f of scanHtml(t[1])) findings.push({ ...f, index: offset + f.index });
  }
  return findings;
}

function scanHtml(source) {
  const findings = [];
  const html = source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  for (const m of html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = m[1] ?? m[2];
    const offset = m.index + m[0].indexOf(value);
    // Angular interpolation inside an attribute is not CSS we can judge.
    for (const f of scanCss(value.replace(/\{\{[\s\S]*?\}\}/g, 'x'))) findings.push({ ...f, index: offset + f.index });
  }
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const offset = m.index + m[0].indexOf(m[1]);
    for (const f of scanCss(m[1])) findings.push({ ...f, index: offset + f.index });
  }
  // Bound styles: [style.color]="'#fff'" / [style.z-index]="5"
  for (const m of html.matchAll(/\[style\.([\w-]+)\]\s*=\s*"([^"]*)"/g)) {
    const offset = m.index + m[0].indexOf(m[2]);
    if (/^z-?index$/i.test(m[1])) {
      if (!Z_OK.test(m[2].trim().replace(/^'|'$/g, ''))) findings.push({ kind: 'zIndex', index: offset, text: `[style.z-index]="${m[2]}"` });
    } else if (/color|background/i.test(m[1]) && /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/.test(m[2])) {
      findings.push({ kind: 'color', index: offset, text: `[style.${m[1]}]="${m[2]}"` });
    }
  }
  return findings;
}

/** All findings of the project: { file: [{ kind, line, text }] } (design/, specs and declaration files skipped). */
export function collect() {
  const byFile = {};
  for (const path of walk(srcRoot)) {
    if (path.startsWith(designDir) || /\.spec\.ts$/.test(path) || path.endsWith('.d.ts')) continue;
    let scan;
    if (path.endsWith('.scss')) scan = scanScss;
    else if (path.endsWith('.ts')) scan = scanTs;
    else if (path.endsWith('.html')) scan = scanHtml;
    else continue;
    const source = readFileSync(path, 'utf8');
    const findings = scan(source).map((f) => ({ kind: f.kind, text: f.text, line: lineOf(source, f.index) }));
    if (findings.length > 0) byFile[relative(uiRoot, path).split(sep).join('/')] = findings;
  }
  return byFile;
}

const count = (findings, kind) => findings.filter((f) => f.kind === kind).length;

// ── Checking against the baseline ────────────────────────────────────────────

function main() {
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
  const found = collect();
  const errors = [];
  const progress = [];
  let pxTotal = 0;
  const pxByFile = [];

  for (const [file, findings] of Object.entries(found)) {
    const px = count(findings, 'px');
    if (px > 0) {
      pxTotal += px;
      pxByFile.push([file, px]);
    }
    const allowed = baseline[file] ?? { colors: 0, zIndex: 0 };
    const colors = count(findings, 'color');
    const zIndex = count(findings, 'zIndex');
    if (colors > allowed.colors || zIndex > allowed.zIndex) {
      const bad = findings.filter((f) => f.kind !== 'px' && (f.kind === 'color' ? colors > allowed.colors : zIndex > allowed.zIndex));
      errors.push(
        `${file}: ${colors} colour literal(s) / ${zIndex} raw z-index (baseline ${allowed.colors} / ${allowed.zIndex})` +
          bad.map((f) => `\n    ${file}:${f.line}  ${f.kind}: ${f.text}`).join(''),
      );
    } else if (colors < allowed.colors || zIndex < allowed.zIndex) {
      progress.push(`${file}: ${colors} / ${zIndex} (baseline ${allowed.colors} / ${allowed.zIndex})`);
    }
  }
  for (const file of Object.keys(baseline)) {
    const findings = found[file] ?? [];
    if (count(findings, 'color') === 0 && count(findings, 'zIndex') === 0) progress.push(`${file}: clean (still baselined)`);
  }

  if (args.has('--init-baseline') || args.has('--update-baseline')) {
    const next = {};
    for (const file of Object.keys(found).sort()) {
      const colors = count(found[file], 'color');
      const zIndex = count(found[file], 'zIndex');
      if (colors + zIndex === 0) continue;
      if (args.has('--update-baseline')) {
        // Lowers only: a file that is not baselined cannot enter, a count cannot rise.
        const old = baseline[file];
        if (!old) continue;
        next[file] = { colors: Math.min(colors, old.colors), zIndex: Math.min(zIndex, old.zIndex) };
      } else {
        next[file] = { colors, zIndex };
      }
    }
    writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n');
    console.log(`Token baseline written: ${Object.keys(next).length} file(s).`);
    if (args.has('--init-baseline')) errors.length = 0;
  }

  if (errors.length > 0) {
    console.error('Design-token violations (take colours and z-index from src/app/design/ tokens):\n');
    console.error(errors.join('\n'));
    console.error('\nUse a semantic token (var(--sf-surface), var(--sf-danger-text), …) and var(--sf-z-modal) etc.');
    console.error('The baseline only ever shrinks; new files must be clean.');
    process.exit(1);
  }

  const baselinedFiles = Object.keys(baseline).length;
  const totals = Object.values(baseline).reduce((a, b) => ({ colors: a.colors + b.colors, zIndex: a.zIndex + b.zIndex }), { colors: 0, zIndex: 0 });
  console.log(
    `Token lint passed (baseline: ${baselinedFiles} file(s), ${totals.colors} colour literal(s), ${totals.zIndex} raw z-index).`,
  );
  console.warn(`Warning: ${pxTotal} px literal(s) in ${pxByFile.length} file(s) (not enforced until the screens migrate).`);
  if (args.has('--list')) {
    for (const [file, findings] of Object.entries(found)) {
      for (const f of findings) console.log(`  ${file}:${f.line}  ${f.kind}: ${f.text}`);
    }
  } else if (pxByFile.length > 0) {
    pxByFile.sort((a, b) => b[1] - a[1]);
    console.warn(`  Top: ${pxByFile.slice(0, 5).map(([f, n]) => `${f.split('/').pop()} (${n})`).join(', ')} — run with --list for all.`);
  }
  if (progress.length > 0) {
    console.log(`\nProgress: ${progress.length} file(s) improved. Run \`npm run lint:tokens -- --update-baseline\` to record it:`);
    for (const line of progress) console.log(`  ${line}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
