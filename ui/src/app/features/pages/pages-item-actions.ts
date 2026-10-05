import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { type Observable, catchError, firstValueFrom, forkJoin, map, of, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { FavoritesService } from '../../core/assets/favorites.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import type { SfTreeNode } from '../../shared/components/tree/tree-model';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import { type ReleaseChoice, choicesFor } from '../release/release-choice.util';
import type { ReleaseBlock } from '../release/release-status.util';
import { folderChain } from './folder-view.util';
import { PagesTreeRefresh } from './pages-tree-refresh.service';
import type { PageNodeData } from './pages-tree.util';

type FolderView = components['schemas']['FolderView'];

/** The part of a folder or page that both the tree (`PageNodeData`) and a folder-list row (`FolderRow`) carry. */
export interface PageItem {
  readonly kind: 'folder' | 'page';
  readonly uuid: string;
  readonly name: string;
  readonly uid: string;
  /** A folder: its own path. A page: the folder it lives in. */
  readonly path: string;
  readonly release: ReleaseBlock;
  readonly revision: number | null;
}

/** The pages clipboard scope of a project: the pages tree's own (`<projectKey>:pages`), so tree and list share one. */
export const pagesClipboardScope = (projectKey: string): string => `${projectKey}:pages`;

/**
 * The folder (`null` = the project root, the fixed "All Pages" wrapper) each of `nodes` lives in, read from the folder tree:
 * a page's folder is the one at its `path`, a folder's the one that lists it.
 */
export function parentResolver(tree: readonly FolderView[], nodes: readonly SfTreeNode<PageNodeData>[]): (uuid: string) => string | null {
  const root = tree[0]?.uuid ?? null;
  const asRoot = (uuid: string | null | undefined): string | null => (uuid && uuid !== root ? uuid : null);
  const byPath = new Map<string, string>();
  const folderParent = new Map<string, string | null>();
  const walk = (folders: readonly FolderView[], parent: string | null) => {
    for (const folder of folders) {
      if (!folder.uuid) {
        continue;
      }
      byPath.set(folder.path ?? '', folder.uuid);
      folderParent.set(folder.uuid, asRoot(parent));
      walk(folder.children ?? [], folder.uuid);
    }
  };
  walk(tree, null);
  const kinds = new Map(nodes.map((node) => [node.id, node.data] as const));
  return (uuid) => {
    const data = kinds.get(uuid);
    return data?.kind === 'page' ? asRoot(byPath.get(data.path)) : (folderParent.get(uuid) ?? null);
  };
}

/**
 * What the Pages area does to an item, shared by the tree (`PagesListComponent`) and the folder list (`FolderViewComponent`)
 * so a right click means the same in both: release (a folder with everything inside it), duplicate, rename, favorite, and
 * move/copy/paste with their Undo. The hosts own their dialogs and menus; this owns what happens.
 */
@Injectable({ providedIn: 'root' })
export class PagesItemActions {
  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly transloco = inject(TranslocoService);
  private readonly treeRefresh = inject(PagesTreeRefresh);
  private readonly favorites = inject(FavoritesService);
  private readonly locales = inject(LocalesStore);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly clipboard = inject(TreeClipboardService);

  /** Re-reads the folder tree and the pages after a change (tree and list follow through `PagesTreeRefresh`). */
  changed(projectKey: string): void {
    this.store.loadFor(projectKey, true).subscribe();
    this.treeRefresh.notify();
  }

  // ── Release ────────────────────────────────────────────────────────────────

  /**
   * The release choices of `items`: a page its own; a folder itself plus everything inside it, recursively. Everything that
   * has something to release is ticked. Empty when nothing is waiting (the caller shows {@link nothingToRelease}).
   */
  async releaseChoices(projectKey: string, tree: readonly FolderView[], items: readonly PageItem[]): Promise<ReleaseChoice[]> {
    const all = new Map<string, PageItem>();
    const add = (item: PageItem) => all.has(item.uuid) || all.set(item.uuid, item);
    const folderItem = (folder: FolderView): PageItem => ({
      kind: 'folder',
      uuid: folder.uuid!,
      name: folder.displayName ?? folder.uid ?? '',
      uid: folder.uid ?? '',
      path: folder.path ?? '',
      release: folder.release,
      revision: folder.revision ?? null,
    });
    const reads: Observable<void>[] = [];
    const collect = (folder: FolderView) => {
      add(folderItem(folder));
      reads.push(
        this.api.listPages(projectKey, { folder: folder.uuid }).pipe(
          tap((pages) =>
            (pages ?? [])
              .filter((page) => !!page.uuid)
              .forEach((page) =>
                add({
                  kind: 'page',
                  uuid: page.uuid!,
                  name: page.displayName ?? page.uid ?? '',
                  uid: page.uid ?? '',
                  path: page.folderPath ?? '',
                  release: page.release,
                  revision: page.revision ?? null,
                }),
              ),
          ),
          map(() => undefined),
        ),
      );
      (folder.children ?? []).filter((child) => !!child.uuid).forEach(collect);
    };
    for (const item of items) {
      const folder = item.kind === 'folder' ? folderChain(tree, item.uuid).at(-1) : undefined;
      if (folder) {
        collect(folder);
      } else {
        add(item);
      }
    }
    if (reads.length > 0) {
      await firstValueFrom(forkJoin(reads));
    }
    const labelOf = (code: string) => this.locales.labelOf(code);
    const locale = this.editingLocale.locale();
    return [...all.values()].flatMap((item) =>
      choicesFor(
        { uuid: item.uuid, type: item.kind === 'page' ? 'PAGE' : 'FOLDER', uid: item.uid, displayName: item.name, folderPath: item.path, release: item.release },
        'release',
        locale,
        labelOf,
      ).map((choice) => ({ ...choice, label: `${item.name} · ${choice.label}`, checked: true })),
    );
  }

  /** The choices for the release dialog, or `null` (with the "nothing to release" toast) when there is nothing. */
  async releaseDialogChoices(projectKey: string, tree: readonly FolderView[], items: readonly PageItem[]): Promise<ReleaseChoice[] | null> {
    let choices: ReleaseChoice[];
    try {
      choices = await this.releaseChoices(projectKey, tree, items);
    } catch {
      this.toasts.show(this.transloco.translate('pages.tree.toast.loadFailed'), 'error');
      return null;
    }
    if (choices.length === 0) {
      this.toasts.show(this.transloco.translate('pages.bulk.nothingToRelease'), 'info');
      return null;
    }
    return choices;
  }

  // ── Favorites, rename, duplicate ───────────────────────────────────────────

  toggleFavorite(item: PageItem): void {
    const on = this.favorites.toggle({
      type: item.kind === 'folder' ? 'FOLDER' : 'PAGE',
      uuid: item.uuid,
      displayName: item.name,
      folderPath: item.path,
    });
    this.toasts.show(this.transloco.translate(on ? 'shared.favorite.added' : 'shared.favorite.removed', { name: item.name }), 'info');
  }

  /** Renames; offers Undo (renames back with the etag the rename produced). Emits `true` once done, `false` after the error toast. */
  rename(projectKey: string, item: Pick<PageItem, 'kind' | 'uuid' | 'name'>, name: string): Observable<boolean> {
    const from = item.name;
    const run = (to: string, etag?: number): Observable<{ revision?: number }> =>
      item.kind === 'folder'
        ? this.api.renameFolder(projectKey, item.uuid, { displayName: to }, etag)
        : this.api.renameAsset(projectKey, item.uuid, { displayName: to }, etag);
    return run(name).pipe(
      tap((renamed) => {
        this.undo.offer(this.transloco.translate('pages.tree.toast.renamed', { from, to: name }), () =>
          run(from, renamed.revision).pipe(tap(() => this.changed(projectKey))),
        );
        this.changed(projectKey);
      }),
      map(() => true),
      catchError(() => {
        this.toasts.show(this.transloco.translate('pages.tree.toast.renameFailed', { name: from }), 'error');
        return of(false);
      }),
    );
  }

  async duplicate(projectKey: string, item: Pick<PageItem, 'uuid' | 'name'>): Promise<void> {
    try {
      const copy = await firstValueFrom(this.api.duplicateAsset(projectKey, item.uuid));
      const uuid = copy.uuid;
      this.changed(projectKey);
      const message = this.transloco.translate('pages.tree.toast.duplicated', { name: item.name });
      if (uuid) {
        this.undo.offer(message, () => this.api.deleteAsset(projectKey, uuid).pipe(tap(() => this.changed(projectKey))));
      } else {
        this.toasts.show(message, 'success');
      }
    } catch {
      this.toasts.show(this.transloco.translate('pages.tree.toast.duplicateFailed', { name: item.name }), 'error');
    }
  }

  // ── Clipboard, move and copy ───────────────────────────────────────────────

  /** A tree node for an item, so a folder-list row can be cut or copied into the tree's clipboard. */
  nodeOf(item: PageItem): SfTreeNode<PageNodeData> {
    return {
      id: item.uuid,
      label: item.name,
      icon: item.kind === 'folder' ? 'folder' : 'description',
      droppable: item.kind === 'folder',
      hasChildren: item.kind === 'folder',
      data: { ...item, scheduled: false },
    };
  }

  cut(projectKey: string, items: readonly PageItem[]): void {
    this.clipboard.cutNodes(pagesClipboardScope(projectKey), items.map((item) => this.nodeOf(item)));
  }

  copy(projectKey: string, items: readonly PageItem[]): void {
    this.clipboard.copyNodes(pagesClipboardScope(projectKey), items.map((item) => this.nodeOf(item)));
  }

  /**
   * Whether what the clipboard holds can be pasted into the folder `target` (`null` = the root): a folder cannot go into
   * itself or below itself, a move must change the folder, only pages are copied.
   */
  canPaste(projectKey: string, tree: readonly FolderView[], target: string | null): boolean {
    const clip = this.clipboard.nodes();
    if (!clip || clip.scope !== pagesClipboardScope(projectKey) || clip.nodes.length === 0) {
      return false;
    }
    const into = target === null ? [] : folderChain(tree, target);
    const parentOf = parentResolver(tree, clip.nodes as readonly SfTreeNode<PageNodeData>[]);
    return (clip.nodes as readonly SfTreeNode<PageNodeData>[]).every((node) => {
      const kind = node.data?.kind;
      if (clip.mode === 'copy') {
        return kind === 'page';
      }
      return parentOf(node.id) !== target && !(kind === 'folder' && into.some((folder) => folder.uuid === node.id));
    });
  }

  /** Pastes the clipboard into `target`: the same move or copy the tree's paste performs, with the same toast and Undo. */
  async paste(projectKey: string, tree: readonly FolderView[], target: string | null): Promise<void> {
    const clip = this.clipboard.nodes();
    if (!clip || clip.scope !== pagesClipboardScope(projectKey)) {
      return;
    }
    const nodes = clip.nodes as readonly SfTreeNode<PageNodeData>[];
    const copy = clip.mode === 'copy';
    if (!copy) {
      this.clipboard.clear();
    }
    await this.transfer(projectKey, nodes, target, copy, parentResolver(tree, nodes), (undo) => {
      const text = this.transloco.translate(copy ? 'shared.tree.copied' : 'shared.tree.moved', { count: nodes.length, name: nodes[0]?.label ?? '' });
      if (undo) {
        this.toasts.undo(text, undo);
      } else {
        this.toasts.show(text, 'success');
      }
    });
  }

  /**
   * Moves (or, for pages, duplicates into) the folder `target` (`null` = the root). Undo moves back, or deletes the copies.
   * Stops at the first failure; what was done up to there stays and is announced.
   */
  async transfer(
    projectKey: string,
    nodes: readonly SfTreeNode<PageNodeData>[],
    target: string | null,
    copy: boolean,
    parentOf: (uuid: string) => string | null,
    completed: (undo?: () => void) => void,
  ): Promise<void> {
    const body = target === null ? {} : { folderUuid: target };
    const undoSteps: (() => Observable<unknown>)[] = [];
    try {
      for (const node of nodes) {
        const data = node.data;
        if (!data) {
          continue;
        }
        if (copy) {
          const copied = await firstValueFrom(this.api.duplicateAsset(projectKey, data.uuid, target));
          const uuid = copied.uuid;
          if (uuid) {
            undoSteps.push(() => this.api.deleteAsset(projectKey, uuid));
          }
        } else {
          const back = parentOf(data.uuid);
          const backBody = back === null ? {} : { folderUuid: back };
          await firstValueFrom(this.api.moveAsset(projectKey, data.uuid, body), { defaultValue: undefined });
          undoSteps.push(() => this.api.moveAsset(projectKey, data.uuid, backBody));
        }
      }
    } catch {
      this.toasts.show(this.transloco.translate(copy ? 'pages.tree.toast.copyFailed' : 'pages.tree.toast.moveFailed', { name: nodes[0]?.label ?? '' }), 'error');
      this.changed(projectKey);
      return;
    }
    this.changed(projectKey);
    completed(undoSteps.length > 0 ? () => void this.runUndo(projectKey, undoSteps) : undefined);
  }

  private async runUndo(projectKey: string, steps: readonly (() => Observable<unknown>)[]): Promise<void> {
    try {
      for (const step of [...steps].reverse()) {
        await firstValueFrom(step(), { defaultValue: undefined });
      }
      this.toasts.show(this.transloco.translate('shared.undo.done'), 'info');
    } catch {
      this.toasts.show(this.transloco.translate('shared.undo.failed'), 'error');
    }
    this.changed(projectKey);
  }
}
