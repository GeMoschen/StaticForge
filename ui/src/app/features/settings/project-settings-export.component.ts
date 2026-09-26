import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { forkJoin } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { sortByDisplayName } from '../../shared/tree-sort.util';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ExportSelectionRequest, ImportExportService } from './import-export.service';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

/** The four folder-tree scopes shown in this panel. `TEMPLATES` is ONE tree scope — its tree
 * just happens to have two fixed top-level folders ("Page Templates"/"Section Templates"),
 * structurally no different from any other scope having multiple top-level folders — so it
 * needs no special-casing anywhere below. */
type TreeScope = 'PAGE' | 'MEDIA' | 'PAGE_REFERENCE' | 'TEMPLATES' | 'GLOBAL_SET' | 'RECORD_SET';
/** The `FolderScope`/`ExportSelectionRequest.fullStores` string for each tree scope. */
type StoreScope = 'PAGES' | 'MEDIA' | 'NAVIGATION' | 'TEMPLATES' | 'GLOBALS' | 'CONTENT';

const STORE_SCOPE_FOR: Record<TreeScope, StoreScope> = {
  PAGE: 'PAGES',
  MEDIA: 'MEDIA',
  PAGE_REFERENCE: 'NAVIGATION',
  TEMPLATES: 'TEMPLATES',
  GLOBAL_SET: 'GLOBALS',
  RECORD_SET: 'CONTENT',
};

/** The `ApiClient.listAssets` `type` filter(s) backing each tree scope — `TEMPLATES` needs two
 * calls since its tree holds both `PAGE_TEMPLATE` and `SECTION_TEMPLATE` leaves. */
const ASSET_TYPES_FOR: Record<TreeScope, string[]> = {
  PAGE: ['PAGE'],
  MEDIA: ['MEDIA'],
  PAGE_REFERENCE: ['PAGE_REFERENCE'],
  // The "Datasets" folder (M19.4.1) lives in the templates tree, so its schemas are leaves there.
  TEMPLATES: ['PAGE_TEMPLATE', 'SECTION_TEMPLATE', 'DATASET'],
  GLOBAL_SET: ['GLOBAL_SET'],
  // The Content store's leaves are its record sets (M25.5.3); a set's records go with it and are never picked
  // one by one.
  RECORD_SET: ['RECORD_SET'],
};

/** A folder tree with the Content store's record-set leaf nodes (`type: RECORD_SET`) removed at every level. */
function withoutRecordSets(tree: FolderView[]): FolderView[] {
  return tree
    .filter((node) => node.type !== 'RECORD_SET')
    .map((node) => ({ ...node, children: withoutRecordSets(node.children ?? []) }));
}

/** Bucket key used for items with no folder — i.e. living directly at the store's hidden root. */
const ROOT_PATH = '/';

/**
 * Tri-state a tree row can render as (M11.3.4 — replaces the old checked/indeterminate pair):
 * - `explicit`: the node's own uuid is directly selected, OR an ancestor/full-store pick covers it.
 * - `implicit`: not explicit, but at least one descendant is explicit-or-implicit — this node is
 *   pure "ancestor padding" that the backend will include anyway to give the pick a valid path.
 * - `unchecked`: neither.
 */
type CheckState = 'unchecked' | 'explicit' | 'implicit';

/**
 * Project settings tab: "Export" half of `M10`/`M11`'s selective export/import — lets the user
 * pick a subset of the project's pages/media/navigation (via the three folder trees loaded by
 * `ProjectContextStore`), page/section templates (flat searchable lists), whole-store picks, and
 * channels/generation-targets toggles, then downloads the resulting ZIP. Mirrors
 * `project-settings-url-registry.component`'s shape: signals for state, services via `inject()`,
 * reload-on-`projectKey`-change effect.
 *
 * All five selection sources (three trees + two template lists) write into the single `selected`
 * uuid set — uuids are globally unique server-side, so no merge step is needed; `exportNow()`'s
 * `assetUuids` is simply `Array.from(selected())`.
 */
@Component({
  selector: 'sf-project-settings-export',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, SfButtonComponent, SfEmptyStateComponent, SfIconComponent, SfSpinnerComponent],
  templateUrl: './project-settings-export.component.html',
  styleUrl: './project-settings-export.component.scss',
})
export class ProjectSettingsExportComponent {
  readonly projectKey = input.required<string>();

