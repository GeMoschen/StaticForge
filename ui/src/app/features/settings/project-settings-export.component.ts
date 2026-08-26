import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
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
type TreeScope = 'PAGE' | 'MEDIA';

interface FolderCheckState {
  checked: boolean;
  indeterminate: boolean;
}

/**
 * Project settings tab: "Export" half of `M10`'s selective export/import — lets the user
 * pick a subset of the project's pages/media (via the two folder trees already loaded by
 * `ProjectContextStore`) plus channels/generation-targets toggles, then downloads the
 * resulting ZIP. Mirrors `project-settings-url-registry.component`'s shape: signals for
 * state, services via `inject()`, reload-on-`projectKey`-change effect.
 *
 * Note on scope: templates (`PAGE_TEMPLATE`/`SECTION_TEMPLATE`) live outside both folder
 * trees in this codebase, so they are not reachable from this picker — only pages and
 * media, which is what `pageFolderTree`/`mediaFolderTree` expose. A full asset-type
 * picker would need a separate flat list akin to `sf-asset-picker-dialog`'s non-tree
 * types; out of scope for this tab per the task doc's "folders and assets" framing.
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

  /** Explicitly-checked uuids (folders and/or leaf assets) — the backend expands a folder pick into its full live subtree, so a folder's own uuid is all that's ever needed in the request. */
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly expanded = signal<Set<string>>(new Set());
  protected readonly assetsByFolder = signal<Map<string, AssetSummaryView[]>>(new Map());
  protected readonly loadingFolders = signal<Set<string>>(new Set());

  protected readonly includeChannels = signal(false);
  protected readonly includeGenerationTargets = signal(false);

  protected readonly exporting = signal(false);
  protected readonly exportError = signal<string | null>(null);

  protected readonly exportDisabled = computed(
    () => this.selected().size === 0 && !this.includeChannels() && !this.includeGenerationTargets(),
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

  protected folderState(node: FolderView, ancestorChecked: boolean): FolderCheckState {
    const key = this.nodeKey(node);
    if (ancestorChecked || (key !== '' && this.selected().has(key))) {
      return { checked: true, indeterminate: false };
    }
    const descendants = this.collectDescendantUuids(node);
    if (descendants.length === 0) {
      return { checked: false, indeterminate: false };
    }
    const checkedCount = descendants.filter((u) => this.selected().has(u)).length;
    if (checkedCount === 0) {
      return { checked: false, indeterminate: false };
    }
    if (checkedCount === descendants.length) {
      return { checked: true, indeterminate: false };
    }
    return { checked: false, indeterminate: true };
  }

  protected assetChecked(asset: AssetSummaryView, ancestorChecked: boolean): boolean {
    return ancestorChecked || (!!asset.uuid && this.selected().has(asset.uuid));
  }

  protected toggleFolder(node: FolderView, ancestorChecked: boolean): void {
    if (ancestorChecked) {
      return;
    }
    const key = this.nodeKey(node);
    if (!key) {
      return;
    }
    this.toggleUuid(key);
  }

  protected toggleAsset(asset: AssetSummaryView, ancestorChecked: boolean): void {
    if (ancestorChecked || !asset.uuid) {
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
