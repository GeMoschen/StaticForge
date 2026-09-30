import type { CompletionSource } from '@codemirror/autocomplete';
import { Language, LanguageSupport, defineLanguageFacet } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { Input, Parser, parseMixed } from '@lezer/common';
import type { CodeFormat } from './code-format';
import { octlLanguage } from './languages';
import { SVG_ATTRIBUTES, SVG_ELEMENTS } from './svg-vocabulary';

/**
 * OCTL over a format (M33 follow-up): a template or processed text file is OCTL instructions in a host format (HTML,
 * Markdown, JSON, XML, CSS, JavaScript, YAML). The OCTL tokenizer reads the whole text; the format's grammar parses
 * only the text between the instructions (an overlay), so `<a href="$CMS_REF(page:home)$">` is an attribute with an
 * OCTL value, not broken markup. Completion follows the position: inside an instruction OCTL's, elsewhere the
 * format's (HTML with CSS and JavaScript inside, CSS, JavaScript, XML closing tags, SVG names for SVG), and OCTL
 * instructions after `$` everywhere. Each format's grammar is its own chunk, loaded when first needed.
 */

/** A loaded format: its language support, built once per format (and SVG flag). */
export interface FormatSupport {
  format: CodeFormat;
  svg: boolean;
  /** The OCTL-over-format language plus the format's own extras (completion data, nested languages). */
  extension: Extension;
}

const cache = new Map<string, FormatSupport>();
const loading = new Map<string, Promise<FormatSupport>>();

/** The loaded support for a format, or `null` while it hasn't arrived (`PLAIN` has none: plain OCTL). */
export function loadedFormat(format: CodeFormat, svg = false): FormatSupport | null {
  return cache.get(key(format, svg)) ?? null;
}

/** Loads a format's grammar (once) and builds its OCTL-over-format language. */
export function loadFormat(format: CodeFormat, svg = false): Promise<FormatSupport> {
  const k = key(format, svg);
  const cached = cache.get(k);
  if (cached) {
    return Promise.resolve(cached);
  }
  let pending = loading.get(k);
  if (!pending) {
    pending = baseSupport(format, svg).then((base) => {
      const support: FormatSupport = { format, svg, extension: base ? octlOver(base, format) : [] };
      cache.set(k, support);
      return support;
    });
    loading.set(k, pending);
  }
  return pending;
}

function key(format: CodeFormat, svg: boolean): string {
  return svg && format === 'XML' ? 'SVG' : format;
}

/** The format's own language support; completion only where it helps (none for JSON, Markdown, YAML). */
async function baseSupport(format: CodeFormat, svg: boolean): Promise<LanguageSupport | null> {
  switch (format) {
    case 'HTML':
      return (await import('@codemirror/lang-html')).html({ autoCloseTags: false });
    case 'MARKDOWN':
      return (await import('@codemirror/lang-markdown')).markdown({ completeHTMLTags: false });
    case 'JSON':
      return (await import('@codemirror/lang-json')).json();
    case 'XML':
      return (await import('@codemirror/lang-xml')).xml(
        svg ? { autoCloseTags: false, elements: SVG_ELEMENTS, attributes: SVG_ATTRIBUTES } : { autoCloseTags: false },
      );
    case 'CSS':
      return (await import('@codemirror/lang-css')).css();
    case 'JAVASCRIPT':
      return (await import('@codemirror/lang-javascript')).javascript();
    case 'YAML':
      return (await import('@codemirror/lang-yaml')).yaml();
    case 'PLAIN':
      return null;
  }
}

/**
 * The text outside OCTL instructions and comments: what the format's grammar parses. `$$` is a literal dollar and
 * stays text; an instruction runs from `$CMS_` to the next `$` outside a quoted string (to the end when unclosed).
 */
export function textRanges(text: string, offset = 0): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let start = 0;
  let i = 0;
  const push = (to: number) => {
    if (to > start) {
      ranges.push({ from: offset + start, to: offset + to });
    }
  };
  while (i < text.length) {
    const dollar = text.indexOf('$', i);
    if (dollar < 0) {
      break;
    }
    if (text[dollar + 1] === '$') {
      i = dollar + 2;
      continue;
    }
    if (text.startsWith('$CMS_COMMENT$', dollar)) {
      push(dollar);
      const end = text.indexOf('$CMS_END_COMMENT$', dollar + 13);
      i = end < 0 ? text.length : end + 17;
      start = i;
      continue;
    }
    if (/^\$CMS_[A-Z_]/.test(text.slice(dollar, dollar + 6))) {
      push(dollar);
      let j = dollar + 5;
      let quote: string | null = null;
      for (; j < text.length; j++) {
        const c = text[j];
        if (quote) {
          if (c === '\\') {
            j++;
          } else if (c === quote) {
            quote = null;
          }
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === '$') {
          break;
        }
      }
      i = Math.min(text.length, j + 1);
      start = i;
      continue;
    }
    i = dollar + 1;
  }
  push(text.length);
  return ranges;
}

function read(input: Input, from: number, to: number): string {
  return input.read(from, to);
}

/** The OCTL language with `base` parsing the text between the instructions. */
function octlOver(base: LanguageSupport, format: CodeFormat): Extension {
  const baseParser = base.language.parser;
  const wrap = parseMixed((node, input) => {
    if (!node.type.isTop || node.from !== 0) {
      return null;
    }
    const ranges = textRanges(read(input, node.from, node.to), node.from);
    return ranges.length ? { parser: baseParser, overlay: ranges } : null;
  });
  const outer = octlLanguage.parser;
  const parser = new (class extends Parser {
    createParse(...[input, fragments, ranges]: Parameters<Parser['createParse']>) {
      return wrap(outer.createParse(input, fragments, ranges), input, fragments, ranges);
    }
  })();
  // The outer tree is OCTL's (its data facet is on the top node), so this language's own facet is only its identity.
  const language = new Language(defineLanguageFacet(), parser, [], `octl-${format.toLowerCase()}`);
  return [language.extension, base.support];
}

/** Adds OCTL completion at every position (it answers only after `$` or inside an instruction). */
export function octlCompletionEverywhere(source: CompletionSource): Extension {
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}