  protected readonly store = inject(ProjectContextStore);
  private readonly api = inject(ApiClient);
  private readonly importExport = inject(ImportExportService);
  private readonly toasts = inject(ToastService);

  /** Explicitly-checked uuids (folders and/or leaf assets) — the backend expands a folder pick into its full live subtree, so a folder's own uuid is all that's ever needed in the request. Never contains a uuid belonging to a store currently present in `fullStores` (see `toggleFullStore`/`explodeFullStoreExcluding`). */
  protected readonly selected = signal<Set<string>>(new Set());
  /** Stores picked wholesale via "Select all <store>" (M11.3.2) — a pure component-level flag, independent of tree loading. */
  protected readonly fullStores = signal<Set<StoreScope>>(new Set());
  protected readonly expanded = signal<Set<string>>(new Set());
  /** Scopes whose synthetic root row (§ `rootSection`/`isRootExpanded`) is currently collapsed —
   * absence means expanded, matching every other node's own default-expanded-until-toggled
   * behavior (`sf-nav-tree-node`'s `expanded` signal starts `true`) without needing to pre-seed
   * all four scopes into a "these are expanded" set up front. */
  protected readonly collapsedRoots = signal<Set<TreeScope>>(new Set());
  /** Every asset of each scope, fetched once per project (unfiltered — omitting `folder` returns
   * everything of that type, see `AssetServiceImpl.folderPattern`), then bucketed client-side by
   * *exact* `folderPath` equality in `assetsByFolderPath`. Eager and flat rather than the old
   * lazy per-folder fetch, which relied on the generic `/assets?folder=` endpoint's LIKE-prefix
   * match — that match includes descendants too, so a nested subfolder's items were double-counted
   * under every ancestor folder as well as their real parent. Fetching once per scope and bucketing
   * by exact equality (the same pattern `pagesByFolder`/`templatesByFolder` already use) fixes that,
   * and as a side effect gives root-level items (bucketed under `ROOT_PATH`) somewhere to live at
   * all, which the old per-*folder-node* fetch had no way to represent. */
  protected readonly assetsByScope = signal<Map<TreeScope, AssetSummaryView[]>>(new Map());
  protected readonly loadingAssets = signal(false);

