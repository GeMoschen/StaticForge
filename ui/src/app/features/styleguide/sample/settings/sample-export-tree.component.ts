import { ChangeDetectionStrategy, Component, inject, input, model, signal } from '@angular/core';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { ExportNode, exportLeaves } from './settings-data';
import { SettingsState } from './settings-state';

/**
 * The export selection: a checkbox tree of the stores (named by the store, never "/ ROOT") and their folders. A store's
 * checkbox ticks or clears all its folders and shows the mixed state when only some are ticked; each store expands
 * with a disclosure button. The value is the ticked folder ids.
 *
 * `sf-tree` has no checkbox mode yet (its selection is the row selection), so the sample builds the tree from
 * `sf-checkbox`es; M35.25 decides whether `sf-tree` gets one.
 */
@Component({
  selector: 'sf-sample-export-tree',
  standalone: true,
  imports: [SfButtonComponent, SfCheckboxComponent, SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-export-tree.component.html',
  styleUrl: './sample-export-tree.component.scss',
})
export class SampleExportTreeComponent {
  protected readonly t = inject(SettingsState).t;

  readonly nodes = input.required<readonly ExportNode[]>();
  readonly selection = model<readonly string[]>([]);

  /** Collapsed stores (all start expanded). */
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());

  protected name(node: ExportNode): string {
    return node.children ? this.t(`stores.${node.store}`) : node.name;
  }

  protected state(node: ExportNode): 'all' | 'some' | 'none' {
    const leaves = exportLeaves(node);
    const ticked = leaves.filter((l) => this.selection().includes(l.id)).length;
    return ticked === 0 ? 'none' : ticked === leaves.length ? 'all' : 'some';
  }

  protected total(node: ExportNode): number {
    return exportLeaves(node).reduce((sum, l) => sum + (l.count ?? 0), 0);
  }

  protected toggle(node: ExportNode, on: boolean): void {
    const ids = exportLeaves(node).map((l) => l.id);
    this.selection.update((sel) => (on ? [...new Set([...sel, ...ids])] : sel.filter((id) => !ids.includes(id))));
  }

  protected toggleExpanded(id: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }
}
