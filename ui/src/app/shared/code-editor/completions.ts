import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import type { Text } from '@codemirror/state';
import {
  CDL_ATTRIBUTES,
  CDL_EDITOR_TYPES,
  CDL_EXPRESSION_KEYS,
  CDL_STRUCTURE,
  EXPRESSION_CONTEXT,
  EXPRESSION_FUNCTIONS,
  EXPRESSION_WORDS,
  OCTL_INSTRUCTIONS,
  OCTL_PREFIXES,
  OCTL_ROOTS,
  OCTL_WORDS,
} from './vocabulary';

/**
 * Completion for the code editors (M33), opened with Ctrl+Space: CDL keywords and values by position, the editor
 * paths the CDL declares (plus names a host passes, e.g. inherited editors), expression functions and context inside
 * expression strings; OCTL instructions after `$` and the template's editors inside an instruction; a record set's
 * `where` offers the dataset's fields.
 */

const LEVELS = ['hint', 'info', 'warning', 'error'];
const SCOPES = ['edit', 'save', 'release', 'generation'];
const WHOLE_TARGETS = ['page', 'section', 'record', 'global'];

/** The editors a CDL source declares, as `on`/`state`/`fill` targets: names, and `list[]` for lists. */
export function declaredPaths(doc: Text | string): string[] {
  const text = typeof doc === 'string' ? doc : doc.toString();
  const out = new Set<string>();
  for (const match of text.matchAll(/\beditor\s+([A-Za-z]+)\s+([A-Za-z_]\w*)/g)) {
    out.add(match[2]);
    if (match[1] === 'list') {
      out.add(`${match[2]}[]`);
    }
  }
  return [...out];
}

/**
 * Where the cursor is in a CDL line: inside a string (and after which key), or not. Strings don't span lines in
 * practice, so the line before the cursor is enough.
 */
export function cdlStringContext(before: string): { inString: boolean; key: string | null } {
  let inString = false;
  let start = -1;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (!inString && c === '/' && before[i + 1] === '/') {
      return { inString: false, key: null };
    }
    if (c === '"' && before[i - 1] !== '\\') {
      inString = !inString;
      start = i;
    }
  }
  if (!inString) {
    return { inString: false, key: null };
  }
  const key = /([A-Za-z_]\w*)\s*$/.exec(before.slice(0, start));
  return { inString: true, key: key ? key[1] : null };
}

function options(labels: readonly string[], type: string, boost = 0): Completion[] {
  return labels.map((label) => ({ label, type, boost }));
}

function functionOptions(): Completion[] {
  return EXPRESSION_FUNCTIONS.map((fn) => ({
    label: fn.name,
    type: 'function',
    detail: fn.signature,
    info: fn.info,
    apply: `${fn.name}(`,
    boost: 1,
  }));
}

/** CDL completion; `extraNames` are editor names the source doesn't declare itself (inherited ones). */
export function cdlCompletion(extraNames: () => readonly string[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w[\]]*/);
    const from = word ? word.from : context.pos;
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, from - line.from);
    if (/\/\//.test(before.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) {
      return null;
    }
    const paths = [...new Set([...declaredPaths(context.state.doc), ...extraNames()])];
    const string = cdlStringContext(before);
    if (string.inString) {
      if (!string.key || !(CDL_EXPRESSION_KEYS as readonly string[]).includes(string.key)) {
        return null; // a label, a message, a pattern: plain text
      }
      return {
        from,
        options: [
          ...functionOptions(),
          ...options(EXPRESSION_CONTEXT, 'variable'),
          ...options(paths.filter((p) => !p.endsWith('[]')), 'property', 2),
          ...options(EXPRESSION_WORDS, 'keyword', -1),
        ],
        validFor: /^\w*$/,
      };
    }
    const list = /([A-Za-z_]\w*)\s*\[[^\]]*$/.exec(before);
    const previous = list ? list[1] : (/([A-Za-z_]\w*)\s+$/.exec(before)?.[1] ?? null);
    let result: Completion[];
    switch (previous) {
      case 'editor':
        result = options(CDL_EDITOR_TYPES, 'type');
        break;
      case 'level':
        result = options(LEVELS, 'enum');
        break;
      case 'scope':
      case 'on':
        result = list ? options(SCOPES, 'enum') : [...options(paths, 'property', 2), ...options(WHOLE_TARGETS, 'enum')];
        break;
      case 'onGeneration':
        result = options(['holdBack', 'fail'], 'enum');
        break;
      case 'mode':
        result = options(['empty', 'always'], 'enum');
        break;
      case 'locales':
        result = list ? options(['default'], 'enum') : options(['all', '[default]'], 'enum');
        break;
      case 'state':
      case 'fill':
        result = options(paths, 'property', 2);
        break;
      default:
        result = [...options(CDL_STRUCTURE, 'keyword', 1), ...options(CDL_ATTRIBUTES, 'property')];
    }
    return { from, options: result, validFor: /^[\w[\]]*$/ };
  };
}

/** The start of a reference with a path: `#global.…`, `CMS_GLOBAL.…` or a reference prefix, then what was typed of the path. */
const REFERENCE_START = /(?<![\w:])(?:#|CMS_GLOBAL\.|(?:page|media|record|global|nav|dataset|set):)[\w:#./-]*/;

/** OCTL completion; `names` are the template's editor names (or a record template's dataset fields). */
export function octlCompletion(names: () => readonly string[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const tag = /\$(C(M(S(_[A-Z_]*)?)?)?)?$/.exec(before);
    if (tag) {
      return {
        from: context.pos - tag[0].length + 1,
        options: OCTL_INSTRUCTIONS.map((instruction) => ({
          label: instruction.name,
          type: 'keyword',
          info: instruction.info,
          apply: instruction.snippet,
        })),
        validFor: /^[A-Z_]*$/,
      };
    }
    const open = before.lastIndexOf('$CMS_');
    const inside = open >= 0 && !/^\$CMS_[A-Z_]*[^$]*\$/.test(before.slice(open));
    if (!inside) {
      return null;
    }
    // A reference (`#global.brand.accent`, `media:logo`, `page:/shop`) is one name though it holds `.` and `/`: the
    // names a host passes are matched against the whole reference typed so far, not only its last word.
    const reference = context.matchBefore(REFERENCE_START);
    const word = reference ?? context.matchBefore(/[\w:]*/);
    return {
      from: word ? word.from : context.pos,
      options: [
        ...options(names(), 'property', 2),
        ...options(OCTL_ROOTS, 'variable'),
        ...options(OCTL_PREFIXES, 'namespace'),
        ...options(OCTL_WORDS, 'keyword', -1),
      ],
      validFor: reference ? /^[\w:#./-]*$/ : /^[\w:]*$/,
    };
  };
}

/** Record set `where` completion: the dataset's fields and the expression words. */
export function whereCompletion(fields: () => readonly string[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/\w*/);
    return {
      from: word ? word.from : context.pos,
      options: [...options(fields(), 'property', 2), ...options(OCTL_WORDS, 'keyword')],
      validFor: /^\w*$/,
    };
  };
}