  protected readonly assetsByFolderPath = computed(() => {
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
  private readonly contentFolders = computed(() => withoutRecordSets(this.store.contentFolderTree()));

  protected readonly includeChannels = signal(false);
  protected readonly includeGenerationTargets = signal(false);
  /** The open schedules (M27.8.2): a release or unpublish only when all its assets are selected, a build always. */
  protected readonly includeSchedules = signal(false);

  protected readonly exporting = signal(false);
  protected readonly exportError = signal<string | null>(null);

  protected readonly exportDisabled = computed(
    () =>
      this.selected().size === 0 &&
      this.fullStores().size === 0 &&
      !this.includeChannels() &&
      !this.includeGenerationTargets() &&
      !this.includeSchedules(),
  );

  constructor() {
    effect(() => {
      const key = this.projectKey();
      if (!key) {
        return;
      }
      untracked(() => {
        this.store.loadFor(key).subscribe();
        this.loadAllAssets(key);
      });
    });
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

  // ── Tree helpers ─────────────────────────────────────────────────────────

  protected nodeKey(node: FolderView): string {
    return node.uuid ?? node.path ?? node.uid ?? '';
  }

  protected isExpanded(node: FolderView): boolean {
    const key = this.nodeKey(node);
    return key !== '' && this.expanded().has(key);
  }

  protected toggleExpand(node: FolderView): void {
    const key = this.nodeKey(node);
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
    const result: string[] = this.folderAssets(node, scope).map((a) => a.uuid).filter((u): u is string => !!u);
    for (const child of node.children ?? []) {
      const childKey = this.nodeKey(child);
      if (childKey) {
        result.push(childKey);
      }
      result.push(...this.collectDescendantUuids(child, scope));
    }
    return result;
  }

  /** True if this node is covered by a direct pick — its own uuid is selected, an ancestor folder pick covers it, or every one of its descendants is individually selected. Drives both the tri-state's `explicit` branch and whether a folder-level pick should disable its children (independent of `fullStores`, which is checked separately so it never disables anything — see `folderState`). */
  private nodeIsExplicitFolderPick(node: FolderView, scope: TreeScope, ancestorFolderChecked: boolean): boolean {
    const key = this.nodeKey(node);
    if (ancestorFolderChecked || (key !== '' && this.selected().has(key))) {
      return true;
    }
    const descendants = this.collectDescendantUuids(node, scope);
    return descendants.length > 0 && descendants.every((u) => this.selected().has(u));
  }

  protected folderState(node: FolderView, scope: TreeScope, ancestorFolderChecked: boolean): CheckState {
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
  protected childAncestorChecked(node: FolderView, scope: TreeScope, ancestorFolderChecked: boolean): boolean {
    return this.nodeIsExplicitFolderPick(node, scope, ancestorFolderChecked);
  }

  protected assetChecked(asset: AssetSummaryView, scope: TreeScope, ancestorChecked: boolean): boolean {
    if (ancestorChecked || this.fullStores().has(STORE_SCOPE_FOR[scope])) {
      return true;
    }
    return !!asset.uuid && this.selected().has(asset.uuid);
  }

  protected toggleFolder(node: FolderView, scope: TreeScope, ancestorChecked: boolean): void {
    if (ancestorChecked) {
      return;
    }
    const key = this.nodeKey(node);
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

  protected toggleAsset(asset: AssetSummaryView, scope: TreeScope, ancestorChecked: boolean): void {
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

  /** This node's own leaf assets, bucketed by *exact* `folderPath` equality — never includes a
   * descendant subfolder's items (that was the old per-folder LIKE-prefix-fetch bug). */
  protected folderAssets(node: FolderView, scope: TreeScope): AssetSummaryView[] {
    const path = node.path ?? '';
    return this.assetsByFolderPath().get(scope)?.get(path) ?? [];
  }

  /** Leaf assets living directly in this scope's fixed wrapper root ("All Pages"/"All Media"/
   * "All Navigation"/"All Templates" — see `storeRoot`), rendered under the synthetic root row
   * after its top-level folders (§ `rootSection`), since the old tree had nowhere at all to
   * represent (or select) a root-level item. Keyed by the wrapper's own canonical path, not the
   * bare project root — every store's content nests one level under its wrapper now. */
  protected rootAssets(scope: TreeScope): AssetSummaryView[] {
    return this.assetsByFolderPath().get(scope)?.get(this.storeRoot(scope)?.path ?? ROOT_PATH) ?? [];
  }

  /** The scope's fixed, protected wrapper root — always the tree's sole top-level entry (mirrors
   * `NAVIGATION`/`TEMPLATES`'s own fixed roots, now generalized to `PAGES`/`MEDIA` too). Never
   * rendered as its own row here — the synthetic root row (§ `rootSection`) already covers that
   * exact concept, so showing the real wrapper folder underneath it would just be a duplicate
   * "root" row; `topLevelFolders` unwraps it for display. */
  private storeRoot(scope: TreeScope): FolderView | null {
    return this.treeFor(scope)[0] ?? null;
  }

  /** The store's real top-level folders — the wrapper root's children (see `storeRoot`). */
  protected topLevelFolders(scope: TreeScope): FolderView[] {
    return this.storeRoot(scope)?.children ?? [];
  }

  protected isLoadingAssets(): boolean {
    return this.loadingAssets();
  }

  /** Whether this scope's synthetic root row — the single container node standing in for the
   * store's hidden root, mirroring `sf-nav-tree-node`'s `isRoot` row in the Navigation screen's
   * own tree — is expanded. Every top-level folder and root-level leaf asset renders beneath it,
   * rather than as a bare forest with no common ancestor to select/expand as a unit. */
  protected isRootExpanded(scope: TreeScope): boolean {
    return !this.collapsedRoots().has(scope);
  }

  protected toggleRootExpand(scope: TreeScope): void {
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

  /** Whether this node has no expand-worthy content at all — no subfolders and no leaf assets. */
  protected isLeafOnly(node: FolderView, scope: TreeScope): boolean {
    return (node.children ?? []).length === 0 && this.folderAssets(node, scope).length === 0;
  }

  /** Mirrors the store trees' own `expanded && hasChildren ? 'folder_open' : 'folder'` icon rule
   * (`sf-folder-node`/`sf-media-folder-node`/`sf-nav-tree-node`/`sf-template-folder-node`) — this
   * panel's tree is read-only/selection-only, but should look identical otherwise. */
  protected folderIcon(node: FolderView, scope: TreeScope): string {
    const hasContent = (node.children ?? []).length > 0 || this.folderAssets(node, scope).length > 0;
    return this.isExpanded(node) && hasContent ? 'folder_open' : 'folder';
  }

  /** Per-type leaf icon, matching each store's own leaf row exactly where one exists
   * (`sf-page-nav-node`/`sf-template-nav-node` use `description`; `sf-nav-tree-node` uses `link`
   * for a `PAGE_REFERENCE`). Media has no tree-leaf equivalent in its own store (media items are
   * grid cards there, not tree rows), so `perm_media` — already used for the Media nav icon
   * elsewhere in this app — is the closest consistent choice rather than reusing a type this
   * scope was never given a tree leaf for. */
  protected leafIcon(scope: TreeScope): string {
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

  protected isStoreFull(scope: TreeScope): boolean {
    return this.fullStores().has(STORE_SCOPE_FOR[scope]);
  }

  protected toggleFullStore(scope: TreeScope): void {
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

  protected treeFor(scope: TreeScope): FolderView[] {
    switch (scope) {
      case 'PAGE':
        return this.store.pageFolderTree();
      case 'MEDIA':
        return this.store.mediaFolderTree();
      case 'PAGE_REFERENCE':
        return this.store.navigationFolderTree();
      case 'TEMPLATES':
        return this.store.templateFolderTree();
      case 'GLOBAL_SET':
        return this.store.globalsFolderTree();
      case 'RECORD_SET':
        return this.contentFolders();
    }
  }

  /** Every folder uuid in the tree plus every leaf asset uuid in the scope (including root-level
   * ones) — used to purge stale individual picks when a store-level full-select is turned on. */
  private collectAllUuidsInTree(scope: TreeScope): string[] {
    const result: string[] = [];
    for (const asset of this.rootAssets(scope)) {
      if (asset.uuid) {
        result.push(asset.uuid);
      }
    }
    const walk = (list: FolderView[]) => {
      for (const node of list) {
        const key = this.nodeKey(node);
        if (key) {
          result.push(key);
          for (const asset of this.folderAssets(node, scope)) {
            if (asset.uuid) {
              result.push(asset.uuid);
            }
          }
        }
        walk(node.children ?? []);
      }
    };
    walk(this.topLevelFolders(scope));
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
    for (const asset of this.rootAssets(scope)) {
      if (asset.uuid && asset.uuid !== excludeKey) {
        additions.add(asset.uuid);
      }
    }
    const containsExcluded = (node: FolderView): boolean => {
      if (this.nodeKey(node) === excludeKey) {
        return true;
      }
      if (this.folderAssets(node, scope).some((a) => a.uuid === excludeKey)) {
        return true;
      }
      return (node.children ?? []).some((child) => containsExcluded(child));
    };
    const walk = (list: FolderView[]) => {
      for (const node of list) {
        const key = this.nodeKey(node);
        if (key === excludeKey) {
          continue; // the excluded node itself contributes nothing
        }
        if (containsExcluded(node)) {
          for (const asset of this.folderAssets(node, scope)) {
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
    walk(this.topLevelFolders(scope));
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

  protected onToggleChannels(event: Event): void {
    this.includeChannels.set((event.target as HTMLInputElement).checked);
  }

  protected onToggleGenerationTargets(event: Event): void {
    this.includeGenerationTargets.set((event.target as HTMLInputElement).checked);
  }

  protected onToggleSchedules(event: Event): void {
    this.includeSchedules.set((event.target as HTMLInputElement).checked);
  }

  // ── Export ───────────────────────────────────────────────────────────────

  protected exportNow(): void {
    if (this.exportDisabled() || this.exporting()) {
      return;
    }
    const request: ExportSelectionRequest = {
      assetUuids: Array.from(this.selected()),
      includeChannels: this.includeChannels(),
      includeGenerationTargets: this.includeGenerationTargets(),
      fullStores: Array.from(this.fullStores()),
      includeSchedules: this.includeSchedules(),
    };
    this.exporting.set(true);
    this.exportError.set(null);
    this.importExport.exportSelection(this.projectKey(), request).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        this.triggerDownload(blob, `${this.projectKey()}-export.zip`);
        this.toasts.show('Export ready — download started.', 'success');
      },
      error: () => {
        this.exporting.set(false);
        this.exportError.set('Could not export — try again in a moment.');
        this.toasts.show('Could not export — try again in a moment.', 'error');
      },
    });
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
