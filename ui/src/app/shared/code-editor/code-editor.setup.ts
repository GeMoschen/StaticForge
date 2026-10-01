import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import {
  HighlightStyle,
  Language,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  languageDataProp,
  syntaxHighlighting,
} from '@codemirror/language';
import { Diagnostic as CmDiagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, Compartment, EditorState, Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import { Highlighter, tags } from '@lezer/highlight';
import type { CodeFormat } from './code-format';
import type { CodeDiagnostic, CodeEditorConfig, CodeEditorController } from './code-editor.types';
import { cdlCompletion, octlCompletion, whereCompletion } from './completions';
import { FormatSupport, loadFormat, loadedFormat, octlCompletionEverywhere } from './formats';
import { cdlFolding, cdlLanguage, octlFolding, octlLanguage, whereLanguage } from './languages';

/**
 * The CodeMirror side of {@link SfCodeEditorComponent} (M33), loaded as its own chunk the first time an editor opens:
 * extensions, theme, languages, completion and diagnostics. An OCTL editor highlights the text between its
 * instructions as a format (HTML, Markdown, …) once that format's grammar has loaded; until then, as plain OCTL.
 */

/** Marks a change that puts the host's `value` into the editor: not an edit to report back. */
const fromHost = Annotation.define<boolean>();

/** Syntax colors of CDL, OCTL, expressions and JSON, from the design tokens (light and dark theme). */
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--sf-code-keyword)', fontWeight: '600' },
  { tag: tags.typeName, color: 'var(--sf-code-type)' },
  { tag: tags.propertyName, color: 'var(--sf-code-attr)' },
  { tag: tags.atom, color: 'var(--sf-code-atom)' },
  { tag: [tags.bool, tags.null], color: 'var(--sf-code-atom)' },
  { tag: tags.string, color: 'var(--sf-code-string)' },
  { tag: tags.number, color: 'var(--sf-code-number)' },
  { tag: tags.comment, color: 'var(--sf-code-comment)', fontStyle: 'var(--sf-code-comment-style, italic)' },
  { tag: [tags.operator, tags.operatorKeyword, tags.punctuation], color: 'var(--sf-code-operator)' },
  { tag: tags.function(tags.variableName), color: 'var(--sf-code-function)' },
  { tag: [tags.special(tags.variableName), tags.namespace], color: 'var(--sf-code-special)' },
  { tag: [tags.tagName, tags.meta], color: 'var(--sf-code-tag)', fontWeight: '600' },
]);

/**
 * Syntax colors of the host format around OCTL (HTML, CSS, JavaScript, Markdown, JSON, XML, YAML): a palette of its
 * own, so the `$CMS_…$` instructions (colored by {@link highlightStyle}) stand out from the markup around them.
 */
const formatStyle = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket, tags.className, tags.typeName], color: 'var(--sf-code-fmt-tag)' },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--sf-code-fmt-attr)' },
  { tag: [tags.string, tags.attributeValue, tags.monospace], color: 'var(--sf-code-fmt-string)' },
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword, tags.definitionKeyword],
    color: 'var(--sf-code-fmt-keyword)',
  },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit, tags.color], color: 'var(--sf-code-fmt-number)' },
  { tag: tags.comment, color: 'var(--sf-code-fmt-comment)', fontStyle: 'var(--sf-code-comment-style, italic)' },
  {
    tag: [tags.processingInstruction, tags.documentMeta, tags.meta, tags.contentSeparator],
    color: 'var(--sf-code-fmt-comment)',
  },
  { tag: [tags.punctuation, tags.operator, tags.bracket, tags.separator], color: 'var(--sf-code-fmt-punct)' },
  { tag: tags.heading, color: 'var(--sf-code-fmt-tag)', fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--sf-code-fmt-attr)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--sf-danger)' },
]);

/** Whether a (sub)tree is OCTL's: the instructions, colored with the CDL/OCTL palette. */
const isOctl = (type: Parameters<NonNullable<Highlighter['scope']>>[0]) =>
  type.prop(languageDataProp) === (octlLanguage as Language).data;

/**
 * An OCTL editor's highlighters: the instructions in the CDL/OCTL palette, every other (sub)tree — the host format
 * and the languages nested in it (CSS and JavaScript inside HTML) — in the format palette.
 */
const octlHighlighters: Extension = [
  syntaxHighlighting({ style: highlightStyle.style, scope: isOctl }),
  syntaxHighlighting({ style: formatStyle.style, scope: (type) => !isOctl(type) }),
  // A plain highlighter doesn't bring its style sheet the way a HighlightStyle does.
  [highlightStyle.module, formatStyle.module].flatMap((module) => (module ? [EditorView.styleModule.of(module)] : [])),
];

