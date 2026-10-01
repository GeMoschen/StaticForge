import type { EditorView } from '@codemirror/view';
import type { CodeFormat } from './code-format';

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
  /** For `octl`: the format the text between the instructions is highlighted as (`PLAIN`: none). */
  format: CodeFormat;
  /** For `octl` with format `XML`: offer SVG element and attribute names. */
  svg: boolean;
  /** The names completion offers, read when it opens. */
  names: () => readonly string[];
  onChange: (value: string) => void;
  /** Where the caret moved (1-based line and column); called only when it changes. */
  onCursor?: (line: number, column: number) => void;
}

/** What the component drives a created editor with. */
export interface CodeEditorController {
  readonly view: EditorView;
  setValue(value: string): void;
  setReadOnly(readOnly: boolean): void;
  /** Renames the editor for assistive technology (`aria-label`). */
  setLabel(label: string): void;
  setPlaceholder(text: string): void;
  setDiagnostics(diagnostics: readonly CodeDiagnostic[]): void;
  setInvalid(invalid: boolean): void;
  /** Switches an `octl` editor's host format; loads the format's grammar first when needed. */
  setFormat(format: CodeFormat, svg: boolean): void;
  goTo(line: number, column: number): void;
  /** Opens the search panel (as Ctrl+F does). */
  openSearch(): void;
  insert(snippet: string, caret: number): void;
  focus(): void;
  destroy(): void;
}
