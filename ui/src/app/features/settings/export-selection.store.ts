import { computed, inject, Injectable, signal } from '@angular/core';
import { ExportTreeData } from './export-tree-data.service';
import { AssetSummaryView, CheckState, FolderView, ROOT_PATH, STORE_SCOPE_FOR, StoreScope, TreeScope } from './export-selection.types';

/**
 * Feature-scoped state of the export panel (provided by `ProjectSettingsExportComponent`): the picked uuids and
 * whole-store picks, the tree helpers that derive each row's tri-state,
 * and the "Additional data" toggles. The tree-section and options sub-components read and write it directly.
 *
 * All five selection sources (three trees + two template lists) write into the single `selected` uuid set — uuids are
 * globally unique server-side, so no merge step is needed; the request's `assetUuids` is `Array.from(selected())`.
 */
@Injectable()
export class ExportSelectionStore {
  private readonly data = inject(ExportTreeData);

  /** Explicitly-checked uuids (folders and/or leaf assets) — the backend expands a folder pick into its full live subtree, so a folder's own uuid is all that's ever needed in the request. Never contains a uuid belonging to a store currently present in `fullStores` (see `toggleFullStore`/`explodeFullStoreExcluding`). */
  readonly selected = signal<Set<string>>(new Set());
  /** Stores picked wholesale via "Select all <store>" (M11.3.2) — a pure component-level flag, independent of tree loading. */
  readonly fullStores = signal<Set<StoreScope>>(new Set());
  readonly expanded = signal<Set<string>>(new Set());
  /** Scopes whose synthetic root row (§ `rootSection`/`isRootExpanded`) is currently collapsed —
   * absence means expanded, matching every other node's own default-expanded-until-toggled
   * behavior (`sf-nav-tree-node`'s `expanded` signal starts `true`) without needing to pre-seed
   * all four scopes into a "these are expanded" set up front. */
  readonly collapsedRoots = signal<Set<TreeScope>>(new Set());

  readonly includeChannels = signal(false);
  readonly includeGenerationTargets = signal(false);
  /** The open schedules (M27.8.2): a release or unpublish only when all its assets are selected, a build always. */
  readonly includeSchedules = signal(false);

  readonly exportDisabled = computed(
    () =>
      this.selected().size === 0 &&
      this.fullStores().size === 0 &&
      !this.includeChannels() &&
      !this.includeGenerationTargets() &&
      !this.includeSchedules(),
  );

  // ── Tree helpers ─────────────────────────────────────────────────────────

  isExpanded(node: FolderView): boolean {
    const key = this.data.nodeKey(node);
    return key !== '' && this.expanded().has(key);
  }

