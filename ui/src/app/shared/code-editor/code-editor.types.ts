import type { EditorView } from '@codemirror/view';

/** What a code editor edits. */
export type CodeLanguage = 'cdl' | 'octl' | 'where' | 'json';

/** A positioned finding (`Diagnostic` on the wire: 1-based line and column). */
export interface CodeDiagnostic {
  severity?: string;
  code?: string;
  message?: string;
  line?: number;
  column?: number;
}

/** How an editor is created: its initial state and where it reports edits. */
export interface CodeEditorConfig {
  value: string;
  language: CodeLanguage;
  label: string;
  readOnly: boolean;
  placeholder: string;
  compact: boolean;
  indentWithTabs: boolean;
  invalid: boolean;
  diagnostics: readonly CodeDiagnostic[];
  /** The names completion offers, read when it opens. */
  names: () => readonly string[];
  onChange: (value: string) => void;
}

/** What the component drives a created editor with. */
export interface CodeEditorController {
  readonly view: EditorView;
  setValue(value: string): void;
  setReadOnly(readOnly: boolean): void;
  setPlaceholder(text: string): void;
  setDiagnostics(diagnostics: readonly CodeDiagnostic[]): void;
  setInvalid(invalid: boolean): void;
  goTo(line: number, column: number): void;
  insert(snippet: string, caret: number): void;
  focus(): void;
  destroy(): void;
}
