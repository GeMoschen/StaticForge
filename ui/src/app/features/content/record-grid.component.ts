import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject, Subscription } from 'rxjs';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import type { ContentDefinition } from '../forms/form.model';
import { ContentService, type DatasetDetailView, type RecordRowView, type RecordSort } from './content.service';
import {
  ariaSort,
  deriveColumns,
  formatCell,
  readHiddenColumns,
  sanitizeSort,
  sortIndicator,
  toggleSort,
  writeHiddenColumns,
  type RecordColumn,
} from './record-grid.util';

/** The problem body of a rejected `where`/`sort` (`400`, with `column` for a syntax error). */
interface QueryProblem {
  detail?: string;
  column?: number;
}

/**
 * The records of one dataset as a table (M19.4.2), paged, sorted and filtered on the server so a
 * dataset of any size never loads more than one page of rows.
 *
 * <p>Columns come from the dataset schema's scalar editors; a viewer can hide columns (remembered per
 * dataset in this browser). Clicking a header sorts by it, shift-click adds it as a further key. The
 * quick search matches display names; the filter box takes an OCTL expression over field names
 * ({@code role == 'lead' && joined > '2022-01-01'}), evaluated by the server, which reports where an
 * invalid one goes wrong.
 *
 * <p>Keyboard: arrow keys move between rows, Enter opens one; headers are buttons, so Enter/Space
 * sorts and Shift+Enter adds a key.
 */
@Component({
  selector: 'sf-record-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfIconComponent, SfRelativeTimePipe],
  templateUrl: './record-grid.component.html',
  styleUrl: './record-grid.component.scss',
})
export class RecordGridComponent {
  readonly projectKey = input.required<string>();
  readonly dataset = input.required<DatasetDetailView>();
  /** Content-store-relative folder prefix the grid is limited to (`/` for the whole store). */
  readonly folder = input<string>('/');
  readonly pageSize = input<number>(50);
  /** A compact grid (the "All datasets" overview): no filter box, no column chooser, no paging. */
  readonly compact = input<boolean>(false);
  /** Bumped by the parent after a record changed elsewhere, to reload the current page. */
  readonly refreshKey = input<number>(0);

  readonly open = output<string>();
  readonly total = output<number>();

  private readonly content = inject(ContentService);
  private readonly rowElements = viewChildren<ElementRef<HTMLTableRowElement>>('row');

  protected readonly rows = signal<RecordRowView[]>([]);
  protected readonly totalElements = signal(0);
  protected readonly totalPages = signal(0);
  protected readonly page = signal(0);
  protected readonly sort = signal<RecordSort[]>([]);
  protected readonly q = signal('');
  protected readonly whereDraft = signal('');
  protected readonly where = signal('');
  protected readonly whereError = signal<QueryProblem | null>(null);
  protected readonly loading = signal(false);
  protected readonly activeRow = signal(0);
  protected readonly chooserOpen = signal(false);
  private readonly hidden = signal<Set<string>>(new Set());

  private readonly search$ = new Subject<string>();
  private request: Subscription | null = null;

  protected readonly columns = computed<RecordColumn[]>(() =>
    deriveColumns(this.dataset().compiledDefinition as unknown as ContentDefinition),
  );
  protected readonly visibleColumns = computed(() => this.columns().filter((c) => !this.hidden().has(c.field)));

  protected readonly format = formatCell;
  protected readonly indicator = sortIndicator;
  protected readonly ariaSortOf = ariaSort;

