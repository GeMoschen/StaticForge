import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormArray, FormControl, FormGroup } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { MOVE_SECTION_SHORTCUTS } from '../../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import { ToastService } from '../../../core/ui/toast.service';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { sfUniqueId } from '../../../shared/components/forms/sf-field-context';
import { SfEditorBase } from '../editor-base';
import { SfEditorOutlet } from '../editor-outlet.component';
import { EditorDefinition } from '../form.model';
import { buildRowGroup } from '../form-builder.service';

/**
 * The LIST editor (M35.17): rows of the same fields, each row in a bordered panel with a drag handle, the row's editors
 * (through the outlet, so every editor type works inside a row) and a remove button.
 *
 * - **Add** at the end (until `max`); **remove** with an Undo toast that puts the row back where it was (not below `min`).
 * - **Reorder** by dragging the handle or with `Alt+↑` / `Alt+↓` on it; the handle keeps the focus and the move is
 *   announced politely. The keys are listed on the `?` sheet through the shortcut registry.
 * - The minimum and maximum row counts are findings under the list; an empty required list says so once.
 * - Read-only: the rows without handles and buttons.
 */
@Component({
  selector: 'sf-list-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfButtonComponent, SfIconComponent, SfEditorOutlet, TranslocoPipe],
  templateUrl: './list-editor.component.html',
  styleUrl: './list-editor.component.scss',
})
export class SfListEditor extends SfEditorBase<FormArray> {
  private readonly toasts = inject(ToastService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly documentedKeys = inject(ShortcutService).use(MOVE_SECTION_SHORTCUTS);

  protected readonly helpId = sfUniqueId('sf-list-help');
  protected readonly dragFrom = signal<number | null>(null);
  protected readonly overAt = signal<number | null>(null);
  protected readonly announcement = signal('');

  readonly readOnly = computed(() => !!this.definition().readOnly);

  readonly canAdd = computed(() => {
    const max = this.definition().max;
    this.changes();
    return !this.readOnly() && (max == null || this.control().length < max);
  });

  readonly canRemove = computed(() => {
    const min = this.definition().min ?? 0;
    this.changes();
    return !this.readOnly() && this.control().length > min;
  });

  readonly count = computed(() => {
    this.changes();
    return this.control().length;
  });

  rowControl(row: unknown, item: EditorDefinition): FormControl | FormGroup | FormArray {
    return (row as FormGroup).get(item.name) as FormControl | FormGroup | FormArray;
  }

  addRow(): void {
    this.control().push(buildRowGroup(this.definition().items ?? []));
    this.control().markAsDirty();
    this.changeDetector.detectChanges();
    this.focusRow(this.control().length - 1);
  }

  /** Removes the row and offers Undo, which puts the same row back at the same place. */
  removeRow(index: number): void {
    const array = this.control();
    const removed = array.at(index);
    array.removeAt(index);
    array.markAsDirty();
    this.toasts.undo(this.transloco.translate('forms.list.removed', { n: index + 1 }), () => {
      array.insert(Math.min(index, array.length), removed);
      array.markAsDirty();
    });
  }

  move(index: number, delta: number): void {
    const target = index + delta;
    const array = this.control();
    if (target < 0 || target >= array.length) {
      return;
    }
    const control = array.at(index);
    array.removeAt(index);
    array.insert(target, control);
    array.markAsDirty();
    this.announcement.set(this.transloco.translate('forms.list.moved', { n: target + 1, count: array.length }));
    // Render now so the handle at its new place exists before it takes the focus.
    this.changeDetector.detectChanges();
    this.focusHandle(target);
  }

  protected onHandleKeydown(event: KeyboardEvent, index: number): void {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) {
      return;
    }
    event.preventDefault();
    this.move(index, event.key === 'ArrowUp' ? -1 : 1);
  }

  protected onDragOver(event: DragEvent, index: number): void {
    if (this.dragFrom() !== null) {
      event.preventDefault();
      this.overAt.set(index);
    }
  }

  protected onDrop(event: DragEvent, index: number): void {
    event.preventDefault();
    const from = this.dragFrom();
    if (from !== null && from !== index) {
      this.move(from, index - from);
    }
    this.endDrag();
  }

  protected endDrag(): void {
    this.dragFrom.set(null);
    this.overAt.set(null);
  }

  private focusHandle(index: number): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[data-sf-list-handle="${index}"]`)?.focus();
  }

  private focusRow(index: number): void {
    this.host.nativeElement
      .querySelectorAll<HTMLElement>('.sf-list__items')
      [index]?.querySelector<HTMLElement>('input, textarea, select, button')
      ?.focus();
  }
}
