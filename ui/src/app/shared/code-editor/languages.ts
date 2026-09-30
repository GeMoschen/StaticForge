import { StreamLanguage, StringStream, foldService } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import {
  CDL_ATTRIBUTES,
  CDL_EDITOR_TYPES,
  CDL_EXPRESSION_KEYS,
  CDL_STRUCTURE,
  CDL_VALUES,
  EXPRESSION_CONTEXT,
  EXPRESSION_FUNCTIONS,
  EXPRESSION_WORDS,
  OCTL_ROOTS,
  OCTL_WORDS,
} from './vocabulary';

/**
 * Syntax modes for the code editors (M33): CDL (with expressions highlighted inside `assert "…"`, `when "…"`,
 * `value "…"`, `visibleWhen "…"`, `requiredWhen "…"`, `readOnlyWhen "…"`), OCTL (`$CMS_…$` instructions in any text)
 * and bare expressions (a record set's `where`). Stream tokenizers: a line-oriented, error-tolerant approximation of
 * the server grammars — the server's diagnostics stay authoritative.
 */

/** Token names the tokenizers return, and the highlight tag of each. */
export const TOKEN_TABLE = {
  keyword: tags.keyword,
  typeName: tags.typeName,
  propertyName: tags.propertyName,
  atom: tags.atom,
  string: tags.string,
  number: tags.number,
  comment: tags.comment,
  operator: tags.operator,
  operatorKeyword: tags.operatorKeyword,
  bracket: tags.bracket,
  punctuation: tags.punctuation,
  fn: tags.function(tags.variableName),
  ctx: tags.special(tags.variableName),
  ns: tags.namespace,
  variable: tags.variableName,
  tag: tags.tagName,
  meta: tags.meta,
} as const;

type Token = keyof typeof TOKEN_TABLE | null;

const STRUCTURE = new Set<string>(CDL_STRUCTURE);
const TYPES = new Set<string>(CDL_EDITOR_TYPES);
const ATTRIBUTES = new Set<string>(CDL_ATTRIBUTES);
const VALUES = new Set<string>(CDL_VALUES);
const EXPRESSION_KEYS = new Set<string>(CDL_EXPRESSION_KEYS);
const FUNCTIONS = new Set(EXPRESSION_FUNCTIONS.map((f) => f.name));
const CONTEXT = new Set<string>(EXPRESSION_CONTEXT);
const EXPR_WORDS = new Set<string>(EXPRESSION_WORDS);
const OCTL_EXPR_WORDS = new Set<string>(OCTL_WORDS);
const OCTL_ROOT_NAMES = new Set<string>(OCTL_ROOTS);

const OPERATOR = /^(?:\?\?|&&|\|\||==|!=|<=|>=|[+\-*/%<>!?:=])/;

/**
 * One token of an expression, stopping before `end` (the quote that closes a CDL string, `$` in OCTL, nothing for a
 * bare expression).
 */
function expressionToken(stream: StringStream, end: string | null, octl: boolean): Token {
  if (stream.eatSpace()) {
    return null;
  }
  const ch = stream.peek();
  if (ch === undefined) {
    return null;
  }
  if (ch === "'" || (ch === '"' && end !== '"')) {
    stream.next();
    let escaped = false;
    let next: string | void;
    while ((next = stream.next()) !== undefined) {
      // An unclosed quote ends at the CDL string's closing quote; in OCTL a `$` inside quotes doesn't end anything.
      if (end !== null && !octl && !escaped && next === end && next !== ch) {
        stream.backUp(1);
        break;
      }
      if (next === ch && !escaped) {
        break;
      }
      escaped = !escaped && next === '\\';
    }
    return 'string';
  }
  if (stream.match(/^-?\d+(\.\d+)?/)) {
    return 'number';
  }
  if (stream.match(/^global:/)) {
    return 'ns';
  }
  if (octl && stream.match(/^(page|media|record|nav|dataset|set):/)) {
    return 'ns';
  }
  const word = stream.match(/^[A-Za-z_][\w]*/) as RegExpMatchArray | null;
  if (word) {
    const text = word[0];
    if (stream.peek() === '(' && (octl || FUNCTIONS.has(text))) {
      return 'fn';
    }
    if (octl) {
      if (OCTL_EXPR_WORDS.has(text)) {
        return text === 'true' || text === 'false' || text === 'null' ? 'atom' : 'operatorKeyword';
      }
      return OCTL_ROOT_NAMES.has(text) ? 'ctx' : 'variable';
    }
    if (EXPR_WORDS.has(text)) {
      return text === 'true' || text === 'false' || text === 'null' ? 'atom' : 'operatorKeyword';
    }
    return CONTEXT.has(text) ? 'ctx' : 'variable';
  }
  if (stream.match(OPERATOR)) {
    return 'operator';
  }
  if (ch === '(' || ch === ')' || ch === '[' || ch === ']') {
    stream.next();
    return 'bracket';
  }
  stream.next();
  return 'punctuation';
}

