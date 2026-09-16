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
import { ApiClient } from '../../../core/api/api.client';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import {
  SfAssetPickerDialogComponent,
  type AssetPicked,
} from '../../../shared/components/sf-asset-picker-dialog.component';
import { ContentService, type DatasetSummaryView } from '../../content/content.service';
import type { EditorDefinition, PaginationSourceKind } from '../form.model';
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
 *
 * Inline template: the spec runner in this workspace can't resolve `templateUrl` components.
 */
@Component({
  selector: 'sf-pagination-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfAssetPickerDialogComponent],
  template: `
    <fieldset class="sf-pagination" [attr.aria-describedby]="definition().help ? id + '-help' : null">
      <legend class="sf-pagination__legend">{{ definition().label || definition().name }}</legend>
      @if (readOnly()) {
        <p class="sf-pagination__summary">{{ summary() }}</p>
      } @else {
        <div class="sf-pagination__row sf-pagination__source">
          <span class="sf-pagination__label" [id]="id + '-source'">Source</span>
          @if (sourceUuid()) {
            <span class="sf-pagination__current" [attr.aria-labelledby]="id + '-source'">
              <span class="sf-pagination__kind">{{ kind() === 'NAV' ? 'Navigation folder' : 'Dataset' }}</span>
              <span class="sf-pagination__name">{{ sourceName() ?? sourceUuid() }}</span>
            </span>
          } @else {
            <span class="sf-pagination__empty">Not paginated</span>
          }
          <button type="button" class="sf-pagination__button" (click)="pickerOpen.set(true)">
            {{ sourceUuid() ? 'Change source…' : 'Choose source…' }}
          </button>
          @if (sourceUuid()) {
            <button type="button" class="sf-pagination__button" (click)="clear()">Clear</button>
          }
        </div>
        <div class="sf-pagination__row">
          <label class="sf-pagination__field">
            <span class="sf-pagination__label">Items per page</span>
            <input
              type="number"
              min="1"
              [max]="max()"
              [value]="pageSize()"
              (input)="onPageSizeInput($event)"
              (change)="onPageSize($event)"
            />
          </label>
          <label class="sf-pagination__field">
            <span class="sf-pagination__label">Sort by</span>
            <select [value]="sortKey()" (change)="onSortKey($event)">
              @for (key of keys(); track key) {
                <option [value]="key" [selected]="key === sortKey()">{{ label(key) }}</option>
              }
            </select>
          </label>
          <button
            type="button"
            class="sf-pagination__button"
            [attr.aria-pressed]="direction() === 'DESC'"
            [attr.aria-label]="direction() === 'DESC' ? 'Descending, switch to ascending' : 'Ascending, switch to descending'"
            (click)="toggleDirection()"
          >
            {{ direction() === 'DESC' ? '↓ Descending' : '↑ Ascending' }}
          </button>
        </div>
        <p class="sf-pagination__hint" aria-live="polite">{{ hint() }}</p>
      }
      @if (definition().help) {
        <span class="sf-pagination__help" [id]="id + '-help'">{{ definition().help }}</span>
      }
    </fieldset>
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
    /* A fieldset defaults to min-inline-size: min-content, which would keep the editor column from shrinking. */
    .sf-pagination { border: 1px solid var(--sf-line); border-radius: var(--sf-radius-sm); padding: var(--sf-2) var(--sf-3); margin: 0; min-inline-size: 0; }
    .sf-pagination__legend { font-size: var(--sf-text-xs); color: var(--sf-ink-soft, var(--sf-ink)); padding: 0 var(--sf-1); }
    .sf-pagination__row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--sf-2); margin-bottom: var(--sf-2); }
    .sf-pagination__source { align-items: center; }
    .sf-pagination__field { display: flex; flex-direction: column; gap: var(--sf-1); }
    .sf-pagination__label { font-size: var(--sf-text-xs); }
    .sf-pagination__field input { width: 6rem; }
    .sf-pagination__current { display: inline-flex; align-items: baseline; gap: var(--sf-2); min-width: 0; }
    .sf-pagination__kind { font-size: var(--sf-text-xs); color: var(--sf-slate); }
    .sf-pagination__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sf-pagination__empty { color: var(--sf-slate); }
    .sf-pagination__button {
      padding: var(--sf-1) var(--sf-2); border: 1px solid var(--sf-line); border-radius: var(--sf-radius-sm);
      background: transparent; color: var(--sf-ink); font-size: var(--sf-text-xs); cursor: pointer;
    }
    .sf-pagination__summary, .sf-pagination__hint { margin: 0; font-size: var(--sf-text-sm, 0.875rem); }
    .sf-pagination__hint:empty { display: none; }
    .sf-pagination__help { font-size: var(--sf-text-xs); color: var(--sf-ink-soft, var(--sf-ink)); }
  `,
})
export class SfPaginationEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();
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

  /** While typing: keeps the bounded size (an empty or partial entry is ignored), without rewriting the field. */
  protected onPageSizeInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw.trim() === '' || !Number.isFinite(Number(raw))) {
      return;
    }
    const size = clampPageSize(this.definition(), raw);
    if (size !== this.pageSize()) {
      this.pageSize.set(size);
      this.commit();
    }
  }

  protected onPageSize(event: Event): void {
    const input = event.target as HTMLInputElement;
    const size = clampPageSize(this.definition(), input.value);
    this.pageSize.set(size);
    input.value = String(size);
    this.commit();
  }

  protected onSortKey(event: Event): void {
    this.sortKey.set((event.target as HTMLSelectElement).value);
    this.commit();
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
