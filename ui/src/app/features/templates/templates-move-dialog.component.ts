import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import { templateKindOfFolderPath } from '../../shared/asset-route.util';
import { FolderMoveDialogComponent } from '../pages/folder-move-dialog.component';
import { type TemplateEntry, folderSubtree } from './templates-tree.util';

type FolderView = components['schemas']['FolderView'];

/**
 * "Move to…" for templates, datasets and folders (M35.21, gate decision 157): the Pages folder picker with the top level
 * "Templates" listed but not choosable (nothing lives directly in it), and the folders of the other kinds greyed out —
 * page templates, section templates and datasets each keep to their own folders. A folder that is being moved, and
 * everything inside it, cannot be the target. Emits the chosen folder's uuid.
 */
@Component({
  selector: 'sf-templates-move-dialog',
  standalone: true,
  imports: [FolderMoveDialogComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sf-folder-move-dialog
      [tree]="tree()"
      [excluded]="excluded()"
      [unavailable]="unavailable()"
      [unavailableHint]="'templates.move.otherKind' | transloco"
      [rootSelectable]="false"
      [count]="entries().length"
      [rootLabel]="'templates.move.root' | transloco"
      (chosen)="onChosen($event)"
      (cancelled)="cancelled.emit()"
    />
  `,
})
export class TemplatesMoveDialogComponent {
  /** The folder tree as the store holds it: the fixed wrapper root as its single entry. */
  readonly tree = input.required<readonly FolderView[]>();
  readonly entries = input.required<readonly TemplateEntry[]>();

  readonly chosen = output<string>();
  readonly cancelled = output<void>();

  protected readonly excluded = computed(() => this.entries().filter((entry) => entry.kind === 'folder').map((entry) => entry.uuid));

  /** The folders of any kind but the moved items' own. */
  protected readonly unavailable = computed<string[]>(() => {
    const kinds = new Set(this.entries().map((entry) => entry.assetKind));
    const wrapper = this.tree()[0];
    return (wrapper?.children ?? []).flatMap((root) => (root.uuid && !(kinds.size === 1 && kinds.has(templateKindOfFolderPath(root.path))) ? folderSubtree(this.tree(), root.uuid) : []));
  });

  protected onChosen(target: string | null): void {
    if (target) {
      this.chosen.emit(target);
    }
  }
}
