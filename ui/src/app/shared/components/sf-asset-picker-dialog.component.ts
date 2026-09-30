import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { SfButtonComponent } from './sf-button.component';
import { SfEmptyStateComponent } from './sf-empty-state.component';
import { SfIconComponent } from './sf-icon.component';
import { SfSpinnerComponent } from './sf-spinner.component';
import { SfAssetPickerFolderNodeComponent } from './sf-asset-picker-folder-node.component';
import { ContentService, type DatasetSummaryView, type RecordSetSummaryView } from '../../features/content/content.service';
import {
  folderRows,
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
  /** The row's detail line; the uid when absent. */
  meta?: string;
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

/**
 * Modal asset picker — a type switch, a folder tree with search for the two
 * types that actually have folders (pages/media), and a flat searchable
 * list for the rest. Records (M19.4.2) are listed per dataset through the
 * server-paged record listing, with a dataset switch unless a `dataset`
 * restriction pins it. Record sets (M25.5.3) are one flat list with their
 * dataset and record count, narrowed to the `dataset` restriction's sets.
 * Used by `sf-reference-editor` to fill an ASSET_REF value, but generic
 * enough for anything that needs to point at an asset.
 *
 * Asked for by name (`allowedTypes`), it also picks a pagination source (M21.4.1): a folder of the Navigation store,
 * listed as its tree, or a dataset. Both are loaded fresh when the dialog opens.
 */
@Component({
  selector: 'sf-asset-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSpinnerComponent,
    SfAssetPickerFolderNodeComponent,
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
  private readonly search$ = new Subject<string>();

  protected readonly typeOptions = computed(() => pickerTypeOptions(this.allowedTypes(), this.dataset()));
  private readonly transloco = inject(TranslocoService);
  protected readonly type = signal<PickerType>('PAGE');
  private readonly allDatasets = signal<DatasetSummaryView[]>([]);
  protected readonly datasets = computed(() => pickerDatasets(this.allDatasets(), this.dataset()));
  protected readonly datasetUuid = signal('');
  protected readonly search = signal('');
  protected readonly folderUuid = signal('');
  protected readonly folderPath = signal('');
  protected readonly items = signal<PickerItem[]>([]);
  protected readonly loading = signal(false);
  /** Pagination sources only: the dialog then picks a source, not an asset. */
  protected readonly picksSources = computed(() =>
    this.typeOptions().every((option) => option.value === 'NAV_FOLDER' || option.value === 'DATASET'),
  );
  protected readonly titleKey = computed(() =>
    this.picksSources() ? 'shared.assetPicker.titleSource' : 'shared.assetPicker.titleAsset',
  );
  protected readonly emptyTitleKey = computed(() => {
    switch (this.type()) {
      case 'RECORD':
        return 'shared.assetPicker.emptyRecord';
      case 'RECORD_SET':
        return 'shared.assetPicker.emptyRecordSet';
      case 'NAV_FOLDER':
        return 'shared.assetPicker.emptyNavFolder';
      case 'DATASET':
        return 'shared.assetPicker.emptyDataset';
      default:
        return 'shared.assetPicker.emptyAsset';
    }
  });
  protected readonly emptyDescriptionKey = computed(() =>
    this.type() === 'RECORD'
      ? 'shared.assetPicker.tryDatasetOrSearch'
      : this.hasFolders()
        ? 'shared.assetPicker.trySearchOrFolder'
        : 'shared.assetPicker.trySearch',
  );
  private navigationTree: FolderView[] | null = null;
  private recordSets: RecordSetSummaryView[] | null = null;

  protected readonly hasFolders = computed(() => this.type() === 'PAGE' || this.type() === 'MEDIA');
  /** Raw scope tree — for PAGE/MEDIA this is always a single-entry array holding the fixed,
   * protected "All Pages"/"All Media" wrapper root (mirrors NAVIGATION/TEMPLATES' own fixed
   * roots); unwrapped by `tree` below since this dialog already has its own "All" root button. */
  private readonly rawTree = computed<FolderView[]>(() => {
    if (this.type() === 'PAGE') {
      return this.store.pageFolderTree();
    }
    if (this.type() === 'MEDIA') {
      return this.store.mediaFolderTree();
    }
    return [];
  });
  /** The store's real top-level folders — the wrapper root's children. */
  protected readonly tree = computed<FolderView[]>(() => this.rawTree()[0]?.children ?? []);

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
      untracked(() => this.reload());
    });

    this.search$
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((q) => this.search.set(q));
  }

  protected onDatasetChange(event: Event): void {
    this.datasetUuid.set((event.target as HTMLSelectElement).value);
  }

  protected onTypeChange(event: Event): void {
    this.type.set((event.target as HTMLSelectElement).value as PickerType);
    this.folderUuid.set('');
    this.folderPath.set('');
  }

  protected onSearchInput(event: Event): void {
    this.search$.next((event.target as HTMLInputElement).value);
  }

  protected selectFolder(node: FolderView | null): void {
    this.folderUuid.set(node?.uuid ?? '');
    this.folderPath.set(node?.path ?? '');
  }

  protected pick(item: PickerItem): void {
    if (!item.uuid) {
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

  private reload(): void {
    const key = this.projectKey();
    if (!key) {
      return;
    }
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
    this.loading.set(true);
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
          this.items.set((res.content ?? []) as AssetSummaryView[]);
          this.loading.set(false);
        },
        error: () => {
          this.items.set([]);
          this.loading.set(false);
        },
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
      return;
    }
    this.loading.set(true);
    this.api.listFolders(key, 'NAVIGATION', 10).subscribe({
      next: (tree) => {
        this.navigationTree = tree ?? [];
        show(this.navigationTree);
        this.loading.set(false);
      },
      error: () => {
        this.items.set([]);
        this.loading.set(false);
      },
    });
  }

  /**
   * The project's live record sets (loaded once per dialog), narrowed to the `dataset` restriction and the
   * search; each row names its dataset and record count.
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
          meta: `${recordCountLabel(set.recordCount, (key, params) => this.transloco.translate(key, params))} · ${set.uid ?? ''}`,
        })),
      );
    if (this.recordSets) {
      show(this.recordSets);
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
      error: () => {
        this.items.set([]);
        this.loading.set(false);
      },
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
      return;
    }
    this.loading.set(true);
    this.content.listDatasets(key).subscribe({
      next: (datasets) => {
        this.allDatasets.set(datasets ?? []);
        show();
        this.loading.set(false);
      },
      error: () => {
        this.items.set([]);
        this.loading.set(false);
      },
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
        error: () => {
          this.items.set([]);
          this.loading.set(false);
        },
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
        error: () => {
          this.items.set([]);
          this.loading.set(false);
        },
      });
  }
}