// ── CDL ───────────────────────────────────────────────────────────────

interface CdlState {
  /** Inside a block comment. */
  comment: boolean;
  /** Inside an expression string (after an expression key). */
  expression: boolean;
  /** The next string is an expression. */
  expressionNext: boolean;
  /** The next word is an editor type. */
  typeNext: boolean;
  depth: number;
  /** The depth of the open `fill { … }`, where `value` takes an expression; -1 outside. */
  fillDepth: number;
  fillPending: boolean;
}

export const cdlParser = {
  name: 'cdl',
  startState: (): CdlState => ({
    comment: false,
    expression: false,
    expressionNext: false,
    typeNext: false,
    depth: 0,
    fillDepth: -1,
    fillPending: false,
  }),
  copyState: (state: CdlState): CdlState => ({ ...state }),
  token(stream: StringStream, state: CdlState): Token {
    if (state.comment) {
      if (stream.skipTo('*/')) {
        stream.match('*/');
        state.comment = false;
      } else {
        stream.skipToEnd();
      }
      return 'comment';
    }
    if (state.expression) {
      if (stream.peek() === '"') {
        stream.next();
        state.expression = false;
        return 'string';
      }
      return expressionToken(stream, '"', false);
    }
    if (stream.eatSpace()) {
      return null;
    }
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.comment = true;
      return 'comment';
    }
    const ch = stream.peek();
    if (ch === '"') {
      stream.next();
      if (state.expressionNext) {
        state.expressionNext = false;
        state.expression = true;
        return 'string';
      }
      let escaped = false;
      let next: string | void;
      while ((next = stream.next()) !== undefined) {
        if (next === '"' && !escaped) {
          break;
        }
        escaped = !escaped && next === '\\';
      }
      return 'string';
    }
    if (stream.match(/^-?\d+(\.\d+)?/)) {
      return 'number';
    }
    const word = stream.match(/^[A-Za-z_][\w]*/) as RegExpMatchArray | null;
    if (word) {
      const text = word[0];
      if (state.typeNext) {
        state.typeNext = false;
        if (TYPES.has(text)) {
          return 'typeName';
        }
      }
      if (text === 'editor') {
        state.typeNext = true;
        return 'keyword';
      }
      if (text === 'fill') {
        state.fillPending = true;
        return 'keyword';
      }
      if (EXPRESSION_KEYS.has(text) && (text !== 'value' || state.fillDepth === state.depth)) {
        state.expressionNext = true;
        return 'propertyName';
      }
      if (STRUCTURE.has(text)) {
        return 'keyword';
      }
      if (ATTRIBUTES.has(text)) {
        return 'propertyName';
      }
      if (VALUES.has(text)) {
        return 'atom';
      }
      return 'variable';
    }
    stream.next();
    state.expressionNext = false;
    if (ch === '{') {
      state.depth++;
      if (state.fillPending) {
        state.fillPending = false;
        state.fillDepth = state.depth;
      }
      return 'bracket';
    }
    if (ch === '}') {
      if (state.fillDepth === state.depth) {
        state.fillDepth = -1;
      }
      state.depth = Math.max(0, state.depth - 1);
      return 'bracket';
    }
    if (ch === '[' || ch === ']' || ch === '(' || ch === ')') {
      return 'bracket';
    }
    return 'punctuation';
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } }, closeBrackets: { brackets: ['(', '[', '{', '"', "'"] } },
  tokenTable: TOKEN_TABLE,
};

export const cdlLanguage = StreamLanguage.define(cdlParser);

// ── OCTL ──────────────────────────────────────────────────────────────

