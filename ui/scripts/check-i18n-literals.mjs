#!/usr/bin/env node
/**
 * Flags user-visible English literals in Angular templates (M35.4): text nodes and the `title`, `aria-label`,
 * `placeholder`, `alt`, `sfTooltip` (and the text inputs of `sf-*` components: `label`, `hint`, `description`, `tooltip`,
 * … — see COMPONENT_TEXT_ATTRIBUTES) attributes, static or bound, plus string literals inside `{{ … }}` interpolations. Every such text belongs in `assets/i18n/en.json` and is shown through the
 * `transloco` pipe or `TranslocoService.translate()`.
 *
 * Scans `src/app/**` `*.html` and the inline `template:` of `*.ts` components.
 *
 * Baseline: screens that are not migrated yet are listed in `i18n-literals.baseline.json` (file -> number of findings).
 *  - a file that is not in the baseline must have no findings;
 *  - a baselined file must not get MORE findings than its entry (no new literals in an unmigrated screen);
 *  - fewer findings are fine but reported: run with `--update-baseline` to record the progress (entries of clean
 *    files are dropped, so the baseline only ever shrinks);
 *  - `STRICT_PREFIXES` (shared components and the shell) are never baselined.
 *
 * Opt-outs: text in `<kbd>`, `<code>`, `<pre>`, `<style>` and `<script>` is ignored; `<!-- i18n-ignore -->` excuses the
 * next tag or text node (a product name, a format example, a key name).
 *
 * Usage: node scripts/check-i18n-literals.mjs [--update-baseline] [--list]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(uiRoot, 'src', 'app');
const baselinePath = join(dirname(fileURLToPath(import.meta.url)), 'i18n-literals.baseline.json');

/** Files under these prefixes (relative to `ui/`, forward slashes) may never be in the baseline. */
const STRICT_PREFIXES = ['src/app/shared/', 'src/app/core/ui/', 'src/app/app.component.'];

const TEXT_ATTRIBUTES = new Set(['title', 'aria-label', 'aria-description', 'placeholder', 'alt', 'sfTooltip']);
// The text inputs of the sf-* components (M35.6 added tooltip, disabledReason, subtitle, error, text, the action labels).
const COMPONENT_TEXT_ATTRIBUTES = new Set([
  'label',
  'hint',
  'description',
  'heading',
  'tooltip',
  'disabledReason',
  'subtitle',
  'error',
  'text',
  'primaryLabel',
  'secondaryLabel',
]);
const SKIPPED_ELEMENTS = new Set(['kbd', 'code', 'pre', 'style', 'script']);
const VOID_ELEMENTS = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'source', 'col']);

const args = new Set(process.argv.slice(2));

// ── Finding literals ─────────────────────────────────────────────────────────

