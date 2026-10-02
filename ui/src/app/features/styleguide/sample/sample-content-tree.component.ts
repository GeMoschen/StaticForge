import { ChangeDetectionStrategy, Component, afterNextRender, computed, effect, inject, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfMenuComponent, SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfTreeAction, SfTreeComponent, SfTreeCreateKind, SfTreeDeleteRequest } from '../../../shared/components/sf-tree.component';
import { SfTreeLoader, SfTreeNode } from '../../../shared/components/tree/tree-model';
import { SampleContentEntry, contentChildren, contentParentOf, contentPath } from './sample-content-data';
import { FAVORITES_NODE, SampleFavorite, contentFavorite } from './sample-favorites';
import { favoriteChildren, favoriteNodes, favoritesNode, isFavoriteNode } from './sample-favorites-nodes';
import type { ContextMenuItem } from '../../../shared/services/context-menu.service';
import { SampleState } from './sample-state';

/**
 * The Content tree (M35.20 mocked): folders and record sets — each set with its record count and, in developer mode,
 * its UID — with a filter and a New menu (folder, record set). Renaming, creating and deleting only say so.
 */
@Component({
  selector: 'sf-sample-content-tree',
  standalone: true,
  imports: [SfMenuComponent, SfTreeComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sample-tree' },
  styleUrl: './sample-tree-pane.scss',
  template: `
    <section class="pane" aria-labelledby="sample-content-title">
      <div class="pane__head">
        <span class="pane__title" id="sample-content-title">{{ 'styleguide.sample.content.title' | transloco }}</span>
        <sf-menu
          variant="secondary"
          size="sm"
          [text]="'styleguide.sample.tree.new' | transloco"
          [label]="'styleguide.sample.content.newLabel' | transloco"
          [items]="newItems()"
        />
      </div>
      <sf-tree
        class="pane__tree"
        [label]="'styleguide.sample.content.title' | transloco"
        [loadChildren]="loader()"
        [selection]="selection()"
        [multiselect]="false"
        [actions]="actions"
        [expandActions]="false"
        [menuItems]="menuItems"
        [allowAction]="allowAction"
        (open)="onOpen($event)"
        (rename)="state.notice()"
        (create)="state.notice()"
        (delete)="onDelete($event)"
      />
    </section>
  `,
})
export class SampleContentTreeComponent {
  protected readonly state = inject(SampleState);
  private readonly tree = viewChild.required<SfTreeComponent<SampleContentEntry>>(SfTreeComponent);
  protected readonly actions: readonly SfTreeAction[] = ['rename', 'delete', 'create'];
  /** The *Favorites* branch is a view: nothing in it is renamed, deleted or created. */
  protected readonly allowAction = (_action: SfTreeAction, nodes: readonly SfTreeNode<SampleContentEntry>[]): boolean =>
    !nodes.some((node) => isFavoriteNode(node.id));

  /** The context menu's *Add to favorites* / *Remove from favorites* for a folder or record set (M35.15). */
  protected readonly menuItems = (nodes: readonly SfTreeNode<SampleContentEntry>[]): ContextMenuItem[] => {
    const node = nodes.length === 1 ? nodes[0] : null;
    if (!node || isFavoriteNode(node.id) || !node.data) {
      return [];
    }
    const favorite = contentFavorite(node.data);
    return [
      {
        label: this.state.t(this.state.isFavoriteKey(favorite.key) ? 'favorites.remove' : 'favorites.add'),
        icon: 'star',
        action: () => this.state.toggleFavoriteOf(favorite),
      },
    ];
  };

  protected readonly loader = computed<SfTreeLoader<SampleContentEntry>>(() => {
    const dev = this.state.devMode();
    const records = this.state.records();
    const favorites = this.state.favorites();
    const label = this.state.t('favorites.node');
    return (parent) => {
      if (parent?.id === FAVORITES_NODE) {
        return favoriteNodes<SampleContentEntry>(favorites);
      }
      if (parent && isFavoriteNode(parent.id)) {
        return favoriteChildren<SampleContentEntry>(parent.id, favorites);
      }
      const nodes = contentChildren(parent?.id ?? null).map((entry) => {
        const isFolder = entry.kind === 'folder';
        return {
          id: entry.id,
          label: entry.name,
          icon: isFolder ? 'folder' : 'table_rows',
          secondary: dev ? entry.uid : null,
          badges: isFolder ? [] : [{ kind: 'badge', label: String(records.get(entry.id)?.length ?? 0) }],
          hasChildren: isFolder && (entry.children?.length ?? 0) > 0,
          droppable: isFolder,
          data: entry,
        } satisfies SfTreeNode<SampleContentEntry>;
      });
      return parent === null && favorites.length > 0 ? [favoritesNode<SampleContentEntry>(label), ...nodes] : nodes;
    };
  });

  /** The open folder or record set (a record selects its set). */
  protected readonly selection = computed(() => {
    if (this.state.favoritesOpen()) {
      return [FAVORITES_NODE];
    }
    const id = this.openId();
    return id === null ? [] : [id];
  });

  protected readonly newItems = computed<SfMenuItem[]>(() => [
    { id: 'folder', label: this.state.t('content.newFolder'), icon: 'create_new_folder', action: () => this.create('folder') },
    { id: 'set', label: this.state.t('content.newRecordSet'), icon: 'playlist_add', action: () => this.create('item') },
  ]);

  constructor() {
    // Keep the open folder or record set visible (expanding its ancestors; a folder itself too).
    let rendered = false;
    afterNextRender(() => {
      rendered = true;
      void this.reveal();
    });
    effect(() => {
      this.openId();
      if (rendered) {
        untracked(() => void this.reveal());
      }
    });
  }

  protected onOpen(node: SfTreeNode<SampleContentEntry>): void {
    if (isFavoriteNode(node.id)) {
      this.state.openFavoriteNode(node.data as unknown as SampleFavorite | undefined);
      return;
    }
    const entry = node.data!;
    if (entry.kind === 'folder') {
      this.state.openContentFolder(entry.id);
    } else {
      this.state.openRecordSet(entry.id);
    }
  }

  protected onDelete(request: SfTreeDeleteRequest<SampleContentEntry>): void {
    request.completed(() => this.state.notice('folder.restored'));
  }

  private openId(): string | null {
    return this.state.view() === 'contentfolder' ? this.state.contentFolderId() : this.state.recordSetId();
  }

  private create(kind: SfTreeCreateKind): void {
    const open = this.openId();
    const parent = this.state.view() === 'contentfolder' ? open : open === null ? null : contentParentOf(open);
    void this.tree().startCreate(parent, kind);
  }

  private async reveal(): Promise<void> {
    for (const entry of contentPath(this.openId()).filter((e) => e.kind === 'folder')) {
      await this.tree().expand(entry.id);
    }
  }
}
