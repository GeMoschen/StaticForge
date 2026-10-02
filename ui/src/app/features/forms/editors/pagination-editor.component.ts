import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { merge, type Subscription } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiClient } from '../../../core/api/api.client';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import {
  SfAssetPickerDialogComponent,
  type AssetPicked,
} from '../../../shared/components/sf-asset-picker-dialog.component';
import { ContentService, type DatasetSummaryView } from '../../content/content.service';
import { SfNumberInputComponent } from '../../../shared/components/forms/sf-number-input.component';
import { SfSelectComponent, type SfSelectOption } from '../../../shared/components/forms/sf-select.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';
import type { PaginationSourceKind } from '../form.model';
import {
  clampPageSize,
  defaultPageSize,
  flattenFolders,
  maxPageSize,
  pageCountHint,
  paginationValue,
  pickerTypeFor,
  readPaginationValue,
  sortKeys,
  sortLabel,
  sourceKindOf,
  sourceKinds,
  summarizePagination,
} from './pagination-editor.util';

type FolderView = components['schemas']['FolderView'];

let nextId = 0;

/**
 * The `pagination` editor (M21.4.1): a source picked in the asset picker (a folder of the Navigation store or a
 * dataset, limited to the declaration's `sources`), a page size within `1..maxPageSize`, and a sort key with a
 * direction. Once a source is chosen it shows how many items and pages that makes, counted by the server with the
 * generator's own rules. The stored value is written only once a source is chosen, so autosave never sends a
 * half-built value; Clear stores `null` (not paginated). A disabled control (time travel, visual diff) shows the
 * one-line summary instead of controls.
 */