const theme = EditorView.theme({
  '&': {
    fontFamily: 'var(--sf-font-mono)',
    fontSize: 'var(--sf-fs-13)',
    color: 'var(--sf-code-fg)',
    backgroundColor: 'var(--sf-code-bg)',
    // A host that frames the editor itself (sf-code-panel) sets these to none.
    border: 'var(--sf-code-border, 1px solid var(--sf-border-strong))',
    borderRadius: 'var(--sf-code-radius, var(--sf-radius-sm))',
    // Set by the host (a template editor asks for more); the compact field lowers them. Not in the component's own
    // styles: its encapsulation would need the attribute Angular never puts on CodeMirror's elements.
    minHeight: 'var(--sf-code-min-height, 12rem)',
    maxHeight: 'var(--sf-code-max-height, 36rem)',
    // A host that wants a fixed height (the template editors side by side) sets it; otherwise the editor grows with its text.
    height: 'var(--sf-code-height, auto)',
  },
  '&.cm-focused': { outline: '2px solid var(--sf-focus-ring)', outlineOffset: '-1px' },
  '.cm-content': { caretColor: 'var(--sf-code-fg)', fontFamily: 'var(--sf-font-mono)' },
  // drawSelection paints the caret itself (black by default): follow the theme's ink so it shows in dark mode.
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--sf-code-fg)' },
  '.cm-scroller': { fontFamily: 'var(--sf-font-mono)', lineHeight: '1.5', overflow: 'auto' },
  '.cm-gutters': {
    backgroundColor: 'var(--sf-code-gutter-bg)',
    color: 'var(--sf-code-gutter-fg)',
    borderRight: '1px solid var(--sf-border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--sf-code-active-line)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--sf-code-selection) !important',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--sf-surface-raised)',
    color: 'var(--sf-text)',
    border: '1px solid var(--sf-border)',
    boxShadow: 'var(--sf-elevation-2)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--sf-selection)',
    color: 'var(--sf-text)',
  },
  '.cm-panels': { backgroundColor: 'var(--sf-surface-sunken)', color: 'var(--sf-text)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--sf-success) 25%, transparent)' },
});

/** Creates an editor in `parent`; the controller is how the component drives it. */
export function createCodeEditor(parent: HTMLElement, config: CodeEditorConfig): CodeEditorController {
  const editable = new Compartment();
  const placeholders = new Compartment();
  const languages = new Compartment();
  const attributes = new Compartment();
  let destroyed = false;
  let wanted = `${config.format}:${config.svg}`;
  let cursor = '1:1';
  /** Tells the host where the caret is when that changed (selection changes are frequent: nothing else is done). */
  const reportCursor = (state: EditorState) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const column = head - line.from + 1;
    const next = `${line.number}:${column}`;
    if (next !== cursor) {
      cursor = next;
      config.onCursor?.(line.number, column);
    }
  };
  const readOnlyExtension = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: config.value,
      extensions: [
        baseExtensions(config),
        languages.of(languageExtensions(config, loadedFormat(config.format, config.svg))),
        editable.of(readOnlyExtension(config.readOnly)),
        placeholders.of(config.placeholder ? placeholderExtension(config.placeholder) : []),
        attributes.of(EditorView.contentAttributes.of({ 'aria-label': config.label, spellcheck: 'false' })),
        EditorView.updateListener.of((update) => {
          // Only edits are reported: text the host put in (`value`) is its own already.
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromHost))) {
            config.onChange(update.state.doc.toString());
          }
          if (config.onCursor && (update.selectionSet || update.docChanged)) {
            reportCursor(update.state);
          }
        }),
      ],
    }),
  });
  const controller: CodeEditorController = {
    view,
    setValue(value) {
      if (view.state.doc.toString() !== value) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: fromHost.of(true) });
      }
    },
    setReadOnly(readOnly) {
      view.dispatch({ effects: editable.reconfigure(readOnlyExtension(readOnly)) });
    },
    setLabel(label) {
      view.dispatch({
        effects: attributes.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' })),
      });
    },
    setPlaceholder(text) {
      view.dispatch({ effects: placeholders.reconfigure(text ? placeholderExtension(text) : []) });
    },
    setDiagnostics(diagnostics) {
      view.dispatch(setDiagnostics(view.state, toLint(view.state, diagnostics)));
    },
    setInvalid(invalid) {
      if (invalid) {
        view.contentDOM.setAttribute('aria-invalid', 'true');
      } else {
        view.contentDOM.removeAttribute('aria-invalid');
      }
    },
    setFormat(format, svg) {
      const next = `${format}:${svg}`;
      if (config.language !== 'octl' || next === wanted) {
        return;
      }
      wanted = next;
      applyFormat(format, svg);
    },
    goTo(line, column) {
      view.dispatch({ selection: { anchor: positionOf(view.state, line, column) }, scrollIntoView: true });
      view.focus();
    },
    openSearch() {
      openSearchPanel(view);
    },
    insert(snippet, caret) {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: snippet }, selection: { anchor: from + caret } });
      view.focus();
    },
    focus() {
      view.focus();
    },
    destroy() {
      destroyed = true;
      view.destroy();
    },
  };
  function applyFormat(format: CodeFormat, svg: boolean): void {
    const loaded = format === 'PLAIN' ? null : loadedFormat(format, svg);
    if (format === 'PLAIN' || loaded) {
      view.dispatch({ effects: languages.reconfigure(languageExtensions(config, loaded)) });
      return;
    }
    void loadFormat(format, svg).then((support) => {
      if (!destroyed && wanted === `${format}:${svg}`) {
        view.dispatch({ effects: languages.reconfigure(languageExtensions(config, support)) });
      }
    });
  }
  if (config.language === 'octl' && config.format !== 'PLAIN' && !loadedFormat(config.format, config.svg)) {
    applyFormat(config.format, config.svg);
  }
  controller.setDiagnostics(config.diagnostics);
  controller.setInvalid(config.invalid);
  return controller;
}

