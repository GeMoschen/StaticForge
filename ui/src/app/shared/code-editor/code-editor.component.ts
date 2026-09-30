import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import type { EditorView } from '@codemirror/view';
import { loadCodeEditorSetup, loadedCodeEditorSetup } from './code-editor.loader';
import type { CodeDiagnostic, CodeEditorController, CodeLanguage } from './code-editor.types';

export type { CodeDiagnostic, CodeLanguage } from './code-editor.types';

/**
 * A code editor (M33) on CodeMirror 6 for CDL, OCTL, record-set expressions and JSON: syntax highlighting (in CDL
 * also inside expression strings), completion on Ctrl+Space, the host's diagnostics underlined at their position
 * with the message on hover, line numbers, bracket matching and auto-closing, folding, search (Ctrl+F) and history.
 * Tab indents; Esc then Tab moves focus on. `compact` is a one- or two-line field (a `where` expression): no gutters.
 * CodeMirror loads as its own chunk the first time an editor opens.
 *
 * <p>The host owns the text (`value` in, `valueChange` out) and the diagnostics; setting `value` changes the text
 * without reporting it back as an edit.
 */
@Component({
  selector: 'sf-code-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="sf-code-editor" [class.sf-code-editor--compact]="compact()" [attr.data-language]="language()"></div>`,
  styles: `
    :host { display: block; }
    .sf-code-editor :where(.cm-editor) { min-height: var(--sf-code-min-height, 12rem); max-height: var(--sf-code-max-height, 36rem); }
    .sf-code-editor--compact :where(.cm-editor) { min-height: 0; max-height: 8rem; }
    .sf-code-editor :where(.cm-scroller) { overflow: auto; }
  `,
})
export class SfCodeEditorComponent implements AfterViewInit {
  readonly value = input.required<string>();
  readonly language = input.required<CodeLanguage>();
  /** The accessible name of the editor. */
  readonly label = input.required<string>();
  readonly diagnostics = input<readonly CodeDiagnostic[]>([]);
  readonly readOnly = input(false);
  /** Names completion offers besides the language's own words (editors, dataset fields). */
  readonly names = input<readonly string[]>([]);
  /** A one- or two-line field: no gutters, no folding. */
  readonly compact = input(false);
  readonly placeholder = input<string>('');
  /** Marks the content invalid for assistive technology (`aria-invalid`), e.g. while it has errors. */
  readonly invalid = input(false);
  /** Tab inserts a tab character, and indentation uses tabs (a text file's source). Default: two spaces. */
  readonly indentWithTabs = input(false);

  readonly valueChange = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private editor: CodeEditorController | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.editor?.destroy();
    });
    effect(() => {
      const value = this.value();
      untracked(() => this.editor?.setValue(value));
    });
    effect(() => {
      const readOnly = this.readOnly();
      untracked(() => this.editor?.setReadOnly(readOnly));
    });
    effect(() => {
      const text = this.placeholder();
      untracked(() => this.editor?.setPlaceholder(text));
    });
    effect(() => {
      const invalid = this.invalid();
      untracked(() => this.editor?.setInvalid(invalid));
    });
    effect(() => {
      const diagnostics = this.diagnostics();
      untracked(() => this.editor?.setDiagnostics(diagnostics));
    });
  }

  ngAfterViewInit(): void {
    const setup = loadedCodeEditorSetup();
    if (setup) {
      this.create(setup);
    } else {
      void loadCodeEditorSetup().then((module) => {
        if (!this.destroyed) {
          this.create(module);
        }
      });
    }
  }

  /** The editor's view, once created (for tests and hosts that need the text now). */
  get editorView(): EditorView | null {
    return this.editor?.view ?? null;
  }

  /** Moves the caret to a 1-based position and focuses the editor. */
  goTo(line: number, column = 1): void {
    if (line) {
      this.editor?.goTo(line, column);
    }
  }

  /** Replaces the selection with `snippet`, leaving the caret `caret` characters into it (default: after it). */
  insert(snippet: string, caret: number = snippet.length): void {
    if (!this.readOnly()) {
      this.editor?.insert(snippet, caret);
    }
  }

  focus(): void {
    this.editor?.focus();
  }

  private create(setup: NonNullable<ReturnType<typeof loadedCodeEditorSetup>>): void {
    this.editor = setup.createCodeEditor(this.host().nativeElement, {
      value: this.value(),
      language: this.language(),
      label: this.label(),
      readOnly: this.readOnly(),
      placeholder: this.placeholder(),
      compact: this.compact(),
      indentWithTabs: this.indentWithTabs(),
      invalid: this.invalid(),
      diagnostics: this.diagnostics(),
      names: () => this.names(),
      onChange: (value) => this.valueChange.emit(value),
    });
  }
}
