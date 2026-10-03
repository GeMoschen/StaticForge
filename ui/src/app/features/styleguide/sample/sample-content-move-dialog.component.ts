import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDialogRef, injectDialogData } from '../../../shared/components/dialog/dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../shared/components/dialog/sf-dialog.component';
import { SfRadioGroupComponent, SfRadioOption } from '../../../shared/components/forms/sf-radio-group.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfTreeComponent } from '../../../shared/components/sf-tree.component';
import { SfTreeLoader, SfTreeNode } from '../../../shared/components/tree/tree-model';
import { injectSampleText } from './changes/sample-area.util';
import { SampleContentEntry, contentChildren } from './sample-content-data';

/** The id of the top level in the folder picker. */
export const CONTENT_ROOT = '__root__';

/** A record set a record can move to: its id, name and where it lives. */
export interface SampleMoveSet {
  readonly id: string;
  readonly name: string;
  readonly folder: string;
}

export interface SampleContentMoveData {
  /** `folder`: a record set or folder goes to another folder; `records`: records go to another set of their dataset. */
  readonly mode: 'folder' | 'records';
  /** The dialog's title ("Move “Single origins” to…", "Move 2 records to…"). */
  readonly title: string;
  /** Where the items are now (a folder id, {@link CONTENT_ROOT}, or the set id): shown but not choosable. */
  readonly current: string;
  /** Folders that can't be the target (a moved folder and what lies inside it). */
  readonly blocked?: readonly string[];
  /** `records`: the other record sets of the same dataset. */
  readonly sets?: readonly SampleMoveSet[];
}

/**
 * The Move dialog of the Content area (M35.20, gate round 11). **Folder mode** (a record set's or folder's *Move…*, the
 * folder table's bulk *Move*): the folders as a tree to pick from, the top level first; where the item is now (and, for a
 * folder, itself and what lies inside it) is shown with a reason but can't be chosen. **Records mode** (the record
 * table's bulk *Move…* and the record editor's *Move…*): a list of the other record sets of the same dataset — a record
 * can't leave its dataset — or, when there are none, a note saying so. **Move** stays disabled until a target is chosen.
 * Closes with the target's id; Escape, × and Cancel close without one.
 */
@Component({
  selector: 'sf-sample-content-move-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfRadioGroupComponent, SfTreeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-content-move-dialog.component.html',
  styleUrl: './sample-content-move-dialog.component.scss',
})
export class SampleContentMoveDialogComponent {
  protected readonly data = injectDialogData<SampleContentMoveData>();
  private readonly ref = inject<SfDialogRef<string>>(SfDialogRef);
  protected readonly t = injectSampleText('styleguide.sample.contentMove');

  protected readonly selected = signal<string | null>(null);
  protected readonly selection = computed(() => (this.selected() === null ? [] : [this.selected()!]));

  protected readonly loader = computed<SfTreeLoader<SampleContentEntry>>(() => {
    const blocked = new Set(this.data.blocked ?? []);
    const reason = (id: string): string | null =>
      id === this.data.current ? this.t('current') : blocked.has(id) ? this.t('blocked') : null;
    const folders = (parent: string | null) => contentChildren(parent).filter((entry) => entry.kind === 'folder');
    const toNode = (entry: SampleContentEntry): SfTreeNode<SampleContentEntry> => ({
      id: entry.id,
      label: entry.name,
      icon: 'folder',
      secondary: reason(entry.id),
      hasChildren: folders(entry.id).length > 0,
      draggable: false,
      droppable: false,
      data: entry,
    });
    return (parent) =>
      parent === null
        ? [
            { id: CONTENT_ROOT, label: this.t('topLevel'), icon: 'home', secondary: reason(CONTENT_ROOT), draggable: false, droppable: false },
            ...folders(null).map(toNode),
          ]
        : folders(parent.id).map(toNode);
  });

  protected readonly setOptions = computed<SfRadioOption<string>[]>(() =>
    (this.data.sets ?? []).map((set) => ({ value: set.id, label: set.name, description: this.t('inFolder', { folder: set.folder }) })),
  );

  protected onOpen(node: SfTreeNode<SampleContentEntry>): void {
    if (node.id !== this.data.current && !(this.data.blocked ?? []).includes(node.id)) {
      this.selected.set(node.id);
    }
  }

  protected choose(): void {
    const target = this.selected();
    if (target !== null) {
      this.ref.close(target);
    }
  }

  protected cancel(): void {
    this.ref.close();
  }
}