/** Does the text contain words a user would read (two letters in a row)? */
const hasWords = (text) => /\p{L}{2}/u.test(text.replace(/&[#\w]+;/g, ' '));

/** A quoted literal in an expression that reads like prose: has two letters and a space or a capital start. */
function literalsIn(expression) {
  const found = [];
  const pattern = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const match of expression.matchAll(pattern)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (/\p{L}{2}/u.test(value) && (/\s/.test(value) || /^\p{Lu}/u.test(value)) && !/^[\w.-]+\.[\w.-]+$/.test(value)) {
      found.push(value);
    }
  }
  return found;
}

/** Literals of an expression that is not already translated. */
function untranslatedLiterals(expression) {
  return /\|\s*transloco\b|\btranslate\s*\(/.test(expression) ? [] : literalsIn(expression);
}

/** Skips a balanced `( … )` starting at `index` (which must be the opening parenthesis); returns the index after it. */
function skipParens(text, index) {
  let depth = 0;
  let quote = null;
  for (let i = index; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  return text.length;
}

/** The readable text of a text node: control flow syntax, interpolations and entities removed. */
function visibleText(raw) {
  let out = '';
  for (let i = 0; i < raw.length; ) {
    if (raw.startsWith('{{', i)) {
      const end = raw.indexOf('}}', i);
      i = end < 0 ? raw.length : end + 2;
      out += ' ';
    } else if (raw[i] === '@' && /^@(if|else if|else|for|empty|switch|case|default|defer|placeholder|loading|error|let)\b/.test(raw.slice(i))) {
      const word = /^@(else if|\w+)/.exec(raw.slice(i))[0];
      i += word.length;
      while (raw[i] === ' ') i++;
      if (raw[i] === '(') i = skipParens(raw, i);
      else if (word === '@let') i = raw.indexOf(';', i) + 1 || raw.length;
      out += ' ';
    } else if (raw[i] === '{' || raw[i] === '}') {
      out += ' ';
      i++;
    } else {
      out += raw[i++];
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function interpolationsIn(raw) {
  const expressions = [];
  for (const match of raw.matchAll(/\{\{([\s\S]*?)\}\}/g)) expressions.push(match[1]);
  return expressions;
}

/** Parses a start tag at `index` (`<`); returns { name, attributes, end, selfClosing }. */
function parseTag(html, index) {
  let i = index + 1;
  const closing = html[i] === '/';
  if (closing) i++;
  const nameStart = i;
  while (i < html.length && /[\w:.-]/.test(html[i])) i++;
  const name = html.slice(nameStart, i).toLowerCase();
  const attributes = [];
  while (i < html.length && html[i] !== '>') {
    if (/\s/.test(html[i]) || html[i] === '/') {
      i++;
      continue;
    }
    const attrStart = i;
    while (i < html.length && !/[\s=>]/.test(html[i]) && !(html[i] === '/' && html[i + 1] === '>')) i++;
    const attrName = html.slice(attrStart, i);
    let value = null;
    let valueIndex = attrStart;
    if (html[i] === '=') {
      i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const end = html.indexOf(quote, i + 1);
        valueIndex = i + 1;
        value = html.slice(i + 1, end < 0 ? html.length : end);
        i = end < 0 ? html.length : end + 1;
      } else {
        const valueStart = i;
        while (i < html.length && !/[\s>]/.test(html[i])) i++;
        valueIndex = valueStart;
        value = html.slice(valueStart, i);
      }
    }
    if (attrName) attributes.push({ name: attrName, value, index: valueIndex });
  }
  const selfClosing = html[i - 1] === '/' || VOID_ELEMENTS.has(name);
  return { name, closing, attributes, end: i + 1, selfClosing };
}

/** The findings of one template: { index, kind, text }. */
export function scanTemplate(html) {
  const findings = [];
  const add = (index, kind, text) => findings.push({ index, kind, text: text.trim().replace(/\s+/g, ' ').slice(0, 60) });
  let ignoreNext = false;
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i);
      const stop = end < 0 ? html.length : end + 3;
      if (/i18n-ignore/.test(html.slice(i, stop))) ignoreNext = true;
      i = stop;
      continue;
    }
    const isTag = html[i] === '<' && /[A-Za-z/]/.test(html[i + 1] ?? '');
    if (isTag) {
      const tag = parseTag(html, i);
      if (!tag.closing) {
        const componentTag = tag.name.startsWith('sf-') || tag.name.includes('-');
        for (const attr of tag.attributes) {
          if (attr.value === null || ignoreNext) continue;
          const bound = /^\[(attr\.)?(.+)\]$/.exec(attr.name);
          const plain = bound ? bound[2] : attr.name;
          const isText = TEXT_ATTRIBUTES.has(plain) || (componentTag && COMPONENT_TEXT_ATTRIBUTES.has(plain));
          if (!isText) continue;
          if (bound) {
            for (const literal of untranslatedLiterals(attr.value)) add(attr.index, `[${plain}]`, literal);
          } else if (!/^\{\{/.test(attr.value) && hasWords(attr.value)) {
            add(attr.index, plain, attr.value);
          }
        }
        if (SKIPPED_ELEMENTS.has(tag.name) && !tag.selfClosing) {
          const close = html.toLowerCase().indexOf(`</${tag.name}`, tag.end);
          i = close < 0 ? html.length : close;
          ignoreNext = false;
          continue;
        }
      }
      ignoreNext = false;
      i = tag.end;
      continue;
    }
    // Text up to the next tag or comment.
    let next = i + 1;
    while (next < html.length && !(html[next] === '<' && (/[A-Za-z/!]/.test(html[next + 1] ?? '')))) next++;
    const raw = html.slice(i, next);
    if (!ignoreNext) {
      const text = visibleText(raw);
      if (text && hasWords(text)) add(i + raw.search(/\S/), 'text', text);
      for (const expression of interpolationsIn(raw)) {
        for (const literal of untranslatedLiterals(expression)) add(i, 'interpolation', literal);
      }
    }
    if (raw.trim()) ignoreNext = false;
    i = next;
  }
  return findings;
}

// ── Collecting files ─────────────────────────────────────────────────────────

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

function scanFile(path) {
  const source = readFileSync(path, 'utf8');
  if (path.endsWith('.html')) {
    return scanTemplate(source).map((f) => ({ ...f, line: lineOf(source, f.index) }));
  }
  // Inline templates: `template: \`…\``.
  const results = [];
  for (const match of source.matchAll(/\btemplate:\s*`((?:[^`\\]|\\.)*)`/g)) {
    const start = match.index + match[0].indexOf('`') + 1;
    for (const f of scanTemplate(match[1])) results.push({ ...f, line: lineOf(source, start + f.index) });
  }
  return results;
}

export function collect() {
  const byFile = {};
  for (const path of walk(appRoot)) {
    if (!/\.(html|ts)$/.test(path) || /\.(spec|testing)\.ts$/.test(path) || path.endsWith('.d.ts')) continue;
    const findings = scanFile(path);
    if (findings.length > 0) byFile[relative(uiRoot, path).split(sep).join('/')] = findings;
  }
  return byFile;
}

const isStrict = (file) => STRICT_PREFIXES.some((prefix) => file.startsWith(prefix));

// ── Checking against the baseline ────────────────────────────────────────────

function main() {
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
  const found = collect();
  const errors = [];
  const progress = [];

  for (const [file, findings] of Object.entries(found)) {
    const allowed = baseline[file] ?? 0;
    const strict = isStrict(file);
    if (strict || findings.length > allowed) {
      const limit = strict ? 0 : allowed;
      errors.push(
        `${file}: ${findings.length} untranslated literal(s)${limit ? ` (baseline ${limit})` : ''}` +
          findings.map((f) => `\n    ${file}:${f.line}  ${f.kind}: "${f.text}"`).join(''),
      );
    } else if (findings.length < allowed) {
      progress.push(`${file}: ${findings.length} (baseline ${allowed})`);
    } else if (args.has('--list')) {
      console.log(`${file}: ${findings.length}`);
    }
  }
  for (const file of Object.keys(baseline)) {
    if (!(file in found)) progress.push(`${file}: clean (baseline ${baseline[file]})`);
    if (isStrict(file)) {
      errors.push(`${file}: shared components and the shell must not be in the baseline`);
    }
  }

  if (args.has('--update-baseline')) {
    const next = {};
    for (const file of Object.keys(found).sort()) {
      if (!isStrict(file)) next[file] = found[file].length;
    }
    writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n');
    console.log(`i18n baseline written: ${Object.keys(next).length} file(s) with untranslated literals.`);
    // Shared components and the shell are never baselined: their findings still fail.
    errors.splice(0, errors.length, ...errors.filter((e) => isStrict(e.split(':')[0])));
  }

  if (errors.length > 0) {
    console.error('Untranslated user-visible literals (use keys from assets/i18n/en.json):\n');
    console.error(errors.join('\n'));
    console.error('\nAdd the text to en.json and render it with the transloco pipe / TranslocoService.translate().');
    console.error('Use `<!-- i18n-ignore -->` for text that must stay literal (product names, format examples).');
    process.exit(1);
  }
  const baselined = Object.keys(baseline).length;
  console.log(`i18n literal check passed (${baselined} screen file(s) still baselined).`);
  if (progress.length > 0) {
    console.log(`\nProgress: ${progress.length} file(s) improved. Run \`npm run lint:i18n -- --update-baseline\` to record it:`);
    for (const line of progress) console.log(`  ${line}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