interface OctlState {
  /** Inside a `$CMS_…$` instruction. */
  instruction: boolean;
  /** Inside `$CMS_COMMENT$ … $CMS_END_COMMENT$`. */
  comment: boolean;
}

export const octlParser = {
  name: 'octl',
  startState: (): OctlState => ({ instruction: false, comment: false }),
  copyState: (state: OctlState): OctlState => ({ ...state }),
  token(stream: StringStream, state: OctlState): Token {
    if (state.comment) {
      if (stream.match('$CMS_END_COMMENT$')) {
        state.comment = false;
        return 'meta';
      }
      if (!stream.skipTo('$CMS_END_COMMENT$')) {
        stream.skipToEnd();
      }
      return 'comment';
    }
    if (state.instruction) {
      if (stream.peek() === '$') {
        stream.next();
        state.instruction = false;
        return 'meta';
      }
      return expressionToken(stream, '$', true);
    }
    if (stream.match('$$')) {
      return null;
    }
    if (stream.match('$CMS_COMMENT$')) {
      state.comment = true;
      return 'meta';
    }
    if (stream.match(/^\$CMS_[A-Z_]+/)) {
      state.instruction = true;
      return 'tag';
    }
    // Passthrough text up to the next `$`.
    if (!stream.skipTo('$')) {
      stream.skipToEnd();
    } else if (stream.pos === stream.start) {
      stream.next();
    }
    return null;
  },
  tokenTable: TOKEN_TABLE,
};

export const octlLanguage = StreamLanguage.define(octlParser);

// ── Bare expressions (record set `where`) ─────────────────────────────

export const whereParser = {
  name: 'octl-expression',
  startState: () => ({}),
  token: (stream: StringStream): Token => expressionToken(stream, null, true),
  tokenTable: TOKEN_TABLE,
};

export const whereLanguage = StreamLanguage.define(whereParser);

// ── Folding ───────────────────────────────────────────────────────────

/** CDL blocks fold from a line ending in `{` to its matching `}`. */
export const cdlFolding: Extension = foldService.of((state: EditorState, lineStart: number, lineEnd: number) => {
  const text = state.doc.sliceString(lineStart, lineEnd);
  const open = text.lastIndexOf('{');
  if (open < 0 || text.indexOf('}', open) >= 0) {
    return null;
  }
  const from = lineStart + open + 1;
  const doc = state.doc.toString();
  let depth = 1;
  let inString = false;
  for (let i = from; i < doc.length; i++) {
    const c = doc[i];
    if (c === '"' && doc[i - 1] !== '\\') {
      inString = !inString;
    } else if (!inString && c === '{') {
      depth++;
    } else if (!inString && c === '}' && --depth === 0) {
      return state.doc.lineAt(i).number > state.doc.lineAt(lineStart).number ? { from, to: i } : null;
    }
  }
  return null;
});

const OCTL_BLOCKS: Record<string, string> = {
  CMS_IF: 'CMS_END_IF',
  CMS_FOR: 'CMS_END_FOR',
  CMS_BLOCK: 'CMS_END_BLOCK',
  CMS_NAVIGATION: 'CMS_END_NAVIGATION',
  CMS_COMMENT: 'CMS_END_COMMENT',
};

/** OCTL blocks fold from an opening instruction (`$CMS_IF(…)$`) to its `$CMS_END_…$`. */
export const octlFolding: Extension = foldService.of((state: EditorState, lineStart: number, lineEnd: number) => {
  const text = state.doc.sliceString(lineStart, lineEnd);
  const match = /\$(CMS_IF|CMS_FOR|CMS_BLOCK|CMS_NAVIGATION|CMS_COMMENT)\b[^$]*\$/.exec(text);
  if (!match) {
    return null;
  }
  const opener = match[1];
  const closer = OCTL_BLOCKS[opener];
  const from = lineStart + match.index + match[0].length;
  const doc = state.doc.toString();
  const pattern = new RegExp(`\\$(${opener}|${closer})\\b`, 'g');
  pattern.lastIndex = from;
  let depth = 1;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(doc)) !== null) {
    depth += found[1] === opener ? 1 : -1;
    if (depth === 0) {
      return state.doc.lineAt(found.index).number > state.doc.lineAt(lineStart).number
        ? { from, to: found.index }
        : null;
    }
  }
  return null;
});
