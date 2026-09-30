import { computed, inject, Injectable, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { sortByDisplayName } from '../../shared/tree-sort.util';
import { ASSET_TYPES_FOR, AssetSummaryView, FolderView, ROOT_PATH, TreeScope, withoutRecordSets } from './export-selection.types';

/**
 * Read-only data behind the export panel's folder trees (provided by `ProjectSettingsExportComponent`): the project's
 * folder trees from `ProjectContextStore`, every selectable asset per scope (loaded once per project), and the
 * lookups that place them under their folders.
 */
@Injectable()
export class ExportTreeData {
  private readonly ctx = inject(ProjectContextStore);
  private readonly api = inject(ApiClient);

  /** Every asset of each scope, fetched once per project (unfiltered — omitting `folder` returns
   * everything of that type, see `AssetServiceImpl.folderPattern`), then bucketed client-side by
   * *exact* `folderPath` equality in `assetsByFolderPath`. Eager and flat rather than the old
   * lazy per-folder fetch, which relied on the generic `/assets?folder=` endpoint's LIKE-prefix
   * match — that match includes descendants too, so a nested subfolder's items were double-counted
   * under every ancestor folder as well as their real parent. Fetching once per scope and bucketing
   * by exact equality (the same pattern `pagesByFolder`/`templatesByFolder` already use) fixes that,
   * and as a side effect gives root-level items (bucketed under `ROOT_PATH`) somewhere to live at
   * all, which the old per-*folder-node* fetch had no way to represent. */
  readonly assetsByScope = signal<Map<TreeScope, AssetSummaryView[]>>(new Map());
  readonly loadingAssets = signal(false);

  readonly assetsByFolderPath = computed(() => {
    const result = new Map<TreeScope, Map<string, AssetSummaryView[]>>();
    for (const [scope, assets] of this.assetsByScope()) {
      const byPath = new Map<string, AssetSummaryView[]>();
      for (const asset of assets) {
        const path = asset.folderPath ?? ROOT_PATH;
        const list = byPath.get(path);
        if (list) {
          list.push(asset);
        } else {
          byPath.set(path, [asset]);
        }
      }
      for (const [path, list] of byPath) {
        byPath.set(path, sortByDisplayName(list));
      }
      result.set(scope, byPath);
    }
    return result;
  });

  /** The Content folder tree without its record-set nodes (M25): the sets are this scope's leaf rows
   * (`assetsByScope`, bucketed by their folder like every other leaf), not folders to expand. */
  private readonly contentFolders = computed(() => withoutRecordSets(this.ctx.contentFolderTree()));

  /** Loads the project's folder trees and every selectable asset (called when the project key changes). */
  load(key: string): void {
    this.ctx.loadFor(key).subscribe();
    this.loadAllAssets(key);
  }

  private loadAllAssets(key: string): void {
    this.loadingAssets.set(true);
    const scopes: TreeScope[] = ['PAGE', 'MEDIA', 'PAGE_REFERENCE', 'TEMPLATES', 'GLOBAL_SET', 'RECORD_SET'];
    forkJoin(
      scopes.map((scope) =>
        forkJoin(
          ASSET_TYPES_FOR[scope].map((type) =>
            this.api.listAssets(key, { type, page: 0, size: 10000 }),
          ),
        ),
      ),
    ).subscribe({
      next: (pagesByScope) => {
        const next = new Map<TreeScope, AssetSummaryView[]>();
        scopes.forEach((scope, i) => {
          next.set(scope, pagesByScope[i].flatMap((page) => page.content ?? []));
        });
        this.assetsByScope.set(next);
        this.loadingAssets.set(false);
      },
      error: () => {
        this.loadingAssets.set(false);
      },
    });
  }

  nodeKey(node: FolderView): string {
    return node.uuid ?? node.path ?? node.uid ?? '';
  }

  /** This node's own leaf assets, bucketed by *exact* `folderPath` equality — never includes a
   * descendant subfolder's items (that was the old per-folder LIKE-prefix-fetch bug). */
  folderAssets(node: FolderView, scope: TreeScope): AssetSummaryView[] {
    const path = node.path ?? '';
    return this.assetsByFolderPath().get(scope)?.get(path) ?? [];
  }

  /** Leaf assets living directly in this scope's fixed wrapper root ("All Pages"/"All Media"/
   * "All Navigation"/"All Templates" — see `storeRoot`), rendered under the synthetic root row
   * after its top-level folders (§ `rootSection`), since the old tree had nowhere at all to
   * represent (or select) a root-level item. Keyed by the wrapper's own canonical path, not the
   * bare project root — every store's content nests one level under its wrapper now. */
  rootAssets(scope: TreeScope): AssetSummaryView[] {
    return this.assetsByFolderPath().get(scope)?.get(this.storeRoot(scope)?.path ?? ROOT_PATH) ?? [];
  }

  /** The scope's fixed, wrapper root — always the tree's sole top-level entry (mirrors
   * `NAVIGATION`/`TEMPLATES`'s own fixed roots, now generalized to `PAGES`/`MEDIA` too). Never
   * rendered as its own row here — the synthetic root row (§ `rootSection`) already covers that
   * exact concept, so showing the real wrapper folder underneath it would just be a duplicate
   * "root" row; `topLevelFolders` unwraps it for display. */
  storeRoot(scope: TreeScope): FolderView | null {
    return this.treeFor(scope)[0] ?? null;
  }

  /** The store's real top-level folders — the wrapper root's children (see `storeRoot`). */
  topLevelFolders(scope: TreeScope): FolderView[] {
    return this.storeRoot(scope)?.children ?? [];
  }

  treeFor(scope: TreeScope): FolderView[] {
    switch (scope) {
      case 'PAGE':
        return this.ctx.pageFolderTree();
      case 'MEDIA':
        return this.ctx.mediaFolderTree();
      case 'PAGE_REFERENCE':
        return this.ctx.navigationFolderTree();
      case 'TEMPLATES':
        return this.ctx.templateFolderTree();
      case 'GLOBAL_SET':
        return this.ctx.globalsFolderTree();
      case 'RECORD_SET':
        return this.contentFolders();
    }
  }

  /** Whether this node has no expand-worthy content at all — no subfolders and no leaf assets. */
  isLeafOnly(node: FolderView, scope: TreeScope): boolean {
    return (node.children ?? []).length === 0 && this.folderAssets(node, scope).length === 0;
  }
}
