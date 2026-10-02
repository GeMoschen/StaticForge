import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfSearchInputComponent } from '../../../../shared/components/forms/sf-search-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfSkeletonComponent } from '../../../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfTreeComponent } from '../../../../shared/components/sf-tree.component';
import type { SfTreeLoader, SfTreeNode } from '../../../../shared/components/tree/tree-model';
import { injectSampleText } from '../changes/sample-area.util';
import { HERO_SVG } from '../sample-preview';
import { SampleState } from '../sample-state';
import {
  PickerFolder,
  PickerItem,
  PickerType,
  folderTrail,
  hasFolders,
  pickerDatasets,
  pickerFolders,
  pickerTypes,
  queryPicker,
} from './picker-data';

const ICONS: Readonly<Record<PickerType, string>> = {
  PAGE: 'description',
  MEDIA: 'image',
  PAGE_REFERENCE: 'menu_open',
  PAGE_TEMPLATE: 'code_blocks',
  SECTION_TEMPLATE: 'view_agenda',
  RECORD: 'table_rows',
  RECORD_SET: 'dataset',
  NAV_FOLDER: 'folder',
  DATASET: 'database',
};

/** How the sample shows the picker's data states for review (`live` = the real behaviour). */
export type PickerReview = 'live' | 'loading' | 'error';

/** Debounce of the search field, as in the real picker. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The asset picker (M35.17 sample): the real picker's whole function in the new design — a large dialog with a
 * **toolbar** (the type switch for the types the field allows, the dataset select for records, a debounced search with
 * the result count), a **folder tree** on the left for the stores that have folders (an "All …" root and the store's
 * folders, opened lazily) and the **results** on the right under a breadcrumb of the open folder. A row shows its icon,
 * name, a dataset badge (records, record sets), a meta line (the folder path — the uid in developer mode), a record count,
 * a status badge, a thumbnail with format and size (media) and the indentation of a navigation folder.
 *
 * It picks one thing: click or the arrows select (the row is highlighted and named in the footer), Enter or a double click
 * choose, *Choose* stays disabled until something is selected, Esc cancels. Without a type switch (one allowed type) the
 * title says what is picked; for the pagination sources the dialog picks a *source*. Narrow, the tree becomes a folder select.
 * Loading shows a skeleton, an empty result a message per type with *Clear search*, and a failed load *Retry*.
 */
