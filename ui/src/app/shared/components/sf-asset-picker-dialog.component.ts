import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { assetIcon, assetLocation } from '../../core/assets/asset-ref';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ContentService, type DatasetSummaryView, type RecordSetSummaryView } from '../../features/content/content.service';
import { isReleaseStatus, statusFor, type ReleaseStatus } from '../../features/release/release-status.util';
import { SfDialogComponent, SfDialogFooterDirective } from './dialog/sf-dialog.component';
import { SfBadgeComponent } from './display/sf-badge.component';
import { SfMediaThumbComponent } from './display/sf-media-thumb.component';
import { SfSearchInputComponent } from './forms/sf-search-input.component';
import { SfSegmentedComponent, type SfSegmentedOption } from './forms/sf-segmented.component';
import { SfSelectComponent, type SfSelectOption } from './forms/sf-select.component';
import { SfBannerComponent } from './layout/sf-banner.component';
import { SfSkeletonComponent } from './layout/sf-skeleton.component';
import { SfButtonComponent } from './sf-button.component';
import { SfEmptyStateComponent } from './sf-empty-state.component';
import { SfIconComponent } from './sf-icon.component';
import { SfTreeComponent } from './sf-tree.component';
import type { SfTreeLoader, SfTreeNode } from './tree/tree-model';
import {
  folderOptions,
  folderRows,
  folderTrail,
  matchingDatasets,
  pickerDatasets,
  pickerRecordSets,
  pickerTypeOptions,
  recordCountLabel,
  type PickerType,
} from './asset-picker.util';

type AssetSummaryView = components['schemas']['AssetSummaryView'];
type FolderView = components['schemas']['FolderView'];

/** One row of the result list: an asset, or (type `RECORD`/`RECORD_SET`) a record or record set with its dataset. */
interface PickerItem {
  uuid?: string;
  uid?: string;
  displayName?: string;
  type?: string;
  dataset?: string;
  /** A record set's live record count. */
  recordCount?: number;
  /** Indentation of a folder row (Navigation folders). */
  depth?: number;
  /** The row's detail line when it is not the folder path or the uid. */
  meta?: string;
  /** Where the asset lives (`/pages_root/news/`). */
  folderPath?: string;
  /** The release status for the language being edited, when it says something. */
  status?: ReleaseStatus | null;
}

export interface AssetPicked {
  uuid: string;
  assetType: string;
  label: string;
  /** Records and record sets: their dataset's name. */
  dataset?: string;
  /** Record sets: their live record count. */
  recordCount?: number;
}

/** Debounce of the search field. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The asset picker (M35.17): a large dialog with a **toolbar** — the type switch (only the types the field allows, hidden
 * for a single type), the dataset select for records, a debounced search with the result count — a **folder tree** on the
 * left for the two types that have folders (pages, media: an "All …" root and the store's folders, a breadcrumb above the
 * results) and the **results** on the right. A row shows its icon (a thumbnail for media), name, a dataset badge and the record count
 * (records, record sets), where it lives (the folder path; the uid in developer mode), a status badge and — for the
 * Navigation folders — its indentation. Records (M19.4.2) are listed per dataset through the server-paged record listing, with a dataset
 * switch unless a `dataset` restriction pins it; record sets (M25.5.3) are one flat list with their dataset and record
 * count, narrowed to the `dataset` restriction's sets.
 *
 * It picks one thing: a click or the arrows select (the footer names it), Enter or a double click choose, *Choose* stays
 * disabled until something is selected, Escape cancels. Asked for by name (`allowedTypes`), it also picks a pagination source
 * (M21.4.1): a folder of the Navigation store, or a dataset. Narrow, the tree becomes a folder select. Loading shows a
 * skeleton, an empty result a message per type with *Clear search*, a failed load *Retry*.
 */
