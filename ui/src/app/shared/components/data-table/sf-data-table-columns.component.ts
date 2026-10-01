import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfCheckboxComponent } from '../forms/sf-checkbox.component';
import { SfButtonComponent } from '../sf-button.component';
import type { SfDataTableColumn } from './data-table.types';
import { isHideable } from './data-table.util';

export interface SfDataTableColumnMove {
  id: string;
  delta: -1 | 1;
}

/**
 * The column chooser of `sf-data-table` (M35.8), shown in its "Columns" popover: one row per column in display order
 * with a "Show" checkbox (columns that are not hideable, and the last visible one, can't be hidden) and buttons that
 * move it one place left / right. Focus stays on the moved column's button (or its other one at the ends).
 */
@Component({
  selector: 'sf-data-table-columns',
  standalone: true,
  imports: [SfButtonComponent, SfCheckboxComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="sf-data-table-columns" role="list">
      @for (column of columns(); track column.id; let first = $first; let last = $last) {
        <li class="sf-data-table-columns__item" [attr.data-column]="column.id">
          <sf-checkbox
            class="sf-data-table-columns__check"
            [aria-label]="'shared.dataTable.showColumn' | transloco: { name: column.header }"
            [value]="!hidden().has(column.id)"
            [disabled]="!canToggle(column)"
            (valueChange)="toggled.emit({ id: column.id, visible: $event })"
            >{{ column.header }}</sf-checkbox
          >
          <sf-button
            data-move="-1"
            variant="ghost"
            size="sm"
            icon="arrow_upward"
            [label]="'shared.dataTable.moveColumnLeft' | transloco: { name: column.header }"
            [disabled]="first"
            (click)="move(column.id, -1)"
          />
          <sf-button
            data-move="1"
            variant="ghost"
            size="sm"
            icon="arrow_downward"
            [label]="'shared.dataTable.moveColumnRight' | transloco: { name: column.header }"
            [disabled]="last"
            (click)="move(column.id, 1)"
          />
        </li>
      }
    </ul>
  `,
  styleUrl: './sf-data-table-columns.component.scss',
})
export class SfDataTableColumnsComponent<T> {
  /** Every column, in display order. */
  readonly columns = input.required<readonly SfDataTableColumn<T>[]>();
  readonly hidden = input.required<ReadonlySet<string>>();

  readonly toggled = output<{ id: string; visible: boolean }>();
  readonly moved = output<SfDataTableColumnMove>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly visibleCount = computed(() => this.columns().filter((c) => !this.hidden().has(c.id)).length);

  protected canToggle(column: SfDataTableColumn<T>): boolean {
    return isHideable(column) && (this.hidden().has(column.id) || this.visibleCount() > 1);
  }

  protected move(id: string, delta: -1 | 1): void {
    this.moved.emit({ id, delta });
    // The host has the new order now: render it, then keep focus on this column's buttons.
    this.changeDetector.detectChanges();
    const item = Array.from(this.host.querySelectorAll<HTMLElement>('[data-column]')).find((el) => el.dataset['column'] === id);
    const same = item?.querySelector<HTMLButtonElement>(`[data-move="${delta}"] button:not([disabled])`);
    const other = item?.querySelector<HTMLButtonElement>(`[data-move="${-delta}"] button`);
    (same ?? other)?.focus();
  }
}