  toggleExpand(node: FolderView): void {
    const key = this.data.nodeKey(node);
    if (!key) {
      return;
    }
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  /** All uuids "beneath" this node — its own leaf assets plus every descendant sub-folder and their own leaf assets, recursively. Drives the folder's tri-state indicator. */
  private collectDescendantUuids(node: FolderView, scope: TreeScope): string[] {
    const result: string[] = this.data.folderAssets(node, scope).map((a) => a.uuid).filter((u): u is string => !!u);
    for (const child of node.children ?? []) {
      const childKey = this.data.nodeKey(child);
      if (childKey) {
        result.push(childKey);
      }
      result.push(...this.collectDescendantUuids(child, scope));
    }
    return result;
  }

  /** True if this node is covered by a direct pick — its own uuid is selected, an ancestor folder pick covers it, or every one of its descendants is individually selected. Drives both the tri-state's `explicit` branch and whether a folder-level pick should disable its children (independent of `fullStores`, which is checked separately so it never disables anything — see `folderState`). */
  private nodeIsExplicitFolderPick(node: FolderView, scope: TreeScope, ancestorFolderChecked: boolean): boolean {
    const key = this.data.nodeKey(node);
    if (ancestorFolderChecked || (key !== '' && this.selected().has(key))) {
      return true;
    }
    const descendants = this.collectDescendantUuids(node, scope);
    return descendants.length > 0 && descendants.every((u) => this.selected().has(u));
  }

  folderState(node: FolderView, scope: TreeScope, ancestorFolderChecked: boolean): CheckState {
    if (this.fullStores().has(STORE_SCOPE_FOR[scope]) || this.nodeIsExplicitFolderPick(node, scope, ancestorFolderChecked)) {
      return 'explicit';
    }
    const descendants = this.collectDescendantUuids(node, scope);
    if (descendants.length === 0) {
      return 'unchecked';
    }
    const checkedCount = descendants.filter((u) => this.selected().has(u)).length;
    return checkedCount > 0 ? 'implicit' : 'unchecked';
  }

  /** The `ancestorChecked` context to pass down to this node's children — deliberately NOT `fullStores`-aware, so a store-level full-select never disables individual rows (they must stay clickable to drive the "uncheck one item" policy in `toggleFolder`/`toggleAsset`). */
  childAncestorChecked(node: FolderView, scope: TreeScope, ancestorFolderChecked: boolean): boolean {
    return this.nodeIsExplicitFolderPick(node, scope, ancestorFolderChecked);
  }

  assetChecked(asset: AssetSummaryView, scope: TreeScope, ancestorChecked: boolean): boolean {
    if (ancestorChecked || this.fullStores().has(STORE_SCOPE_FOR[scope])) {
      return true;
    }
    return !!asset.uuid && this.selected().has(asset.uuid);
  }

  toggleFolder(node: FolderView, scope: TreeScope, ancestorChecked: boolean): void {
    if (ancestorChecked) {
      return;
    }
    const key = this.data.nodeKey(node);
    if (!key) {
      return;
    }
    if (this.isStoreFull(scope)) {
      // Policy (M11.3.2): unchecking any individual item while its store is fully-selected
      // "explodes" the store-wide pick into the equivalent explicit per-node selection —
      // everything else in the store gets its own uuid added to `selected` — minus this one
      // item, then clears the store-level `fullStores` flag. The user's uncheck wins; every
      // other item in the store stays selected. (While a store is fully-selected every row
      // renders `explicit`, so a click here can only ever mean "exclude this one".)
      this.explodeFullStoreExcluding(scope, key);
      return;
    }
    this.toggleUuid(key);
  }

  toggleAsset(asset: AssetSummaryView, scope: TreeScope, ancestorChecked: boolean): void {
    if (ancestorChecked || !asset.uuid) {
      return;
    }
    if (this.isStoreFull(scope)) {
      // Same policy as `toggleFolder` above, applied to a leaf asset.
      this.explodeFullStoreExcluding(scope, asset.uuid);
      return;
    }
    this.toggleUuid(asset.uuid);
  }

  private toggleUuid(uuid: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  }

  /** Whether this scope's synthetic root row — the single container node standing in for the
   * store's hidden root, mirroring `sf-nav-tree-node`'s `isRoot` row in the Navigation screen's
   * own tree — is expanded. Every top-level folder and root-level leaf asset renders beneath it,
   * rather than as a bare forest with no common ancestor to select/expand as a unit. */
  isRootExpanded(scope: TreeScope): boolean {
    return !this.collapsedRoots().has(scope);
  }

  toggleRootExpand(scope: TreeScope): void {
    this.collapsedRoots.update((set) => {
      const next = new Set(set);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  }

  /** Mirrors the store trees' own `expanded && hasChildren ? 'folder_open' : 'folder'` icon rule
   * (`sf-folder-node`/`sf-media-folder-node`/`sf-nav-tree-node`/`sf-template-folder-node`) — this
   * panel's tree is read-only/selection-only, but should look identical otherwise. */
  folderIcon(node: FolderView, scope: TreeScope): string {
    const hasContent = (node.children ?? []).length > 0 || this.data.folderAssets(node, scope).length > 0;
    return this.isExpanded(node) && hasContent ? 'folder_open' : 'folder';
  }

  /** Per-type leaf icon, matching each store's own leaf row exactly where one exists
   * (`sf-page-nav-node`/`sf-template-nav-node` use `description`; `sf-nav-tree-node` uses `link`
   * for a `PAGE_REFERENCE`). Media has no tree-leaf equivalent in its own store (media items are
   * grid cards there, not tree rows), so `perm_media` — already used for the Media nav icon
   * elsewhere in this app — is the closest consistent choice rather than reusing a type this
   * scope was never given a tree leaf for. */
  leafIcon(scope: TreeScope): string {
    switch (scope) {
      case 'PAGE_REFERENCE':
        return 'link';
      case 'MEDIA':
        return 'perm_media';
      case 'GLOBAL_SET':
        return 'tune';
      case 'RECORD_SET':
        return 'table_rows';
      default:
        return 'description';
    }
  }

  // ── Whole-store selection (M11.3.2) ─────────────────────────────────────

  isStoreFull(scope: TreeScope): boolean {
    return this.fullStores().has(STORE_SCOPE_FOR[scope]);
  }

  toggleFullStore(scope: TreeScope): void {
    const storeScope = STORE_SCOPE_FOR[scope];
    if (this.fullStores().has(storeScope)) {
      this.fullStores.update((set) => {
        const next = new Set(set);
        next.delete(storeScope);
        return next;
      });
      return;
    }
    // Activating a store-level full-select supersedes any individual picks already made in
    // that store — clear them from `selected` first so a store's uuids are never simultaneously
    // present in `fullStores` (as a scope) AND duplicated into `assetUuids`.
    const treeUuids = this.collectAllUuidsInTree(scope);
    this.selected.update((set) => {
      const next = new Set(set);
      for (const uuid of treeUuids) {
        next.delete(uuid);
      }
      return next;
    });
    this.fullStores.update((set) => {
      const next = new Set(set);
      next.add(storeScope);
      return next;
    });
  }

  /** Every folder uuid in the tree plus every leaf asset uuid in the scope (including root-level
   * ones) — used to purge stale individual picks when a store-level full-select is turned on. */
  private collectAllUuidsInTree(scope: TreeScope): string[] {
    const result: string[] = [];
    for (const asset of this.data.rootAssets(scope)) {
      if (asset.uuid) {
        result.push(asset.uuid);
      }
    }
    const walk = (list: FolderView[]) => {
      for (const node of list) {
        const key = this.data.nodeKey(node);
        if (key) {
          result.push(key);
          for (const asset of this.data.folderAssets(node, scope)) {
            if (asset.uuid) {
              result.push(asset.uuid);
            }
          }
        }
        walk(node.children ?? []);
      }
    };
    walk(this.data.topLevelFolders(scope));
    return result;
  }

  /**
   * Builds the explicit per-node uuid set equivalent to "everything in this store except
   * `excludeKey`": every sibling folder not on the path to the excluded node gets its own uuid
   * (its subtree cascades server-side); folders on the path get their non-excluded leaf assets
   * added directly and are walked into recursively instead of being added wholesale. Root-level
   * assets (no folder) are added directly, same as any other leaf not on the excluded path.
   */
  private collectStoreSelectionExcluding(scope: TreeScope, excludeKey: string): Set<string> {
    const additions = new Set<string>();
    for (const asset of this.data.rootAssets(scope)) {
      if (asset.uuid && asset.uuid !== excludeKey) {
        additions.add(asset.uuid);
      }
    }
    const containsExcluded = (node: FolderView): boolean => {
      if (this.data.nodeKey(node) === excludeKey) {
        return true;
      }
      if (this.data.folderAssets(node, scope).some((a) => a.uuid === excludeKey)) {
        return true;
      }
      return (node.children ?? []).some((child) => containsExcluded(child));
    };
    const walk = (list: FolderView[]) => {
      for (const node of list) {
        const key = this.data.nodeKey(node);
        if (key === excludeKey) {
          continue; // the excluded node itself contributes nothing
        }
        if (containsExcluded(node)) {
          for (const asset of this.data.folderAssets(node, scope)) {
            if (asset.uuid && asset.uuid !== excludeKey) {
              additions.add(asset.uuid);
            }
          }
          walk(node.children ?? []);
        } else if (key) {
          additions.add(key);
        }
      }
    };
    walk(this.data.topLevelFolders(scope));
    return additions;
  }

  private explodeFullStoreExcluding(scope: TreeScope, excludeKey: string): void {
    const additions = this.collectStoreSelectionExcluding(scope, excludeKey);
    this.selected.update((set) => {
      const next = new Set(set);
      for (const uuid of additions) {
        next.add(uuid);
      }
      next.delete(excludeKey);
      return next;
    });
    this.fullStores.update((set) => {
      const next = new Set(set);
      next.delete(STORE_SCOPE_FOR[scope]);
      return next;
    });
  }

  // ── Toggles ──────────────────────────────────────────────────────────────

  onToggleChannels(event: Event): void {
    this.includeChannels.set((event.target as HTMLInputElement).checked);
  }

  onToggleGenerationTargets(event: Event): void {
    this.includeGenerationTargets.set((event.target as HTMLInputElement).checked);
  }

  onToggleSchedules(event: Event): void {
    this.includeSchedules.set((event.target as HTMLInputElement).checked);
  }
}
