import { ChangeDetectionStrategy, Component, computed, ElementRef, input, output, viewChild } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { offsetForPosition } from '../../features/media/text-media.util';

type Diagnostic = components['schemas']['Diagnostic'];

let nextId = 0;

/**
 * An OCTL source editor with its positioned diagnostics (M25.5.2, extracted from the Templates store's
 * channel editor): a monospace textarea and, below it, one row per diagnostic whose `line:column` jumps
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
  templateUrl: './sf-octl-editor.component.html',
  styleUrl: './sf-octl-editor.component.scss',
})
export class SfOctlEditorComponent {
  /** The OCTL source shown. */
  readonly value = input.required<string>();
  /** The accessible name of the source textarea, e.g. "Record template for channel html". */
  readonly label = input.required<string>();
  readonly diagnostics = input<readonly Diagnostic[]>([]);
  readonly readOnly = input(false);

  /** Every edit, including an {@link insert}. */
  readonly valueChange = output<string>();

  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');

  protected readonly diagnosticsId = `sf-octl-diagnostics-${nextId++}`;
  protected readonly hasErrors = computed(() => this.diagnostics().some((d) => d.severity === 'ERROR'));

  protected onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLTextAreaElement).value);
  }

  /** Moves the caret to a diagnostic's position; a diagnostic without a line leaves the editor alone. */
  goTo(diagnostic: Diagnostic): void {
    const area = this.area().nativeElement;
    if (!diagnostic.line) {
      return;
    }
    const offset = offsetForPosition(area.value, diagnostic.line, diagnostic.column ?? 0);
    area.focus();
    area.setSelectionRange(offset, offset);
  }

  /**
   * Replaces the selection with `snippet` and leaves the caret `caret` characters into it (default: after it),
   * e.g. between `$CMS_IF(_first)$` and `$CMS_END_IF$`. Does nothing while read-only.
   */
  insert(snippet: string, caret: number = snippet.length): void {
    if (this.readOnly()) {
      return;
    }
    const area = this.area().nativeElement;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    const next = area.value.slice(0, start) + snippet + area.value.slice(end);
    area.value = next;
    area.focus();
    area.setSelectionRange(start + caret, start + caret);
    this.valueChange.emit(next);
  }
}