function baseExtensions(config: CodeEditorConfig): Extension {
  return [
    config.compact ? [] : [lineNumbers(), foldGutter(), highlightActiveLineGutter(), highlightActiveLine(), lintGutter()],
    history(),
    drawSelection(),
    indentOnInput(),
    indentUnit.of(config.indentWithTabs ? '\t' : '  '),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    search({ top: true }),
    config.language === 'octl' ? octlHighlighters : syntaxHighlighting(highlightStyle),
    theme,
    EditorView.lineWrapping,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
  ];
}

function languageExtensions(config: CodeEditorConfig, format: FormatSupport | null): Extension {
  const names = config.names;
  if (config.language === 'octl' && format && format.format !== 'PLAIN') {
    return [
      format.extension,
      octlFolding,
      octlCompletionEverywhere(octlCompletion(names)),
      autocompletion({ activateOnTyping: false }),
    ];
  }
  switch (config.language) {
    case 'cdl':
      return [cdlLanguage, cdlFolding, autocompletion({ activateOnTyping: false, override: [cdlCompletion(names)] })];
    case 'octl':
      return [octlLanguage, octlFolding, autocompletion({ activateOnTyping: false, override: [octlCompletion(names)] })];
    case 'where':
      return [whereLanguage, autocompletion({ activateOnTyping: false, override: [whereCompletion(names)] })];
    case 'json':
      return [json(), autocompletion({ activateOnTyping: false })];
  }
}

/** The document offset of a 1-based line and column, clamped to the document. */
export function positionOf(state: EditorState, line: number, column: number): number {
  const doc = state.doc;
  const number = Math.min(Math.max(1, line), doc.lines);
  const target = doc.line(number);
  return Math.min(target.from + Math.max(0, column - 1), target.to);
}

/** The host's diagnostics as editor marks: from the position to the end of the word there (at least one character). */
export function toLint(state: EditorState, diagnostics: readonly CodeDiagnostic[]): CmDiagnostic[] {
  const out: CmDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const line = diagnostic.line ?? 0;
    if (line < 1) {
      continue;
    }
    const from = positionOf(state, line, diagnostic.column ?? 1);
    const lineEnd = state.doc.lineAt(from).to;
    const word = /^[\w$"'.:-]+/.exec(state.doc.sliceString(from, lineEnd));
    const to = Math.min(lineEnd, from + Math.max(1, word ? word[0].length : 1));
    out.push({
      from,
      to: to > from ? to : Math.min(state.doc.length, from + 1),
      severity: diagnostic.severity === 'ERROR' ? 'error' : diagnostic.severity === 'INFO' ? 'info' : 'warning',
      message: diagnostic.code ? `${diagnostic.code}: ${diagnostic.message ?? ''}` : (diagnostic.message ?? ''),
    });
  }
  return out;
}
