import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, computed, input, output, viewChild } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { CodeFormat, SfCodeEditorComponent } from '../code-editor/code-editor.component';

type Diagnostic = components['schemas']['Diagnostic'];

let nextId = 0;

/**
 * An OCTL source editor with its positioned diagnostics (M25.5.2, extracted from the Templates store's
 * channel editor): a code editor (M33: highlighting, completion on Ctrl+Space with the template's editor
 * names, diagnostics underlined in place) and, below it, one row per diagnostic whose `line:column` jumps
 * the caret to that position. Shared by section/page template channels and dataset record templates.
 *
 * <p>The editor holds no state of its own: the host owns the source (`value` in, `valueChange` out) and
 * the diagnostics, so live validation and save results stay the host's business. {@link insert} puts a
 * snippet at the caret (the record template's field helpers).
 */
@Component({
  selector: 'sf-octl-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfCodeEditorComponent, TranslocoPipe],
  templateUrl: './sf-octl-editor.component.html',
  styleUrl: './sf-octl-editor.component.scss',
})
export class SfOctlEditorComponent {
  /** The OCTL source shown. */
  readonly value = input.required<string>();
  /** The accessible name of the source editor, e.g. "Record template for channel html". */
  readonly label = input.required<string>();
  readonly diagnostics = input<readonly Diagnostic[]>([]);
  readonly readOnly = input(false);
  /** What completion offers inside an instruction: the template's editors, or the dataset's fields. */
  readonly names = input<readonly string[]>([]);
  /** The format of the text between the instructions (M33 follow-up; see `resolveCodeFormat`). */
  readonly format = input<CodeFormat>('PLAIN');
  /** An SVG template or file: XML completion offers SVG names. */
  readonly svg = input(false);

  /** Every edit, including an {@link insert}. */
  readonly valueChange = output<string>();

  private readonly code = viewChild.required(SfCodeEditorComponent);

  protected readonly diagnosticsId = `sf-octl-diagnostics-${nextId++}`;
  protected readonly hasErrors = computed(() => this.diagnostics().some((d) => d.severity === 'ERROR'));

  /** Moves the caret to a diagnostic's position; a diagnostic without a line leaves the editor alone. */
  goTo(diagnostic: Diagnostic): void {
    if (diagnostic.line) {
      this.code().goTo(diagnostic.line, diagnostic.column ?? 1);
    }
  }

  /**
   * Replaces the selection with `snippet` and leaves the caret `caret` characters into it (default: after it),
   * e.g. between `$CMS_IF(_first)$` and `$CMS_END_IF$`. Does nothing while read-only.
   */
  insert(snippet: string, caret: number = snippet.length): void {
    this.code().insert(snippet, caret);
  }
}