@Component({
  selector: 'sf-asset-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfEmptyStateComponent,
    SfIconComponent,
    SfMediaThumbComponent,
    SfSearchInputComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfSkeletonComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  templateUrl: './sf-asset-picker-dialog.component.html',
  styleUrl: './sf-asset-picker-dialog.component.scss',
})
export class SfAssetPickerDialogComponent {
  readonly projectKey = input.required<string>();
  /** Preselects the type switch; ignored if not in `allowedTypes` (when given). */
  readonly initialType = input<string | null>(null);
  /** Restricts the type switch to these asset types (from the editor's CDL `assetTypes`); omit/empty allows any type. */
  readonly allowedTypes = input<string[] | null>(null);
  /** Restricts picking to records and record sets of this dataset uid (the reference editor's `dataset` attribute). */
  readonly dataset = input<string | null>(null);

  readonly picked = output<AssetPicked>();
  readonly closed = output<void>();

  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly content = inject(ContentService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly developerMode = inject(DeveloperModeService, { optional: true });
  private readonly editingLocale = inject(EditingLocaleStore, { optional: true });
  private readonly search$ = new Subject<string>();
  private readonly transloco = inject(TranslocoService);
  private readonly language = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly typeOptions = computed(() => pickerTypeOptions(this.allowedTypes(), this.dataset()));
  protected readonly type = signal<PickerType>('PAGE');
  private readonly allDatasets = signal<DatasetSummaryView[]>([]);
  protected readonly datasets = computed(() => pickerDatasets(this.allDatasets(), this.dataset()));
  protected readonly datasetUuid = signal('');
  /** What is typed in the search field; {@link search} follows it after the debounce. */
  protected readonly typed = signal('');
  protected readonly search = signal('');
  protected readonly folderUuid = signal('');
  protected readonly folderPath = signal('');
  protected readonly items = signal<PickerItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  private readonly reloadTick = signal(0);
  protected readonly developer = computed(() => this.developerMode?.enabled() ?? false);

  /** Pagination sources only: the dialog then picks a source, not an asset. */
  protected readonly picksSources = computed(() =>
    this.typeOptions().every((option) => option.value === 'NAV_FOLDER' || option.value === 'DATASET'),
  );
  protected readonly showSwitch = computed(() => this.typeOptions().length > 1);
  protected readonly segmented = computed(() => this.typeOptions().length <= 3);
  protected readonly title = computed(() => {
    this.language();
    const options = this.typeOptions();
    if (this.picksSources()) {
      return this.transloco.translate('forms.picker.title.source');
    }
    return options.length === 1
      ? this.transloco.translate(`forms.picker.title.one.${options[0].value}`)
      : this.transloco.translate('forms.picker.title.asset');
  });
  protected readonly typeSegments = computed<SfSegmentedOption<PickerType>[]>(() => {
    this.language();
    return this.typeOptions().map((option) => ({ value: option.value, label: this.transloco.translate(option.labelKey) }));
  });
  protected readonly typeSelectOptions = computed<SfSelectOption<PickerType>[]>(() =>
    this.typeSegments().map((option) => ({ value: option.value, label: option.label })),
  );
  protected readonly datasetOptions = computed<SfSelectOption<string>[]>(() =>
    this.datasets().map((dataset) => ({ value: dataset.uuid ?? '', label: dataset.displayName ?? dataset.uid ?? '' })),
  );
  /** The dataset shown in the select: the chosen one, else the first. */
  protected readonly activeDataset = computed(() => this.datasetUuid() || (this.datasets().length > 0 ? (this.datasets()[0].uuid ?? '') : ''));
  protected readonly showDatasets = computed(() => this.type() === 'RECORD' && this.datasets().length > 1);
  protected readonly emptyKind = computed(() => (this.type() === 'RECORD' ? 'record' : this.hasFolders() ? 'folder' : 'plain'));

  private navigationTree: FolderView[] | null = null;
  private recordSets: RecordSetSummaryView[] | null = null;

  protected readonly hasFolders = computed(() => this.type() === 'PAGE' || this.type() === 'MEDIA' || this.type() === 'PAGE_REFERENCE');
  /** The Navigation store's folders (loaded when the navigation entries are listed). */
  private readonly navigationFolders = signal<FolderView[]>([]);
  /**
   * Raw scope tree — for PAGE/MEDIA this is always a single-entry array holding the fixed, protected "All pages"/"All media"
   * wrapper root, unwrapped by `tree` below since the dialog has its own "All" root entry.
   */
  private readonly rawTree = computed<FolderView[]>(() => {
    if (this.type() === 'PAGE') {
      return this.store.pageFolderTree();
    }
    if (this.type() === 'MEDIA') {
      return this.store.mediaFolderTree();
    }
    if (this.type() === 'PAGE_REFERENCE') {
      return this.navigationFolders();
    }
    return [];
  });
  /**
   * The store's real top-level folders — the wrapper root's children. The Navigation store's folders come as they are
   * when its tree has no single protected root.
   */
  protected readonly tree = computed<FolderView[]>(() => {
    const raw = this.rawTree();
    return raw.length === 1 && (raw[0].protectedFolder || this.type() !== 'PAGE_REFERENCE') ? (raw[0].children ?? []) : raw;
  });
  /** The "All …" root and the open folder's trail, for the breadcrumb. */
  protected readonly trail = computed(() => folderTrail(this.tree(), this.folderUuid()));
  protected readonly folderSelectOptions = computed<SfSelectOption<string>[]>(() => {
    this.language();
    return [{ value: '', label: this.transloco.translate(`forms.picker.all.${this.type()}`) }, ...folderOptions(this.tree())];
  });
  /** The tree's lazy loader: a node's folders when it opens. */
  protected readonly loader = computed<SfTreeLoader<FolderView>>(() => {
    const roots = this.tree();
    const toNode = (folder: FolderView): SfTreeNode<FolderView> => ({
      id: folder.uuid ?? '',
      label: folder.displayName ?? folder.uid ?? '',
      icon: 'folder',
      hasChildren: (folder.children ?? []).length > 0,
      data: folder,
    });
    return (parent) => (parent ? (parent.data?.children ?? []) : roots).map(toNode);
  });

  protected readonly selected = computed(() => this.items().find((item) => item.uuid === this.selectedId()) ?? null);
  protected readonly selectedMeta = computed(() => {
    const item = this.selected();
    return item ? this.metaOf(item) : '';
  });

  constructor() {
    effect(
      () => {
        const options = this.typeOptions();
        const initial = this.initialType();
        const preferred = initial && options.some((t) => t.value === initial) ? initial : options[0]?.value;
        if (preferred) {
          this.type.set(preferred as PickerType);
        }
      },
      { allowSignalWrites: true },
    );

    effect(() => {
      this.type();
      this.folderPath();
      this.search();
      this.datasetUuid();
      this.reloadTick();
      untracked(() => this.reload());
    });

    // The selection ends when its row leaves the list (a search, a folder, another type).
    effect(() => {
      const id = this.selectedId();
      const items = this.items();
      if (id !== null && !this.loading() && !items.some((item) => item.uuid === id)) {
        untracked(() => this.selectedId.set(null));
      }
    });

    this.search$
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((q) => this.search.set(q));
  }

  protected setType(type: PickerType | null): void {
    if (type && type !== this.type()) {
      this.type.set(type);
      this.folderUuid.set('');
      this.folderPath.set('');
      this.selectedId.set(null);
    }
  }

  protected setDataset(uuid: string | null): void {
    this.datasetUuid.set(uuid ?? '');
    this.selectedId.set(null);
  }

  protected onSearch(value: string): void {
    this.typed.set(value);
    this.search$.next(value);
  }

  protected clearSearch(): void {
    this.typed.set('');
    this.search$.next('');
    this.search.set('');
  }

  protected selectFolder(node: FolderView | null): void {
    this.folderUuid.set(node?.uuid ?? '');
    this.folderPath.set(node?.path ?? '');
  }

  protected selectFolderByUuid(uuid: string | null): void {
    const trail = folderTrail(this.tree(), uuid);
    this.selectFolder(trail.at(-1) ?? null);
  }

  protected onTreeOpen(node: SfTreeNode<FolderView>): void {
    this.selectFolder(node.data ?? null);
  }

  protected retry(): void {
    this.failed.set(false);
    this.reloadTick.update((tick) => tick + 1);
  }

  protected select(item: PickerItem): void {
    this.selectedId.set(item.uuid ?? null);
  }

  protected pick(item: PickerItem | null): void {
    if (!item?.uuid) {
      return;
    }
    this.picked.emit({
      uuid: item.uuid,
      assetType: item.type ?? this.type(),
      label: item.displayName ?? item.uid ?? item.uuid,
      dataset: item.dataset,
      recordCount: item.recordCount,
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected iconOf(item: PickerItem): string {
    return item.type === 'NAV_FOLDER' ? 'folder' : item.type === 'DATASET' ? 'database' : assetIcon(item.type ?? this.type());
  }

  protected nameOf(item: PickerItem): string {
    return item.displayName ?? item.uid ?? item.uuid ?? '';
  }

  /** Where the row lives: the folder path, or in developer mode the uid. */
  protected metaOf(item: PickerItem): string {
    if (this.developer()) {
      return item.uid ?? '';
    }
    return item.meta ?? assetLocation(item.folderPath, item.type ?? this.type()) ?? '';
  }

  protected recordCountText(count: number | undefined): string {
    return recordCountLabel(count, (key, params) => this.transloco.translate(key, params));
  }

  protected statusTone(status: ReleaseStatus): 'success' | 'warning' | 'neutral' {
    return status === 'PUBLISHED' ? 'success' : status === 'CHANGED' ? 'warning' : 'neutral';
  }

  protected indent(item: PickerItem): number {
    return item.depth ?? 0;
  }

  /** Arrows, Home and End move the selection through the list; Enter chooses it. */
  protected onListKeydown(event: KeyboardEvent): void {
    const list = this.items();
    if (list.length === 0) {
      return;
    }
    const index = list.findIndex((item) => item.uuid === this.selectedId());
    let next = index;
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(list.length - 1, index + 1);
        break;
      case 'ArrowUp':
        next = Math.max(0, index < 0 ? 0 : index - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = list.length - 1;
        break;
      case 'Enter':
        event.preventDefault();
        this.pick(this.selected());
        return;
      default:
        return;
    }
    event.preventDefault();
    this.focusRow(list[next]);
  }

  /** From the search field, ArrowDown steps into the list. */
  protected onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' && this.items().length > 0) {
      event.preventDefault();
      this.focusRow(this.selected() ?? this.items()[0]);
    }
  }

  private focusRow(item: PickerItem): void {
    this.selectedId.set(item.uuid ?? null);
    queueMicrotask(() => document.querySelector<HTMLElement>(`[data-picker-id="${item.uuid}"]`)?.focus());
  }

  // ── Loading (the same calls as before the redesign) ─────────────────────────────────────

  private fail(): void {
    this.items.set([]);
    this.failed.set(true);
    this.loading.set(false);
  }

  private reload(): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
    this.failed.set(false);
    if (this.type() === 'RECORD') {
      this.reloadRecords(key);
      return;
    }
    if (this.type() === 'RECORD_SET') {
      this.reloadRecordSets(key);
      return;
    }
    if (this.type() === 'NAV_FOLDER') {
      this.reloadNavigationFolders(key);
      return;
    }
    if (this.type() === 'DATASET') {
      this.reloadDatasets(key);
      return;
    }
    if (this.type() === 'PAGE_REFERENCE' && this.navigationTree === null) {
      this.api.listFolders(key, 'NAVIGATION', 10).subscribe({
        next: (tree) => {
          this.navigationTree = tree ?? [];
          this.navigationFolders.set(this.navigationTree);
        },
        // The entries still list; only the folder tree is missing.
        error: () => (this.navigationTree = []),
      });
    }
    this.loading.set(true);
    const locale = this.editingLocale?.locale() ?? null;
    this.api
      .listAssets(key, {
        type: this.type(),
        q: this.search().trim() || undefined,
        folder: this.folderPath() || undefined,
        page: 0,
        size: 100,
      })
      .subscribe({
        next: (res) => {
          this.items.set(
            ((res.content ?? []) as AssetSummaryView[]).map((asset) => ({
              ...asset,
              status: statusFor(asset.release, locale),
            })),
          );
          this.loading.set(false);
        },
        error: () => this.fail(),
      });
  }

  /** The Navigation store's folders as an indented tree, filtered by the search (loaded once per dialog). */
  private reloadNavigationFolders(key: string): void {
    const show = (tree: FolderView[]) =>
      this.items.set(
        folderRows(tree, this.search()).map((row) => ({
          uuid: row.uuid,
          uid: row.uid,
          displayName: row.displayName,
          type: 'NAV_FOLDER',
          depth: row.depth,
          meta: row.path ?? row.uid,
        })),
      );
    if (this.navigationTree) {
      show(this.navigationTree);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.api.listFolders(key, 'NAVIGATION', 10).subscribe({
      next: (tree) => {
        this.navigationTree = tree ?? [];
        show(this.navigationTree);
        this.loading.set(false);
      },
      error: () => this.fail(),
    });
  }

  /**
   * The project's live record sets (loaded once per dialog), narrowed to the `dataset` restriction and the search; each
   * row names its dataset and record count.
   */
  private reloadRecordSets(key: string): void {
    const show = (sets: RecordSetSummaryView[]) =>
      this.items.set(
        pickerRecordSets(sets, this.dataset(), this.search()).map((set) => ({
          uuid: set.uuid,
          uid: set.uid,
          displayName: set.displayName,
          type: 'RECORD_SET',
          dataset: set.dataset?.displayName ?? set.dataset?.uid,
          recordCount: set.recordCount ?? 0,
        })),
      );
    if (this.recordSets) {
      show(this.recordSets);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.content.listRecordSets(key).subscribe({
      next: (sets) => {
        this.recordSets = sets ?? [];
        if (this.type() === 'RECORD_SET') {
          show(this.recordSets);
        }
        this.loading.set(false);
      },
      error: () => this.fail(),
    });
  }

  /** The project's datasets, filtered by the search. */
  private reloadDatasets(key: string): void {
    const show = () =>
      this.items.set(
        matchingDatasets(this.allDatasets(), this.search()).map((d) => ({
          uuid: d.uuid,
          uid: d.uid,
          displayName: d.displayName,
          type: 'DATASET',
        })),
      );
    if (this.allDatasets().length > 0) {
      show();
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.content.listDatasets(key).subscribe({
      next: (datasets) => {
        this.allDatasets.set(datasets ?? []);
        show();
        this.loading.set(false);
      },
      error: () => this.fail(),
    });
  }

  /** Records of the chosen dataset, searched by name through the paged record listing. */
  private reloadRecords(key: string): void {
    if (this.allDatasets().length === 0) {
      this.loading.set(true);
      this.content.listDatasets(key).subscribe({
        next: (datasets) => {
          this.allDatasets.set(datasets ?? []);
          const first = this.datasets()[0]?.uuid ?? '';
          if (first) {
            this.datasetUuid.set(first);
          } else {
            this.items.set([]);
            this.loading.set(false);
          }
        },
        error: () => this.fail(),
      });
      return;
    }
    const uuid = this.datasetUuid() || this.datasets()[0]?.uuid;
    const dataset = this.datasets().find((d) => d.uuid === uuid);
    if (!uuid || !dataset) {
      this.items.set([]);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.content
      .listRecords(key, uuid, { page: 0, size: 100, sort: [], q: this.search().trim() || undefined })
      .subscribe({
        next: (res) => {
          this.items.set(
            (res.content ?? []).map((row) => ({
              uuid: row.uuid,
              uid: row.uid,
              displayName: row.displayName,
              type: 'RECORD',
              dataset: dataset.displayName ?? dataset.uid,
            })),
          );
          this.loading.set(false);
        },
        error: () => this.fail(),
      });
  }
}
