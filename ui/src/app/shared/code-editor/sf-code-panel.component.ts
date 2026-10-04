import { ChangeDetectionStrategy, Component, computed, input, output, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfStatusComponent, SfStatusTone } from '../components/display/sf-status.component';
import { SfButtonComponent } from '../components/sf-button.component';
import { SfIconComponent } from '../components/sf-icon.component';
import { SfCodeEditorComponent } from './code-editor.component';
import type { CodeFormat } from './code-format';
import { codeFormatterFor } from './code-formatter';
import type { CodeDiagnostic, CodeLanguage } from './code-editor.types';

/** One row of the diagnostics list. */
export interface CodePanelProblem {
  readonly diagnostic: CodeDiagnostic;
  readonly rank: number;
  readonly tone: SfStatusTone;
  /** `shared.codePanel.severity.*` key. */
  readonly severityKey: string;
  readonly line: number | null;
  readonly column: number;
}

const SEVERITIES: Record<string, Pick<CodePanelProblem, 'rank' | 'tone' | 'severityKey'>> = {
  ERROR: { rank: 0, tone: 'danger', severityKey: 'shared.codePanel.severity.error' },
  WARNING: { rank: 1, tone: 'warning', severityKey: 'shared.codePanel.severity.warning' },
  INFO: { rank: 2, tone: 'info', severityKey: 'shared.codePanel.severity.info' },
};

let nextId = 0;

/**
 * A code editor in IDE-style chrome (M35.9, decision 16): a header strip with the file name, the language and the
 * Format and Find actions; the {@link SfCodeEditorComponent} (gutter with line numbers and fold markers, active line,
 * bracket matching, the diagnostics underlined); below it a collapsible list of the diagnostics — errors first, a row
 * jumps to its position — and a status line with the caret position, the error and warning counts and the language.
 *
 * It fills the height its container gives it (the editor takes what the header, list and status line leave), and
 * follows the theme and density through the tokens. The host owns the text: `value` in, `valueChange` out (also for
 * Format). Format shows when `formattable` is set, the language has a formatter (`code-formatter.ts`: CDL and JSON)
 * and the editor is not read-only.
 *
 * ```html
 * <sf-code-panel fileName="page.cdl" languageLabel="CDL" language="cdl" label="Content definition"
 *   [value]="source()" [diagnostics]="diagnostics()" [formattable]="true" (valueChange)="source.set($event)" />
 * ```
 */
@Component({
  selector: 'sf-code-panel',
  standalone: true,
  imports: [SfButtonComponent, SfCodeEditorComponent, SfIconComponent, SfStatusComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-code-panel.component.html',
  styleUrl: './sf-code-panel.component.scss',
})
export class SfCodePanelComponent {
  /** Shown in the header strip, e.g. `article.cdl`, `html.octl`. */
  readonly fileName = input.required<string>();
  /** The language as the header and the status line name it, e.g. `CDL`, `OCTL · HTML`. */
  readonly languageLabel = input.required<string>();
  readonly value = input.required<string>();
  readonly language = input.required<CodeLanguage>();
  /** The editor's accessible name. */
  readonly label = input.required<string>();
  /** For `octl`: the host format of the text between the instructions. */
  readonly format = input<CodeFormat>('PLAIN');
  /** For `octl` with format `XML`: an SVG file, so completion offers SVG elements and attributes. */
  readonly svg = input(false);
  /** Names completion offers besides the language's own words (global values, media UIDs, page paths). */
  readonly names = input<readonly string[]>([]);
  readonly diagnostics = input<readonly CodeDiagnostic[]>([]);
  readonly readOnly = input(false);
  /** Offers a Format button (when the language has a formatter). */
  readonly formattable = input(false);

  readonly valueChange = output<string>();

  private readonly editor = viewChild.required(SfCodeEditorComponent);

  protected readonly listId = `sf-code-panel-problems-${nextId++}`;
  /** The caret, 1-based. */
  readonly cursor = signal({ line: 1, column: 1 });
  readonly problemsOpen = signal(true);
  /** A short message of the last action in the status line (a live region), e.g. that Format failed; a key. */
  readonly notice = signal<string | null>(null);

  protected readonly canFormat = computed(
    () => this.formattable() && !this.readOnly() && codeFormatterFor(this.language()) !== null,
  );

  /** The diagnostics as list rows: errors, then warnings, then the rest; by position within each. */
  readonly problems = computed<CodePanelProblem[]>(() =>
    this.diagnostics()
      .map((diagnostic) => ({
        diagnostic,
        ...(SEVERITIES[(diagnostic.severity ?? '').toUpperCase()] ?? SEVERITIES['INFO']),
        line: diagnostic.line && diagnostic.line > 0 ? diagnostic.line : null,
        column: diagnostic.column && diagnostic.column > 0 ? diagnostic.column : 1,
      }))
      .sort((a, b) => a.rank - b.rank || (a.line ?? 0) - (b.line ?? 0) || a.column - b.column),
  );
  protected readonly errorCount = computed(() => this.problems().filter((p) => p.rank === 0).length);
  protected readonly warningCount = computed(() => this.problems().filter((p) => p.rank === 1).length);

  protected edited(text: string): void {
    this.notice.set(null);
    this.valueChange.emit(text);
  }

  /** Formats the text in the editor; the edit is reported (and undoable) like any other. */
  formatCode(): void {
    const formatter = codeFormatterFor(this.language());
    const view = this.editor().editorView;
    if (!formatter || !view || this.readOnly()) {
      return;
    }
    const text = view.state.doc.toString();
    const formatted = formatter(text);
    this.notice.set(formatted === null ? 'shared.codePanel.formatFailed' : null);
    if (formatted === null || formatted === text) {
      return;
    }
    const head = Math.min(view.state.selection.main.head, formatted.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
      selection: { anchor: head },
      userEvent: 'input.format',
    });
    view.focus();
  }

  /** Opens the editor's search panel. */
  find(): void {
    this.editor().openSearch();
  }

  /** Moves the caret to a position (1-based) and focuses the editor. */
  goTo(line: number, column = 1): void {
    this.editor().goTo(line, column);
  }

  /** Inserts a snippet at the caret (replacing the selection), with the caret `caret` characters into it. */
  insert(snippet: string, caret: number = snippet.length): void {
    this.editor().insert(snippet, caret);
  }

  /** Moves the focus into the editor. */
  focus(): void {
    this.editor().focus();
  }

  /** Moves the caret to a diagnostic and focuses the editor. */
  jump(problem: CodePanelProblem): void {
    if (problem.line) {
      this.editor().goTo(problem.line, problem.column);
    } else {
      this.editor().focus();
    }
  }

  protected toggleProblems(): void {
    this.problemsOpen.update((open) => !open);
  }
}
