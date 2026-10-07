import { ChangeDetectionStrategy, Component, afterNextRender, computed, effect, inject, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { SfMenuComponent, SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import {
  SfTreeAction,
  SfTreeComponent,
  SfTreeCreateKind,
  SfTreeDeleteRequest,
  SfTreeMoveRequest,
} from '../../../shared/components/sf-tree.component';
import { SfTreeLoader, SfTreeNode } from '../../../shared/components/tree/tree-model';
import { SampleContentEntry, contentChildren, contentParentOf, contentPath } from './sample-content-data';
import { FAVORITES_NODE, SampleFavorite, contentFavorite } from './sample-favorites';
import { favoriteChildren, favoriteNodes, favoritesNode, isFavoriteNode } from './sample-favorites-nodes';
import type { ContextMenuItem } from '../../../shared/services/context-menu.service';
import { releaseContent } from './sample-content-release';
import { SampleState } from './sample-state';

/**
 * The Content tree (M35.20 mocked): folders and record sets — each set with its record count and, in developer mode,
 * its UID — with a filter and a New menu (folder, record set). A folder is created in place; *New record set* opens a
 * dialog (name and dataset, none preselected — gate round 10, awaiting sign-off). Renaming, creating and deleting only
 * say so. Gate round 11: the one menu also has **Cut**, **Paste** and **Move to…** (the folder Move dialog), and a record
 * set's menu **New record**, **History** and **Used by**.
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
        clipboardScope="sample:content"
        [actions]="actions"
        [createKinds]="createKinds"
        [expandActions]="false"
        [menuItems]="menuItems"
        [emptyMenuItems]="rootMenuItems"
        [allowAction]="allowAction"
        (emptyClick)="state.openContentFolder(null)"
        (open)="onOpen($event)"
        (rename)="state.notice()"
        (create)="state.notice()"
        (delete)="onDelete($event)"
        (move)="onMove($event)"
        (moveTo)="onMoveTo($event)"
      />
    </section>
  `,
})
export class SampleContentTreeComponent {
  protected readonly state = inject(SampleState);
  private readonly toasts = inject(ToastService);
  private readonly tree = viewChild.required<SfTreeComponent<SampleContentEntry>>(SfTreeComponent);
  protected readonly actions: readonly SfTreeAction[] = ['rename', 'delete', 'move', 'copy', 'create'];
  /** Folders are created in place; a record set needs a dataset, so it has its own dialog (*New record set*). */
  protected readonly createKinds: readonly SfTreeCreateKind[] = ['folder'];
  /**
   * The *Favorites* branch is a view: nothing in it is renamed, deleted or created. Record sets are copied; folders are
   * only moved.
   */
  protected readonly allowAction = (action: SfTreeAction, nodes: readonly SfTreeNode<SampleContentEntry>[]): boolean =>
    !nodes.some((node) => isFavoriteNode(node.id)) && (action !== 'copy' || nodes.every((node) => node.data?.kind === 'recordset'));

  /**
   * The context menu's entries between the tree's own and *Delete*: *New record set…* (in a folder); *New record*,
   * *History* and *Used by* (on a record set); *Add to favorites* / *Remove from favorites* (M35.15); *Release…*, which
   * is also all a selection of several entries offers here.
   */
  protected readonly menuItems = (nodes: readonly SfTreeNode<SampleContentEntry>[]): ContextMenuItem[] => {
    if (nodes.length === 0 || nodes.some((node) => !node.data || isFavoriteNode(node.id))) {
      return [];
    }
    const release: ContextMenuItem = {
      label: this.state.t('menus.release'),
      icon: 'publish',
      action: () => releaseContent(this.state, this.toasts, nodes.flatMap((node) => (node.data ? [node.data] : []))),
    };
    const node = nodes.length === 1 ? nodes[0] : null;
    if (!node || !node.data) {
      return [release];
    }
    const favorite = contentFavorite(node.data);
    const entry = node.data;
    return [
      ...(entry.kind === 'folder'
        ? [{ label: this.state.t('content.newRecordSet'), icon: 'playlist_add', action: () => void this.state.newRecordSet(entry.id) }]
        : [
            { label: this.state.t('recordSet.newRecord'), icon: 'post_add', action: () => this.state.notice('recordSet.newRecordNotice') },
            { label: this.state.t('recordSet.menu.history'), icon: 'history', action: () => this.openSetPanel(entry.id, 'history') },
            { label: this.state.t('recordSet.menu.usedBy'), icon: 'link', action: () => this.openSetPanel(entry.id, 'usedby') },
          ]),
      {
        label: this.state.t(this.state.isFavoriteKey(favorite.key) ? 'favorites.remove' : 'favorites.add'),
        icon: 'star',
        action: () => this.state.toggleFavoriteOf(favorite),
      },
      release,
    ];
  };

  /** A right click on empty space acts as one on the top level: only the *New …* options. */
  protected readonly rootMenuItems = (): ContextMenuItem[] => [
    { label: this.state.t('menus.newFolder'), icon: 'create_new_folder', action: () => void this.tree().startCreate(null, 'folder') },
    { label: this.state.t('menus.newRecordSet'), icon: 'playlist_add', action: () => void this.state.newRecordSet(null) },
  ];

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
    { id: 'set', label: this.state.t('content.newRecordSet'), icon: 'playlist_add', action: () => void this.state.newRecordSet(this.createParent()) },
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

  /** Cut and paste, copy and paste, or a drag: only announced, with an Undo that says so. */
  protected onMove(request: SfTreeMoveRequest<SampleContentEntry>): void {
    request.completed(() => this.state.notice(request.copy ? 'menus.copiedBack' : 'contentMove.movedBack'));
  }

  /** *Move to…* opens the folder Move dialog. */
  protected onMoveTo(nodes: SfTreeNode<SampleContentEntry>[]): void {
    void this.state.moveContent(nodes.flatMap((node) => (node.data ? [node.data] : [])));
  }

  /** Opens the record set with its History drawer or its Used by drawer. */
  private openSetPanel(id: string, panel: 'history' | 'usedby'): void {
    this.state.openRecordSet(id);
    this.state.closeDrawers();
    if (panel === 'history') {
      this.state.history.set('record');
    } else {
      this.state.contentPanel.set('usedby');
    }
  }

  private openId(): string | null {
    return this.state.view() === 'contentfolder' ? this.state.contentFolderId() : this.state.recordSetId();
  }

  /** Where *New …* creates: the open folder, or the folder of the open record set. */
  private createParent(): string | null {
    const open = this.openId();
    return this.state.view() === 'contentfolder' ? open : open === null ? null : contentParentOf(open);
  }

  private create(kind: SfTreeCreateKind): void {
    void this.tree().startCreate(this.createParent(), kind);
  }

  private async reveal(): Promise<void> {
    for (const entry of contentPath(this.openId()).filter((e) => e.kind === 'folder')) {
      await this.tree().expand(entry.id);
    }
  }
}
