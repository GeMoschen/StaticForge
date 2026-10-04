import type { ContextMenuItem } from '../../services/context-menu.service';
import type { SfDataTableBulkAction, SfDataTableSelection } from './data-table.types';

/**
 * A table's bulk actions as the entries of its row menu (`rowMenu`): each acts on the rows the menu was opened for, so a
 * right click behaves like ticking those rows and pressing the bulk button. `danger` actions get a separator above.
 */
export function bulkActionsAsMenu<T>(actions: readonly SfDataTableBulkAction<T>[], rows: T[], keyOf: (row: T) => string): ContextMenuItem[] {
  const selection: SfDataTableSelection<T> = { keys: rows.map(keyOf), rows, allMatching: false, count: rows.length };
  return actions.flatMap((action) => [
    ...(action.variant === 'danger' ? [{ label: '', separator: true }] : []),
    { label: action.label, icon: action.icon, danger: action.variant === 'danger', action: () => action.action?.(selection) },
  ]);
}
