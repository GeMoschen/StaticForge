import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDialogRef, injectDialogData } from '../../../../shared/components/dialog/dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfTreeComponent } from '../../../../shared/components/sf-tree.component';
import { SfTreeLoader, SfTreeNode } from '../../../../shared/components/tree/tree-model';
import { injectSampleText } from '../changes/sample-area.util';
import { SampleMediaFolder, mediaFolderChildren } from './sample-media-data';

/** The id of the top level in the picker (only offered when a folder is moved). */
export const MEDIA_ROOT = '__root__';

export interface SampleMoveDialogData {
  /** The dialog's title ("Move 3 files", "Move folder “Brand”"). */
  readonly title: string;
  /** Where the items are now: shown but not choosable ("Current folder"). */
  readonly current: string;
  /** Folders that can't be the target (a moved folder and what lies inside it). */
  readonly blocked: readonly string[];
  /** Offer the top level as a target. */
  readonly root: boolean;
}

/**
 * The Move dialog (decision 94), one for a bulk move, a single file's *Move…* and a folder's *Move folder…*: the folders as
 * a tree to pick from. The current folder (and, for a folder, itself and what lies inside it) is shown with a reason but
 * can't be chosen; **Move** stays disabled until a target is chosen. Closes with the target folder's id
 * ({@link MEDIA_ROOT} for the top level).
 */
@Component({
  selector: 'sf-sample-media-move-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfTreeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-move-dialog.component.html',
  styleUrl: './sample-media-move-dialog.component.scss',
})
export class SampleMediaMoveDialogComponent {
  protected readonly data = injectDialogData<SampleMoveDialogData>();
  private readonly ref = inject<SfDialogRef<string>>(SfDialogRef);
  protected readonly t = injectSampleText('styleguide.sample.media');

  protected readonly selected = signal<string | null>(null);
  protected readonly selection = computed(() => (this.selected() === null ? [] : [this.selected()!]));

  protected readonly loader = computed<SfTreeLoader<SampleMediaFolder>>(() => {
    const blocked = new Set(this.data.blocked);
    const reason = (id: string): string | null =>
      id === this.data.current ? this.t('move.current') : blocked.has(id) ? this.t('move.blocked') : null;
    const toNode = (folder: SampleMediaFolder): SfTreeNode<SampleMediaFolder> => ({
      id: folder.id,
      label: folder.name,
      icon: 'folder',
      secondary: reason(folder.id),
      hasChildren: (folder.children?.length ?? 0) > 0,
      draggable: false,
      droppable: false,
      data: folder,
    });
    return (parent) =>
      parent === null && this.data.root
        ? [
            {
              id: MEDIA_ROOT,
              label: this.t('move.topLevel'),
              icon: 'home',
              secondary: reason(MEDIA_ROOT),
              draggable: false,
              droppable: false,
            },
            ...mediaFolderChildren(null).map(toNode),
          ]
        : mediaFolderChildren(parent?.id ?? null).map(toNode);
  });

  protected onOpen(node: SfTreeNode<SampleMediaFolder>): void {
    if (node.id !== this.data.current && !this.data.blocked.includes(node.id)) {
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
