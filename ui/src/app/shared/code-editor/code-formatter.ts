import type { CodeLanguage } from './code-editor.types';

/**
 * Source formatters for the code editors (M35.9, the Format button of `sf-code-panel`). Not to be confused with
 * `code-format.ts`, which decides what an OCTL template is *highlighted* as.
 *
 * - JSON: re-indented with two spaces a level; only the whitespace outside strings changes, the values stay as written.
 * - CDL: re-indented by its brace nesting (two spaces a level), trailing spaces removed, runs of blank lines collapsed
 *   to one. Braces inside strings and comments don't count; a comment or string that spans lines is kept as written.
 *
 * OCTL and `where` expressions have no formatter: OCTL's text belongs to its host format, and an expression is one line.
 * A formatter returns `null` when it cannot format the text (JSON that doesn't parse).
 */
export type CodeFormatter = (text: string) => string | null;

const INDENT = '  ';

/** The formatter of a language, or `null` when it has none. */
export function codeFormatterFor(language: CodeLanguage): CodeFormatter | null {
  switch (language) {
    case 'json':
      return formatJson;
    case 'cdl':
      return formatBraces;
    default:
      return null;
  }
}

/**
 * Re-indents JSON with two spaces a level. Only the whitespace outside strings changes: the values are kept byte for
 * byte (big integers, `1.0`, `1e3`, `-0`, escapes, duplicate keys), which a parse-and-print round trip would not.
 */
export function formatJson(text: string): string | null {
  if (!text.trim()) {
    return text;
  }
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  let out = '';
  let depth = 0;
  const newline = () => '\n' + INDENT.repeat(depth);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const start = i;
      for (i++; text[i] !== '"'; i++) {
        if (text[i] === '\\') {
          i++;
        }
      }
      out += text.slice(start, i + 1);
    } else if (ch === '{' || ch === '[') {
      let next = i + 1;
      while (/\s/.test(text[next])) {
        next++;
      }
      if (text[next] === (ch === '{' ? '}' : ']')) {
        // Empty, printed as `{}` / `[]`.
        out += ch + text[next];
        i = next;
      } else {
        depth++;
        out += ch + newline();
      }
    } else if (ch === '}' || ch === ']') {
      depth--;
      out += newline() + ch;
    } else if (ch === ',') {
      out += ',' + newline();
    } else if (ch === ':') {
      out += ': ';
    } else if (!/\s/.test(ch)) {
      out += ch;
    }
  }
  return out + (/\n\s*$/.test(text) ? '\n' : '');
}

/** Where a scan stopped: inside a block comment, inside a string (its quote), or in code. */
interface ScanState {
  comment: boolean;
  quote: string | null;
}

/** The nesting change of one line, and the closers it starts with (they belong to the outer level). */
function scanLine(line: string, state: ScanState): { delta: number; leadingClosers: number } {
  let delta = 0;
  let leadingClosers = 0;
  let leading = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (state.comment) {
      if (ch === '*' && line[i + 1] === '/') {
        state.comment = false;
        i++;
      }
      leading = false;
      continue;
    }
    if (state.quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === state.quote) {
        state.quote = null;
      }
      leading = false;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') {
      break;
    }
    if (ch === '/' && line[i + 1] === '*') {
      state.comment = true;
      i++;
      leading = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      state.quote = ch;
      leading = false;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      delta++;
      leading = false;
    } else if (ch === '}' || ch === ']' || ch === ')') {
      delta--;
      if (leading) {
        leadingClosers++;
      }
    } else if (ch !== ' ' && ch !== '\t') {
      leading = false;
    }
  }
  return { delta, leadingClosers };
}

/** Re-indents brace-structured source (CDL). */
export function formatBraces(text: string): string {
  const lines = text.split(/\r?\n/);
  const state: ScanState = { comment: false, quote: null };
  const out: string[] = [];
  let depth = 0;
  for (const raw of lines) {
    if (state.comment || state.quote) {
      // The rest of a comment or string that started on an earlier line: its text is content, kept as written — a
      // string's line exactly (its trailing spaces are part of the value), a comment's without trailing spaces.
      const startsInString = state.quote !== null;
      depth = Math.max(0, depth + scanLine(raw, state).delta);
      out.push(startsInString || state.quote ? raw : raw.replace(/\s+$/, ''));
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      if (out.length && out[out.length - 1] !== '') {
        out.push('');
      }
      continue;
    }
    // A line that ends inside a string keeps its trailing spaces: they are the start of the string's value.
    const started = raw.replace(/^\s+/, '');
    const { delta, leadingClosers } = scanLine(started, state);
    out.push(INDENT.repeat(Math.max(0, depth - leadingClosers)) + (state.quote ? started : trimmed));
    depth = Math.max(0, depth + delta);
  }
  while (out.length && out[out.length - 1] === '') {
    out.pop();
  }
  return out.join('\n') + (/\n\s*$/.test(text) && out.length ? '\n' : '');
}