@Component({
  selector: 'sf-pagination-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfAssetPickerDialogComponent, SfButtonComponent, SfFieldComponent, SfNumberInputComponent, SfSelectComponent, TranslocoPipe],
  template: `
    <sf-field
      [label]="definition().label || definition().name"
      [hint]="definition().help"
      [required]="fieldRequired()"
      [empty]="false"
      [tags]="fieldTags()"
      [findings]="fieldFindings()"
    >
      @if (readOnly()) {
        <p class="sf-pagination__summary">{{ summary() }}</p>
      } @else {
        <div class="sf-pagination__row sf-pagination__source">
          @if (sourceUuid()) {
            <span class="sf-pagination__current">
              <span class="sf-pagination__kind">{{
                (kind() === 'NAV' ? 'forms.editors.pagination.navfolder' : 'forms.editors.pagination.dataset') | transloco
              }}</span>
              <span class="sf-pagination__name">{{ sourceName() ?? sourceUuid() }}</span>
            </span>
          } @else {
            <span class="sf-pagination__empty">{{ 'forms.editors.pagination.notpaginated' | transloco }}</span>
          }
          <sf-button variant="secondary" size="sm" (click)="pickerOpen.set(true)">{{
            (sourceUuid() ? 'forms.editors.pagination.change' : 'forms.editors.pagination.choose') | transloco
          }}</sf-button>
          @if (sourceUuid()) {
            <sf-button variant="ghost" size="sm" (click)="clear()">{{ 'forms.editors.pagination.clear' | transloco }}</sf-button>
          }
        </div>
        <div class="sf-pagination__row">
          <span class="sf-pagination__field">
            <span class="sf-pagination__label" [id]="id + '-size'">{{ 'forms.editors.pagination.perpage' | transloco }}</span>
            <sf-number-input
              class="sf-pagination__size"
              [aria-labelledby]="id + '-size'"
              [min]="1"
              [max]="max()"
              [value]="pageSize()"
              (valueChange)="onPageSize($event)"
            />
          </span>
          <span class="sf-pagination__field">
            <span class="sf-pagination__label" [id]="id + '-sort'">{{ 'forms.editors.pagination.sortby' | transloco }}</span>
            <sf-select
              class="sf-pagination__sort"
              [aria-labelledby]="id + '-sort'"
              [options]="sortOptions()"
              [value]="sortKey()"
              (valueChange)="onSortKey($event)"
            />
          </span>
          <sf-button
            variant="secondary"
            [aria-pressed]="direction() === 'DESC'"
            [icon]="direction() === 'DESC' ? 'arrow_downward' : 'arrow_upward'"
            [label]="(direction() === 'DESC' ? 'forms.editors.pagination.descaria' : 'forms.editors.pagination.ascaria') | transloco"
            (click)="toggleDirection()"
          >
            {{ (direction() === 'DESC' ? 'forms.editors.pagination.desc' : 'forms.editors.pagination.asc') | transloco }}
          </sf-button>
        </div>
        <p class="sf-pagination__hint" aria-live="polite">{{ hint() }}</p>
      }
    </sf-field>
    @if (pickerOpen() && projectKey()) {
      <sf-asset-picker-dialog
        [projectKey]="projectKey()!"
        [initialType]="pickerType(kind())"
        [allowedTypes]="pickerTypes()"
        (picked)="onPicked($event)"
        (closed)="pickerOpen.set(false)"
      />
    }
  `,
  styles: `
    .sf-pagination__row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--sf-space-3);
      margin-block-end: var(--sf-space-2);
    }
    .sf-pagination__source {
      align-items: center;
    }
    .sf-pagination__field {
      display: flex;
      flex-direction: column;
      gap: var(--sf-space-1);
    }
    .sf-pagination__label {
      color: var(--sf-text-muted);
      font-size: var(--sf-fs-12);
      line-height: var(--sf-lh-12);
    }
    .sf-pagination__size {
      inline-size: 8rem;
    }
    .sf-pagination__sort {
      min-inline-size: 12rem;
    }
    .sf-pagination__current {
      display: inline-flex;
      align-items: baseline;
      gap: var(--sf-space-2);
      min-width: 0;
    }
    .sf-pagination__kind {
      color: var(--sf-text-muted);
      font-size: var(--sf-fs-12);
    }
    .sf-pagination__name {
      overflow: hidden;
      font-weight: var(--sf-weight-semibold);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sf-pagination__empty {
      color: var(--sf-text-muted);
    }
    .sf-pagination__summary,
    .sf-pagination__hint {
      margin: 0;
      color: var(--sf-text);
      font-size: var(--sf-fs-13);
      line-height: var(--sf-lh-13);
    }
    .sf-pagination__hint:empty {
      display: none;
    }
  `,
})
export class SfPaginationEditor extends SfEditorBase<FormControl> {
  readonly projectKey = input<string>();

  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly content = inject(ContentService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly id = `sf-pagination-${nextId++}`;

  /** The control's value as last seen; the control is a plain `FormControl`, not a signal. */
  protected readonly stored = signal(readPaginationValue(null));
  private readonly disabled = signal(false);
  private readonly datasets = signal<DatasetSummaryView[]>([]);
  /** The Navigation store's folders as loaded by this editor; `null` until loaded (the store's tree meanwhile). */
  private readonly navigationFolders = signal<FolderView[] | null>(null);
  private readonly navigationTree = computed(() => this.navigationFolders() ?? this.store.navigationFolderTree());
  /** The name the picker returned, shown before the folder or dataset list has it. */
  private readonly pickedLabel = signal<{ uuid: string; label: string } | null>(null);
  /** The server's count of the current source; `null` while unknown. */
  private readonly count = signal<{ itemCount: number; skipped: number } | null>(null);

  protected readonly pickerOpen = signal(false);
  protected readonly kinds = computed(() => sourceKinds(this.definition()));
  protected readonly pickerTypes = computed(() => this.kinds().map(pickerTypeFor));
  protected readonly kind = signal<PaginationSourceKind>('NAV');
  protected readonly sourceUuid = signal<string | null>(null);
  protected readonly pageSize = signal(10);
  protected readonly sortKey = signal('navigation');
  protected readonly direction = signal<'ASC' | 'DESC'>('ASC');

  protected readonly readOnly = computed(() => !!this.definition().readOnly || this.disabled());
  protected readonly max = computed(() => maxPageSize(this.definition()));
  protected readonly keys = computed(() => sortKeys(this.definition(), this.kind()));
  protected readonly sortOptions = computed<SfSelectOption<string>[]>(() => this.keys().map((key) => ({ value: key, label: sortLabel(key) })));

  protected readonly sourceName = computed(() => this.nameOf(this.kind(), this.sourceUuid()));

  protected readonly hint = computed(() => {
    const count = this.count();
    return this.sourceUuid() && count ? pageCountHint(count.itemCount, this.pageSize(), count.skipped) : '';
  });

  protected readonly summary = computed(() => {
    const value = this.stored();
    return summarizePagination(value, value ? this.nameOf(value.source.kind, value.source.uuid) : null);
  });

  constructor() {
    super();
    let watching: Subscription | null = null;
    effect(() => {
      const control = this.control();
      untracked(() => {
        watching?.unsubscribe();
        this.sync(control.value);
        this.disabled.set(control.disabled);
        watching = merge(control.valueChanges, control.statusChanges).subscribe(() => {
          this.sync(control.value);
          this.disabled.set(control.disabled);
        });
      });
    });
    this.destroyRef.onDestroy(() => watching?.unsubscribe());

    // Names of the current source: fresh on open, since the project store's tree is loaded once per project.
    effect(() => {
      const key = this.projectKey();
      const kinds = this.kinds();
      untracked(() => {
        if (key && kinds.includes('NAV')) {
          this.api.listFolders(key, 'NAVIGATION', 10).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (tree) => this.navigationFolders.set(tree ?? []),
            error: () => this.navigationFolders.set(null),
          });
        }
        if (key && kinds.includes('DATASET')) {
          this.content.listDatasets(key).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (datasets) => this.datasets.set(datasets ?? []),
            error: () => this.datasets.set([]),
          });
        }
      });
    });

    // The item count of the chosen source; a newer source cancels the request still in flight.
    let counting: Subscription | null = null;
    effect(() => {
      const key = this.projectKey();
      const kind = this.kind();
      const uuid = this.sourceUuid();
      const readOnly = this.readOnly();
      untracked(() => {
        counting?.unsubscribe();
        this.count.set(null);
        if (!key || !uuid || readOnly) {
          return;
        }
        counting = this.api.paginationCount(key, kind, uuid).subscribe({
          next: (count) => this.count.set(count),
          error: () => this.count.set(null),
        });
      });
    });
    this.destroyRef.onDestroy(() => counting?.unsubscribe());
  }

  protected label(key: string): string {
    return sortLabel(key);
  }

  protected pickerType(kind: PaginationSourceKind): string {
    return pickerTypeFor(kind);
  }

  protected onPicked(picked: AssetPicked): void {
    this.pickerOpen.set(false);
    const kind = sourceKindOf(picked.assetType);
    if (!kind || !this.kinds().includes(kind)) {
      return;
    }
    if (kind !== this.kind()) {
      this.kind.set(kind);
      if (!this.keys().includes(this.sortKey())) {
        this.sortKey.set(this.keys()[0] ?? (kind === 'NAV' ? 'navigation' : '_displayName'));
      }
    }
    this.pickedLabel.set({ uuid: picked.uuid, label: picked.label });
    this.sourceUuid.set(picked.uuid);
    this.commit();
  }

  /** The page size as typed or stepped (an empty entry is ignored), kept within `1..maxPageSize`. */
  protected onPageSize(value: number | null): void {
    if (value === null || !Number.isFinite(value)) {
      return;
    }
    const size = clampPageSize(this.definition(), value);
    if (size !== this.pageSize()) {
      this.pageSize.set(size);
      this.commit();
    }
  }

  protected onSortKey(key: string | null): void {
    if (key) {
      this.sortKey.set(key);
      this.commit();
    }
  }

  protected toggleDirection(): void {
    this.direction.set(this.direction() === 'DESC' ? 'ASC' : 'DESC');
    this.commit();
  }

  protected clear(): void {
    this.sourceUuid.set(null);
    this.write(null);
  }

  private nameOf(kind: PaginationSourceKind, uuid: string | null): string | null {
    if (!uuid) {
      return null;
    }
    const listed =
      kind === 'NAV'
        ? flattenFolders(this.navigationTree()).find((option) => option.uuid === uuid)?.label.trim()
        : this.datasets().find((dataset) => dataset.uuid === uuid)?.displayName;
    const picked = this.pickedLabel();
    return listed ?? (picked?.uuid === uuid ? picked.label : null);
  }

  /** Writes the value once a source is chosen; before that, size, sort and direction stay a local draft. */
  private commit(): void {
    const uuid = this.sourceUuid();
    if (!uuid) {
      if (this.stored()) {
        this.write(null);
      }
      return;
    }
    this.write(paginationValue(this.kind(), uuid, this.pageSize(), this.sortKey(), this.direction()));
  }

  private write(value: ReturnType<typeof paginationValue> | null): void {
    const control = this.control();
    control.setValue(value);
    control.markAsDirty();
  }

  /** Mirrors a stored value (initial, or written from outside such as a conflict merge) into the controls. */
  private sync(raw: unknown): void {
    const value = readPaginationValue(raw);
    this.stored.set(value);
    const definition = this.definition();
    const kinds = sourceKinds(definition);
    if (!value) {
      if (!kinds.includes(this.kind())) {
        this.kind.set(kinds[0] ?? 'NAV');
      }
      this.sourceUuid.set(null);
      this.pageSize.set(defaultPageSize(definition));
      this.sortKey.set(sortKeys(definition, this.kind())[0] ?? 'navigation');
      this.direction.set('ASC');
      return;
    }
    this.kind.set(value.source.kind);
    this.sourceUuid.set(value.source.uuid);
    this.pageSize.set(value.pageSize);
    this.sortKey.set(value.sort?.key ?? sortKeys(definition, value.source.kind)[0] ?? 'navigation');
    this.direction.set(value.sort?.direction === 'DESC' ? 'DESC' : 'ASC');
  }
}
