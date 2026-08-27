import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ExportSelectionRequest, ImportExportService } from './import-export.service';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

/** The three folder-tree scopes shown in this panel — the `type` value `ApiClient.listAssets` expects for each. */
type TreeScope = 'PAGE' | 'MEDIA' | 'PAGE_REFERENCE';
/** The `FolderScope`/`ExportSelectionRequest.fullStores` string for each tree scope. */
type StoreScope = 'PAGES' | 'MEDIA' | 'NAVIGATION';

const STORE_SCOPE_FOR: Record<TreeScope, StoreScope> = {
  PAGE: 'PAGES',
  MEDIA: 'MEDIA',
  PAGE_REFERENCE: 'NAVIGATION',
};

/** The two flat (non-tree) asset types offered as searchable lists (M11.3.1). */
type TemplateType = 'PAGE_TEMPLATE' | 'SECTION_TEMPLATE';

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
  protected readonly assetsByFolder = signal<Map<string, AssetSummaryView[]>>(new Map());
  protected readonly loadingFolders = signal<Set<string>>(new Set());

  protected readonly includeChannels = signal(false);
  protected readonly includeGenerationTargets = signal(false);

  // ── Template lists (flat, searchable — M11.3.1) ─────────────────────────
  protected readonly pageTemplateSearch = signal('');
  protected readonly sectionTemplateSearch = signal('');
  protected readonly pageTemplateItems = signal<AssetSummaryView[]>([]);
  protected readonly sectionTemplateItems = signal<AssetSummaryView[]>([]);
  protected readonly loadingPageTemplates = signal(false);
  protected readonly loadingSectionTemplates = signal(false);
  private readonly pageTemplateSearch$ = new Subject<string>();
  private readonly sectionTemplateSearch$ = new Subject<string>();

  protected readonly exporting = signal(false);
  protected readonly exportError = signal<string | null>(null);

  protected readonly exportDisabled = computed(
    () =>
      this.selected().size === 0 &&
      this.fullStores().size === 0 &&
      !this.includeChannels() &&
      !this.includeGenerationTargets(),
  );

  constructor() {
    effect(() => {
      const key = this.projectKey();
      if (!key) {
        return;
      }
      untracked(() => {
        this.store.loadFor(key).subscribe();
      });
    });

    this.pageTemplateSearch$
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((q) => this.pageTemplateSearch.set(q));
    this.sectionTemplateSearch$
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((q) => this.sectionTemplateSearch.set(q));

    effect(() => {
      const key = this.projectKey();
      const q = this.pageTemplateSearch();
      if (!key) {
        return;
      }
      untracked(() => this.reloadTemplates('PAGE_TEMPLATE', q));
    });
    effect(() => {
      const key = this.projectKey();
      const q = this.sectionTemplateSearch();
      if (!key) {
        return;
      }
      untracked(() => this.reloadTemplates('SECTION_TEMPLATE', q));
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

  protected toggleExpand(node: FolderView, scope: TreeScope): void {
    const key = this.nodeKey(node);
    if (!key) {
      return;
    }
    const willExpand = !this.expanded().has(key);
    this.expanded.update((set) => {
      const next = new Set(set);
      if (willExpand) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
    if (willExpand && !this.assetsByFolder().has(key) && !this.loadingFolders().has(key)) {
      this.fetchFolderAssets(node, scope, key);
    }
  }

  private fetchFolderAssets(node: FolderView, scope: TreeScope, key: string): void {
    this.loadingFolders.update((set) => {
      const next = new Set(set);
      next.add(key);
      return next;
    });
    this.api
      .listAssets(this.projectKey(), { type: scope, folder: node.path, page: 0, size: 200 })
      .subscribe({
        next: (res) => {
          this.assetsByFolder.update((map) => {
            const next = new Map(map);
            next.set(key, res.content ?? []);
            return next;
          });
          this.loadingFolders.update((set) => {
            const next = new Set(set);
            next.delete(key);
            return next;
          });
        },
        error: () => {
          this.loadingFolders.update((set) => {
            const next = new Set(set);
            next.delete(key);
            return next;
          });
        },
      });
  }

  /** All uuids "beneath" this node — its own leaf assets (if fetched) plus every descendant sub-folder and their own fetched leaf assets, recursively. Drives the folder's tri-state indicator. */
  private collectDescendantUuids(node: FolderView): string[] {
    const key = this.nodeKey(node);
    const result: string[] = key ? [...this.assetsByFolder().get(key) ?? []].map((a) => a.uuid).filter((u): u is string => !!u) : [];
    for (const child of node.children ?? []) {
      const childKey = this.nodeKey(child);
      if (childKey) {
        result.push(childKey);
      }
      result.push(...this.collectDescendantUuids(child));
    }
    return result;
  }

  /** True if this node is covered by a direct pick — its own uuid is selected, an ancestor folder pick covers it, or every one of its descendants is individually selected. Drives both the tri-state's `explicit` branch and whether a folder-level pick should disable its children (independent of `fullStores`, which is checked separately so it never disables anything — see `folderState`). */
  private nodeIsExplicitFolderPick(node: FolderView, ancestorFolderChecked: boolean): boolean {
    const key = this.nodeKey(node);
    if (ancestorFolderChecked || (key !== '' && this.selected().has(key))) {
      return true;
    }
    const descendants = this.collectDescendantUuids(node);
    return descendants.length > 0 && descendants.every((u) => this.selected().has(u));
  }

  protected folderState(node: FolderView, scope: TreeScope, ancestorFolderChecked: boolean): CheckState {
    if (this.fullStores().has(STORE_SCOPE_FOR[scope]) || this.nodeIsExplicitFolderPick(node, ancestorFolderChecked)) {
      return 'explicit';
    }
    const descendants = this.collectDescendantUuids(node);
    if (descendants.length === 0) {
      return 'unchecked';
    }
    const checkedCount = descendants.filter((u) => this.selected().has(u)).length;
    return checkedCount > 0 ? 'implicit' : 'unchecked';
  }

  /** The `ancestorChecked` context to pass down to this node's children — deliberately NOT `fullStores`-aware, so a store-level full-select never disables individual rows (they must stay clickable to drive the "uncheck one item" policy in `toggleFolder`/`toggleAsset`). */
  protected childAncestorChecked(node: FolderView, ancestorFolderChecked: boolean): boolean {
    return this.nodeIsExplicitFolderPick(node, ancestorFolderChecked);
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

  protected folderAssets(node: FolderView): AssetSummaryView[] {
    return this.assetsByFolder().get(this.nodeKey(node)) ?? [];
  }

  protected isFolderLoading(node: FolderView): boolean {
    return this.loadingFolders().has(this.nodeKey(node));
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
    const treeUuids = this.collectAllUuidsInTree(this.treeFor(scope));
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

  private treeFor(scope: TreeScope): FolderView[] {
    switch (scope) {
      case 'PAGE':
        return this.store.pageFolderTree();
      case 'MEDIA':
        return this.store.mediaFolderTree();
      case 'PAGE_REFERENCE':
        return this.store.navigationFolderTree();
    }
  }

  /** Every folder uuid in the tree (always fully loaded, depth 10) plus every already-fetched leaf asset uuid — used to purge stale individual picks when a store-level full-select is turned on. */
  private collectAllUuidsInTree(nodes: FolderView[]): string[] {
    const result: string[] = [];
    const assetsMap = this.assetsByFolder();
    const walk = (list: FolderView[]) => {
      for (const node of list) {
        const key = this.nodeKey(node);
        if (key) {
          result.push(key);
          for (const asset of assetsMap.get(key) ?? []) {
            if (asset.uuid) {
              result.push(asset.uuid);
            }
          }
        }
        walk(node.children ?? []);
      }
    };
    walk(nodes);
    return result;
  }

  /**
   * Builds the explicit per-node uuid set equivalent to "everything in this store except
   * `excludeKey`": every sibling folder not on the path to the excluded node gets its own uuid
   * (its subtree cascades server-side); folders on the path get their non-excluded loaded leaf
   * assets added directly and are walked into recursively instead of being added wholesale.
   */
  private collectStoreSelectionExcluding(nodes: FolderView[], excludeKey: string): Set<string> {
    const additions = new Set<string>();
    const containsExcluded = (node: FolderView): boolean => {
      if (this.nodeKey(node) === excludeKey) {
        return true;
      }
      if (this.folderAssets(node).some((a) => a.uuid === excludeKey)) {
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
          for (const asset of this.folderAssets(node)) {
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
    walk(nodes);
    return additions;
  }

  private explodeFullStoreExcluding(scope: TreeScope, excludeKey: string): void {
    const additions = this.collectStoreSelectionExcluding(this.treeFor(scope), excludeKey);
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

  // ── Template lists (M11.3.1) ────────────────────────────────────────────

  protected onPageTemplateSearchInput(event: Event): void {
    this.pageTemplateSearch$.next((event.target as HTMLInputElement).value);
  }

  protected onSectionTemplateSearchInput(event: Event): void {
    this.sectionTemplateSearch$.next((event.target as HTMLInputElement).value);
  }

  protected templateChecked(item: AssetSummaryView): boolean {
    return !!item.uuid && this.selected().has(item.uuid);
  }

  protected toggleTemplateItem(item: AssetSummaryView): void {
    if (!item.uuid) {
      return;
    }
    this.toggleUuid(item.uuid);
  }

  private reloadTemplates(type: TemplateType, q: string): void {
    const loadingSignal = type === 'PAGE_TEMPLATE' ? this.loadingPageTemplates : this.loadingSectionTemplates;
    const itemsSignal = type === 'PAGE_TEMPLATE' ? this.pageTemplateItems : this.sectionTemplateItems;
    loadingSignal.set(true);
    this.api
      .listAssets(this.projectKey(), { type, q: q.trim() || undefined, page: 0, size: 200 })
      .subscribe({
        next: (res) => {
          itemsSignal.set(res.content ?? []);
          loadingSignal.set(false);
        },
        error: () => {
          itemsSignal.set([]);
          loadingSignal.set(false);
        },
      });
  }

  // ── Toggles ──────────────────────────────────────────────────────────────

  protected onToggleChannels(event: Event): void {
    this.includeChannels.set((event.target as HTMLInputElement).checked);
  }

  protected onToggleGenerationTargets(event: Event): void {
    this.includeGenerationTargets.set((event.target as HTMLInputElement).checked);
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
