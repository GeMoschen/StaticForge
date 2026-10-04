import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfDialogComponent, SfDialogFooterDirective } from '../../shared/components/dialog/sf-dialog.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfTreeComponent } from '../../shared/components/sf-tree.component';
import type { SfTreeLoader, SfTreeNode } from '../../shared/components/tree/tree-model';

type FolderView = components['schemas']['FolderView'];

/** The id of the "Pages" node, which stands for the project root. */
const ROOT_NODE = '__root__';

/**
 * "Move to…" for pages and folders (M35.18): a dialog with the page folders as a lazily opened tree; the first node,
 * *Pages*, is the project root and the top-level folders follow it. A folder that is being moved — and everything inside it — cannot be the target (the server
 * would refuse it as a cycle), so those entries are shown but cannot be chosen. Emits the chosen folder's uuid, `null`
 * for the root.
 */
@Component({
  selector: 'sf-folder-move-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfTreeComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sf-dialog size="md" [title]="'pages.bulk.moveDialog.title' | transloco: { count: count() }" (closed)="cancelled.emit()">
      <p class="move__lead">{{ 'pages.bulk.moveDialog.lead' | transloco }}</p>
      <div class="move__tree">
        <sf-tree
          [label]="'pages.bulk.moveDialog.tree' | transloco"
          [loadChildren]="loader()"
          [selection]="selected() === null ? [] : [selected()!]"
          [multiselect]="false"
          [filterable]="false"
          [expandActions]="false"
          (open)="onOpen($event)"
        />
      </div>
      <ng-container sfDialogFooter>
        <sf-button variant="ghost" (click)="cancelled.emit()">{{ 'common.cancel' | transloco }}</sf-button>
        <sf-button [disabled]="selected() === null" (click)="choose()">{{ 'pages.bulk.moveDialog.choose' | transloco }}</sf-button>
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
export class FolderMoveDialogComponent {
  /** The folder tree: the fixed wrapper root as its single entry, as `ProjectContextStore.pageFolderTree()` holds it. */
  readonly tree = input.required<readonly FolderView[]>();
  /** Folders being moved: they and what lies inside them are not valid targets. */
  readonly excluded = input<readonly string[]>([]);
  readonly count = input(1);
  /** What the first node, the project root, is called; the Pages area's own name when omitted. */
  readonly rootLabel = input<string | null>(null);
  /** `false`: the root is listed but cannot be chosen (Templates: nothing lives directly in the top level, M35.21). */
  readonly rootSelectable = input(true);
  /** Further folders that cannot be chosen (Templates: the folders of another kind), with the hint shown beside them. */
  readonly unavailable = input<readonly string[]>([]);
  readonly unavailableHint = input<string | null>(null);

  readonly chosen = output<string | null>();
  readonly cancelled = output<void>();

  protected readonly selected = signal<string | null>(null);

  private readonly transloco = inject(TranslocoService);

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
        if (folder.uuid && this.excluded().includes(folder.uuid)) {
          mark(folder);
        } else {
          visit(folder.children ?? []);
        }
      }
    };
    visit(this.tree());
    return blocked;
  });

  protected readonly loader = computed<SfTreeLoader<FolderView>>(() => {
    const wrapper = this.tree()[0] ?? null;
    const rootLabel: string = this.rootLabel() ?? this.transloco.translate('pages.folder.root') ?? '';
    const blocked = this.blocked();
    const unavailable = new Set(this.unavailable());
    const rootSelectable = this.rootSelectable();
    const hint = this.unavailableHint();
    const toNode = (folder: FolderView): SfTreeNode<FolderView> => {
      const disabled = !!folder.uuid && blocked.has(folder.uuid);
      const other = !disabled && !!folder.uuid && unavailable.has(folder.uuid);
      return {
        id: folder.uuid ?? '',
        label: folder.displayName ?? folder.uid ?? '',
        icon: 'folder',
        secondary: disabled ? this.transloco.translate('pages.bulk.moveDialog.blocked') : other ? hint : null,
        hasChildren: (folder.children?.length ?? 0) > 0,
        draggable: false,
        droppable: false,
        data: folder,
      };
    };
    return (parent) => {
      if (parent === null) {
        // The project root comes first, the top-level folders beside it.
        const root: SfTreeNode<FolderView> = {
          id: ROOT_NODE,
          label: rootLabel,
          icon: 'home',
          secondary: rootSelectable ? null : hint,
          hasChildren: false,
          draggable: false,
          droppable: false,
        };
        return [root, ...(wrapper?.children ?? []).map(toNode)];
      }
      return (parent.data?.children ?? []).map(toNode);
    };
  });

  protected onOpen(node: SfTreeNode<FolderView>): void {
    if (this.blocked().has(node.id) || this.unavailable().includes(node.id) || (node.id === ROOT_NODE && !this.rootSelectable())) {
      return;
    }
    this.selected.set(node.id);
  }

  protected choose(): void {
    const id = this.selected();
    if (id !== null) {
      this.chosen.emit(id === ROOT_NODE ? null : id);
    }
  }
}