  constructor() {
    // Hidden columns are per dataset: re-read whenever the dataset changes.
    effect(
      () => {
        const key = this.projectKey();
        const dataset = this.dataset();
        const columns = this.columns();
        untracked(() => {
          const remembered = dataset.uuid ? readHiddenColumns(key, dataset.uuid) : null;
          this.hidden.set(remembered ?? new Set(columns.filter((c) => !c.defaultVisible).map((c) => c.field)));
          // A schema change can remove a sorted column: fall back to the default order silently.
          this.sort.update((sort) => sanitizeSort(sort, columns));
        });
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        this.projectKey();
        this.dataset();
        this.folder();
        this.q();
        this.where();
        this.sort();
        this.refreshKey();
        const page = this.page();
        untracked(() => this.reload(page));
      },
      { allowSignalWrites: true },
    );

    this.search$
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => {
        this.page.set(0);
        this.q.set(value);
      });
  }

  protected onSearch(event: Event): void {
    this.search$.next((event.target as HTMLInputElement).value);
  }

  protected onWhereInput(event: Event): void {
    this.whereDraft.set((event.target as HTMLInputElement).value);
  }

  protected applyWhere(): void {
    this.page.set(0);
    this.where.set(this.whereDraft().trim());
  }

  protected clearWhere(): void {
    this.whereDraft.set('');
    this.page.set(0);
    this.where.set('');
  }

  protected onWhereKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.applyWhere();
    }
  }

  protected onHeader(field: string, event: MouseEvent | KeyboardEvent): void {
    this.page.set(0);
    this.sort.update((sort) => toggleSort(sort, field, event.shiftKey));
  }

  protected toggleColumn(field: string): void {
    const next = new Set(this.hidden());
    if (next.has(field)) {
      next.delete(field);
    } else {
      next.add(field);
    }
    this.hidden.set(next);
    const uuid = this.dataset().uuid;
    if (uuid) {
      writeHiddenColumns(this.projectKey(), uuid, next);
    }
  }

  protected isHidden(field: string): boolean {
    return this.hidden().has(field);
  }

  protected toggleChooser(): void {
    this.chooserOpen.update((v) => !v);
  }

  protected previousPage(): void {
    if (this.page() > 0) {
      this.page.update((p) => p - 1);
    }
  }

  protected nextPage(): void {
    if (this.page() + 1 < this.totalPages()) {
      this.page.update((p) => p + 1);
    }
  }

  protected openRow(row: RecordRowView): void {
    if (row.uuid) {
      this.open.emit(row.uuid);
    }
  }

  protected onRowKeydown(event: KeyboardEvent, index: number, row: RecordRowView): void {
    const count = this.rows().length;
    if (event.key === 'ArrowDown' && index + 1 < count) {
      event.preventDefault();
      this.focusRow(index + 1);
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      this.focusRow(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.focusRow(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      this.focusRow(count - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openRow(row);
    }
  }

  /** A caret under the applied filter pointing at the 1-based column the server reported. */
  protected caretLine(column: number): string {
    return ' '.repeat(Math.max(0, column - 1)) + '^';
  }

  protected valueOf(row: RecordRowView, column: RecordColumn): string {
    const values = (row.values ?? {}) as Record<string, unknown>;
    return formatCell(values[column.field], column.type);
  }

  private focusRow(index: number): void {
    this.activeRow.set(index);
    queueMicrotask(() => this.rowElements()[index]?.nativeElement.focus());
  }

  private reload(page: number): void {
    const key = this.projectKey();
    const uuid = this.dataset().uuid;
    if (!key || !uuid) {
      return;
    }
    this.request?.unsubscribe();
    this.loading.set(true);
    this.request = this.content
      .listRecords(key, uuid, {
        page,
        size: this.pageSize(),
        sort: this.sort(),
        q: this.q(),
        where: this.where(),
        folder: this.folder(),
      })
      .subscribe({
        next: (result) => {
          this.loading.set(false);
          this.whereError.set(null);
          this.rows.set(result.content ?? []);
          this.totalElements.set(result.page?.totalElements ?? 0);
          this.totalPages.set(result.page?.totalPages ?? 0);
          this.activeRow.set(0);
          this.total.emit(result.page?.totalElements ?? 0);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.rows.set([]);
          this.totalElements.set(0);
          this.totalPages.set(0);
          if (err instanceof HttpErrorResponse && err.status === 400) {
            const body = (err.error ?? {}) as QueryProblem;
            this.whereError.set({ detail: body.detail ?? 'The filter is invalid.', column: body.column });
          } else {
            this.whereError.set({ detail: 'Could not load records — try again in a moment.' });
          }
        },
      });
  }
}
