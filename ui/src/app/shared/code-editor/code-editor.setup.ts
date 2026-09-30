import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { Diagnostic as CmDiagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
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
import { tags } from '@lezer/highlight';
import type { CodeDiagnostic, CodeEditorConfig, CodeEditorController } from './code-editor.types';
import { cdlCompletion, octlCompletion, whereCompletion } from './completions';
import { cdlFolding, cdlLanguage, octlFolding, octlLanguage, whereLanguage } from './languages';

/**
 * The CodeMirror side of {@link SfCodeEditorComponent} (M33), loaded as its own chunk the first time an editor opens:
 * extensions, theme, languages, completion and diagnostics.
 */

/** Marks a change that puts the host's `value` into the editor: not an edit to report back. */
const fromHost = Annotation.define<boolean>();

/** Syntax colors from the design tokens, so the editor follows the light and dark theme. */
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--sf-code-keyword)', fontWeight: '600' },
  { tag: tags.typeName, color: 'var(--sf-code-type)' },
  { tag: tags.propertyName, color: 'var(--sf-code-attr)' },
  { tag: tags.atom, color: 'var(--sf-code-atom)' },
  { tag: [tags.bool, tags.null], color: 'var(--sf-code-atom)' },
  { tag: tags.string, color: 'var(--sf-code-string)' },
  { tag: tags.number, color: 'var(--sf-code-number)' },
  { tag: tags.comment, color: 'var(--sf-code-comment)', fontStyle: 'italic' },
  { tag: [tags.operator, tags.operatorKeyword, tags.punctuation], color: 'var(--sf-code-operator)' },
  { tag: tags.function(tags.variableName), color: 'var(--sf-code-function)' },
  { tag: [tags.special(tags.variableName), tags.namespace], color: 'var(--sf-code-special)' },
  { tag: [tags.tagName, tags.meta], color: 'var(--sf-code-tag)', fontWeight: '600' },
]);

const theme = EditorView.theme({
  '&': {
    fontFamily: 'var(--sf-font-mono)',
    fontSize: 'var(--sf-text-sm)',
    color: 'var(--sf-ink)',
    backgroundColor: 'var(--sf-surface)',
    border: '1px solid var(--sf-line)',
    borderRadius: 'var(--sf-radius-sm)',
  },
  '&.cm-focused': { outline: '2px solid var(--sf-signal)', outlineOffset: '-1px' },
  '.cm-content': { caretColor: 'var(--sf-ink)', fontFamily: 'var(--sf-font-mono)' },
  '.cm-scroller': { fontFamily: 'var(--sf-font-mono)', lineHeight: '1.5' },
  '.cm-gutters': {
    backgroundColor: 'var(--sf-paper)',
    color: 'var(--sf-slate)',
    borderRight: '1px solid var(--sf-line)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--sf-line) 35%, transparent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--sf-signal) 22%, transparent) !important',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--sf-surface)',
    color: 'var(--sf-ink)',
    border: '1px solid var(--sf-line)',
    boxShadow: 'var(--sf-shadow-2)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'color-mix(in srgb, var(--sf-signal) 18%, transparent)',
    color: 'var(--sf-ink)',
  },
  '.cm-panels': { backgroundColor: 'var(--sf-paper)', color: 'var(--sf-ink)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--sf-jade) 25%, transparent)' },
});

/** Creates an editor in `parent`; the controller is how the component drives it. */
export function createCodeEditor(parent: HTMLElement, config: CodeEditorConfig): CodeEditorController {
  const editable = new Compartment();
  const placeholders = new Compartment();
  const readOnlyExtension = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: config.value,
      extensions: [
        baseExtensions(config),
        languageExtensions(config),
        editable.of(readOnlyExtension(config.readOnly)),
        placeholders.of(config.placeholder ? placeholderExtension(config.placeholder) : []),
        EditorView.contentAttributes.of({ 'aria-label': config.label, spellcheck: 'false' }),
        EditorView.updateListener.of((update) => {
          // Only edits are reported: text the host put in (`value`) is its own already.
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromHost))) {
            config.onChange(update.state.doc.toString());
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
    goTo(line, column) {
      view.dispatch({ selection: { anchor: positionOf(view.state, line, column) }, scrollIntoView: true });
      view.focus();
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
      view.destroy();
    },
  };
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
    syntaxHighlighting(highlightStyle),
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

function languageExtensions(config: CodeEditorConfig): Extension {
  const names = config.names;
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
