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

type AssetSummaryView = components['schemas']['AssetSummaryView'];
type FolderView = components['schemas']['FolderView'];

type PickerType = 'PAGE' | 'MEDIA' | 'PAGE_TEMPLATE' | 'SECTION_TEMPLATE';

const TYPE_OPTIONS: { value: PickerType; label: string }[] = [
  { value: 'PAGE', label: 'Pages' },
  { value: 'MEDIA', label: 'Media' },
  { value: 'PAGE_TEMPLATE', label: 'Page templates' },
  { value: 'SECTION_TEMPLATE', label: 'Section templates' },
];

export interface AssetPicked {
  uuid: string;
  assetType: string;
  label: string;
}

/**
 * Modal asset picker — a type switch, a folder tree with search for the two
 * types that actually have folders (pages/media), and a flat searchable
 * list for the rest. Used by `sf-reference-editor` to fill an ASSET_REF
 * value, but generic enough for anything that needs to point at an asset.
 */
@Component({
  selector: 'sf-asset-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfEmptyStateComponent, SfIconComponent, SfSpinnerComponent, SfAssetPickerFolderNodeComponent],
  templateUrl: './sf-asset-picker-dialog.component.html',
  styleUrl: './sf-asset-picker-dialog.component.scss',
})
export class SfAssetPickerDialogComponent {
  readonly projectKey = input.required<string>();
  /** Preselects the type switch; ignored if not in `allowedTypes` (when given). */
  readonly initialType = input<string | null>(null);
  /** Restricts the type switch to these asset types (from the editor's CDL `assetTypes`); omit/empty allows any type. */
  readonly allowedTypes = input<string[] | null>(null);

  readonly picked = output<AssetPicked>();
  readonly closed = output<void>();

  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly search$ = new Subject<string>();

  protected readonly typeOptions = computed<{ value: PickerType; label: string }[]>(() => {
    const allowed = this.allowedTypes();
    if (!allowed || allowed.length === 0) {
      return TYPE_OPTIONS;
    }
    const filtered = TYPE_OPTIONS.filter((t) => allowed.includes(t.value));
    return filtered.length > 0 ? filtered : TYPE_OPTIONS;
  });
  protected readonly type = signal<PickerType>('PAGE');
  protected readonly search = signal('');
  protected readonly folderUuid = signal('');
  protected readonly folderPath = signal('');
  protected readonly items = signal<AssetSummaryView[]>([]);
  protected readonly loading = signal(false);

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
      untracked(() => this.reload());
    });

    this.search$
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((q) => this.search.set(q));
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

  protected pick(item: AssetSummaryView): void {
    if (!item.uuid) {
      return;
    }
    this.picked.emit({
      uuid: item.uuid,
      assetType: item.type ?? this.type(),
      label: item.displayName ?? item.uid ?? item.uuid,
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
          this.items.set(res.content ?? []);
          this.loading.set(false);
        },
        error: () => {
          this.items.set([]);
          this.loading.set(false);
        },
      });
  }
}
