import { Directive, TemplateRef, inject, input } from '@angular/core';
import type { SfDataTableCellContext, SfDataTableHeaderContext } from './data-table.types';

/**
 * The cell template of one `sf-data-table` column (M35.8); without one the cell shows the column's `value` as text.
 *
 * ```html
 * <ng-template sfDataTableCell="status" [sfDataTableCellRows]="rows()" let-row let-value="value">
 *   <sf-status [status]="row.status" />
 * </ng-template>
 * ```
 *
 * `sfDataTableCellRows` is optional and only types `let-row` (pass the same rows as the table).
 */
@Directive({ selector: 'ng-template[sfDataTableCell]', standalone: true })
export class SfDataTableCellDirective<T> {
  readonly columnId = input.required<string>({ alias: 'sfDataTableCell' });
  /** Types the template context only. */
  readonly rows = input<readonly T[] | null>(null, { alias: 'sfDataTableCellRows' });
  readonly template = inject<TemplateRef<SfDataTableCellContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(_dir: SfDataTableCellDirective<T>, _ctx: unknown): _ctx is SfDataTableCellContext<T> {
    return true;
  }
}

/** A custom header of one column (`let-column`); sorting, the sort indicator and the resize handle stay the table's. */
@Directive({ selector: 'ng-template[sfDataTableHeader]', standalone: true })
export class SfDataTableHeaderDirective<T> {
  readonly columnId = input.required<string>({ alias: 'sfDataTableHeader' });
  readonly template = inject<TemplateRef<SfDataTableHeaderContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(
    _dir: SfDataTableHeaderDirective<T>,
    _ctx: unknown,
  ): _ctx is SfDataTableHeaderContext<T> {
    return true;
  }
}
