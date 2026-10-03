import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { SfDialogRef, injectDialogData } from '../../../shared/components/dialog/dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../shared/components/dialog/sf-dialog.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfTreeComponent } from '../../../shared/components/sf-tree.component';
import type { SfTreeLoader, SfTreeNode } from '../../../shared/components/tree/tree-model';

type FolderView = components['schemas']['FolderView'];

/** The id of the top level ("All media") in the picker. */
const ROOT_NODE = '__root__';

export interface MediaMoveDialogData {
  /** The dialog's title ("Move 3 files", "Move folder “Brand”"). */
  readonly title: string;
  /** The folder tree: the fixed wrapper root as its single entry, as `ProjectContextStore.mediaFolderTree()` holds it. */
  readonly tree: readonly FolderView[];
  /** Where the items are now (`null`: the top level): shown with "Current folder" but not choosable. */
  readonly current: string | null;
  /** Folders being moved: they and what lies inside them can't be the target (the server would refuse it as a cycle). */
  readonly excluded: readonly string[];
}

/** What the dialog closes with: the chosen folder (`null`: the top level). */
export interface MediaMoveDialogResult {
  readonly target: string | null;
}

/**
 * The Move dialog (decision 94), one for a bulk move, a single file's *Move…* and a folder's *Move folder…*: the library's
 * folders as a tree to pick from, with *All media* (the top level) first. The current folder (and, for a folder, itself
 * and what lies inside it) is shown with a reason but can't be chosen; **Move** stays disabled until a target is chosen.
 */
@Component({
  selector: 'sf-media-move-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfTreeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sf-dialog size="md" [title]="data.title">
      <p class="move__lead">{{ t('lead') }}</p>
      <div class="move__tree">
        <sf-tree
          [label]="t('tree')"
          [loadChildren]="loader()"
          [selection]="selection()"
          [multiselect]="false"
          [filterable]="false"
          [expandActions]="false"
          (open)="onOpen($event)"
        />
      </div>
      <ng-container sfDialogFooter>
        <sf-button variant="ghost" (click)="cancel()">{{ t('cancel') }}</sf-button>
        <sf-button [disabled]="selected() === null" [disabledReason]="selected() === null ? t('chooseFirst') : null" (click)="choose()">{{
          t('confirm')
        }}</sf-button>
      </ng-container>
    </sf-dialog>
  `,
  styles: `
    .move__lead {
      margin: 0 0 var(--sf-space-3);
      color: var(--sf-text-muted);
    }

    .move__tree {
      block-size: 20rem;
      min-block-size: 0;
    }
  `,
})
export class MediaMoveDialogComponent {
  protected readonly data = injectDialogData<MediaMoveDialogData>();
  private readonly ref = inject<SfDialogRef<MediaMoveDialogResult>>(SfDialogRef);
  private readonly transloco = inject(TranslocoService);

  protected readonly selected = signal<string | null>(null);
  protected readonly selection = computed(() => (this.selected() === null ? [] : [this.selected()!]));

  /** Every folder that is being moved or lies inside one that is. */
  private readonly blocked = computed<ReadonlySet<string>>(() => {
    const blocked = new Set<string>();
    const mark = (folder: FolderView): void => {
      if (folder.uuid) {
        blocked.add(folder.uuid);
      }
      (folder.children ?? []).forEach(mark);
    };
    const visit = (folders: readonly FolderView[]): void => {
      for (const folder of folders) {
        if (folder.uuid && this.data.excluded.includes(folder.uuid)) {
          mark(folder);
        } else {
          visit(folder.children ?? []);
        }
      }
    };
    visit(this.data.tree);
    return blocked;
  });

  protected readonly loader = computed<SfTreeLoader<FolderView>>(() => {
    const wrapper = this.data.tree[0] ?? null;
    const blocked = this.blocked();
    const current = this.data.current ?? ROOT_NODE;
    const reason = (id: string): string | null =>
      id === current ? this.t('current') : blocked.has(id) ? this.t('blocked') : null;
    const toNode = (folder: FolderView): SfTreeNode<FolderView> => ({
      id: folder.uuid ?? '',
      label: folder.displayName ?? folder.uid ?? '',
      icon: 'folder',
      secondary: reason(folder.uuid ?? ''),
      hasChildren: (folder.children?.length ?? 0) > 0,
      draggable: false,
      droppable: false,
      data: folder,
    });
    return (parent) =>
      parent === null
        ? [
            { id: ROOT_NODE, label: this.t('topLevel'), icon: 'home', secondary: reason(ROOT_NODE), draggable: false, droppable: false },
            ...(wrapper?.children ?? []).map(toNode),
          ]
        : (parent.data?.children ?? []).map(toNode);
  });

  protected t(key: string): string {
    return this.transloco.translate(`media.move.${key}`);
  }

  protected onOpen(node: SfTreeNode<FolderView>): void {
    if (node.id !== (this.data.current ?? ROOT_NODE) && !this.blocked().has(node.id)) {
      this.selected.set(node.id);
    }
  }

  protected choose(): void {
    const id = this.selected();
    if (id !== null) {
      this.ref.close({ target: id === ROOT_NODE ? null : id });
    }
  }

  protected cancel(): void {
    this.ref.close();
  }
}