@Component({
  selector: 'sf-sample-asset-picker',
  standalone: true,
  imports: [
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSearchInputComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfSkeletonComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-asset-picker.component.scss',
  templateUrl: './sample-asset-picker.component.html',
})
export class SampleAssetPickerComponent implements OnInit {
  /** The types the field allows (`assetTypes`); empty or `null` allows every asset type. */
  readonly allowedTypes = input<readonly PickerType[] | null>(null);
  /** Preselects the type; ignored when it is not allowed. */
  readonly initialType = input<PickerType | null>(null);
  /** The reference editor's `dataset "uid"` restriction: only that dataset's records and record sets. */
  readonly dataset = input<string | null>(null);
  /** The target chosen before: selected, and its type and folder shown, when the picker opens. */
  readonly current = input<PickerItem | null>(null);
  /** Shows the loading or error state for review. */
  readonly review = input<PickerReview>('live');

  readonly choose = output<PickerItem>();
  readonly cancelled = output<void>();

  private readonly sample = inject(SampleState, { optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly t = injectSampleText('styleguide.sample.forms.picker');

  protected readonly types = computed(() => pickerTypes(this.allowedTypes(), this.dataset()));
  protected readonly type = signal<PickerType>('PAGE');
  protected readonly folderId = signal<string | null>(null);
  protected readonly datasetId = signal<string | null>(null);
  protected readonly typed = signal('');
  protected readonly search = signal('');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly developer = computed(() => this.sample?.devMode() ?? false);
  protected readonly thumb = this.sanitizer.bypassSecurityTrustUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(HERO_SVG)}`);

  /** Pagination sources: the dialog picks a source, not an asset. */
  protected readonly picksSources = computed(() => this.types().every((t) => t === 'NAV_FOLDER' || t === 'DATASET'));
  protected readonly showSwitch = computed(() => this.types().length > 1);
  protected readonly title = computed(() => {
    const types = this.types();
    if (this.picksSources()) {
      return this.t('title.source');
    }
    return types.length === 1 ? this.t(`title.one.${types[0]}`) : this.t('title.asset');
  });

  protected readonly typeOptions = computed<SfSelectOption<PickerType>[]>(() => this.types().map((value) => ({ value, label: this.t(`types.${value}`) })));
  protected readonly typeSegments = computed<SfSegmentedOption<PickerType>[]>(() => this.types().map((value) => ({ value, label: this.t(`types.${value}`) })));
  protected readonly segmented = computed(() => this.types().length <= 3);

  protected readonly datasets = computed(() => pickerDatasets(this.dataset()));
  protected readonly datasetOptions = computed<SfSelectOption<string>[]>(() => this.datasets().map((d) => ({ value: d.id, label: d.name })));
  protected readonly showDatasets = computed(() => this.type() === 'RECORD' && this.datasets().length > 1);

  protected readonly foldered = computed(() => hasFolders(this.type()));
  protected readonly items = computed(() => {
    if (this.review() !== 'live' || this.failed()) {
      return [];
    }
    return queryPicker({
      type: this.type(),
      folderId: this.folderId(),
      search: this.search(),
      datasetId: this.type() === 'RECORD' ? (this.datasetId() ?? this.datasets()[0]?.id ?? null) : null,
      datasetUid: this.dataset(),
    });
  });
  protected readonly loading = computed(() => this.review() === 'loading' || this.typed() !== this.search());
  protected readonly hasError = computed(() => this.review() === 'error' || this.failed());
  protected readonly selected = computed(() => this.items().find((item) => item.id === this.selectedId()) ?? null);
  /** The selection is kept only while it is in the list; the footer names it. */
  protected readonly selectedMeta = computed(() => {
    const item = this.selected();
    return item ? (this.developer() ? item.uid : item.folderPath || item.path) : '';
  });

  /** The "All …" root and the open folder's trail, for the breadcrumb. */
  protected readonly trail = computed(() => folderTrail(this.type(), this.folderId()));
  protected readonly folderOptions = computed<SfSelectOption<string>[]>(() => [
    { value: '', label: this.t(`all.${this.type()}`) },
    ...flatten(pickerFolders(this.type())),
  ]);

  /** The tree's lazy loader: a node's folders when it opens. */
  protected readonly loader = computed<SfTreeLoader<PickerFolder>>(() => {
    const folders = pickerFolders(this.type());
    return (parent) => {
      const list = parent ? (findIn(folders, parent.id)?.children ?? []) : folders;
      return list.map(
        (folder): SfTreeNode<PickerFolder> => ({
          id: folder.id,
          label: folder.name,
          icon: 'folder',
          hasChildren: folder.children.length > 0,
          data: folder,
        }),
      );
    };
  });

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timer !== null && clearTimeout(this.timer));
    // A debounced search, as in the real picker; typing searches every folder.
    effect(() => {
      const typed = this.typed();
      untracked(() => {
        if (this.timer !== null) {
          clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => this.search.set(typed), SEARCH_DEBOUNCE_MS);
      });
    });
    // The selection ends when its row leaves the list (a search, a folder).
    effect(() => {
      const id = this.selectedId();
      if (id !== null && !this.items().some((item) => item.id === id) && this.review() === 'live') {
        untracked(() => this.selectedId.set(null));
      }
    });
  }

  ngOnInit(): void {
    const types = this.types();
    const current = this.current();
    const initial = this.initialType();
    const preferred = current && types.includes(current.type) ? current.type : initial && types.includes(initial) ? initial : types[0];
    this.type.set(preferred ?? 'PAGE');
    this.datasetId.set(this.datasets()[0]?.id ?? null);
    if (current && types.includes(current.type)) {
      if (current.type === 'RECORD' && current.datasetUid) {
        this.datasetId.set(this.datasets().find((d) => d.uid === current.datasetUid)?.id ?? this.datasetId());
      }
      this.selectedId.set(current.id);
    }
  }

  protected iconOf(item: PickerItem): string {
    return ICONS[item.type];
  }

  protected setType(type: PickerType | null): void {
    if (type && type !== this.type()) {
      this.type.set(type);
      this.folderId.set(null);
      this.selectedId.set(null);
      this.datasetId.set(this.datasets()[0]?.id ?? null);
    }
  }

  protected setDataset(id: string | null): void {
    this.datasetId.set(id);
    this.selectedId.set(null);
  }

  protected selectFolder(id: string | null): void {
    this.folderId.set(id || null);
  }

  protected onTreeOpen(node: SfTreeNode<PickerFolder>): void {
    this.selectFolder(node.id);
  }

  protected clearSearch(): void {
    this.typed.set('');
    this.search.set('');
  }

  protected retry(): void {
    this.failed.set(false);
  }

  protected select(item: PickerItem): void {
    this.selectedId.set(item.id);
  }

  protected pick(item: PickerItem | null): void {
    if (item) {
      this.choose.emit(item);
    }
  }

  /** Arrows, Home and End move the selection through the list; Enter chooses it. */
  protected onListKeydown(event: KeyboardEvent): void {
    const list = this.items();
    if (list.length === 0) {
      return;
    }
    const index = list.findIndex((item) => item.id === this.selectedId());
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
    this.selectedId.set(list[next].id);
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${list[next].id}"]`)?.focus());
  }

  /** From the search field, ArrowDown steps into the list. */
  protected onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' && this.items().length > 0) {
      event.preventDefault();
      const first = this.selected() ?? this.items()[0];
      this.selectedId.set(first.id);
      queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${first.id}"]`)?.focus());
    }
  }

  protected statusTone(status: string): 'success' | 'warning' | 'neutral' {
    return status === 'released' ? 'success' : status === 'changed' ? 'warning' : 'neutral';
  }

  protected indent(item: PickerItem): number {
    return item.depth ?? 0;
  }
}

function findIn(list: readonly PickerFolder[], id: string): PickerFolder | null {
  for (const folder of list) {
    if (folder.id === id) {
      return folder;
    }
    const inner = findIn(folder.children, id);
    if (inner) {
      return inner;
    }
  }
  return null;
}

/** The folders as select options, children after their parent and indented with an en dash per level. */
function flatten(list: readonly PickerFolder[], depth = 0): SfSelectOption<string>[] {
  return list.flatMap((folder) => [{ value: folder.id, label: `${'– '.repeat(depth)}${folder.name}` }, ...flatten(folder.children, depth + 1)]);
}
