import { HttpErrorResponse } from '@angular/common/http';
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, map, of, Subject, switchMap, timer, type Observable } from 'rxjs';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfCodeEditorComponent } from '../../shared/code-editor/code-editor.component';
import type { ContentDefinition } from '../forms/form.model';
import {
  ContentService,
  etagFor,
  type DatasetDetailView,
  type RecordSetDetailView,
  type RecordSetQueryDiagnostic,
  type RecordSetQueryPreviewView,
  type RecordSort,
} from './content.service';
import { deriveColumns } from './record-grid.util';
import {
  adoptGridFilter,
  draftOf,
  EMPTY_DRAFT,
  localDiagnostics,
  matchSummary,
  moveSortKey,
  queryOf,
  sameQuery,
  type SetQueryDraft,
} from './set-query.util';

/**
 * Where the panel's validation stands: `idle` before anything was checked (and always when read-only),
 * `validating` while a preview is pending (debounced or in flight), `valid`/`invalid` per the last
 * answer, `unavailable` when the preview could not be run.
 */
export type QueryCheckState = 'idle' | 'validating' | 'valid' | 'invalid' | 'unavailable';

/** One field the sort-key picker offers. */
interface SortFieldOption {
  field: string;
  label: string;
}

/** Record meta fields a set can be sorted by, with the grid's column names. */
const META_SORT_OPTIONS: SortFieldOption[] = [
  { field: '_displayName', label: 'Name' },
  { field: '_uid', label: 'UID' },
  { field: '_changedAt', label: 'Changed' },
];

/** A preview request: the draft to check, or `null` to drop a pending one. */
interface PreviewRequest {
  draft: SetQueryDraft | null;
  immediate: boolean;
}

type PreviewOutcome = { ok: true; view: RecordSetQueryPreviewView } | { ok: false };

/**
 * The **Set query** panel of a record set (M25.5.1): the stored `where` / sort keys / `limit` /
 * `offset` deciding which of the set's records it shows and in which order.
 *
 * <p>Every edit is checked by `POST …/preview-query` after a short debounce (a newer edit cancels
 * a pending or in-flight check), which answers with the server's diagnostics and live counts —
 * "N of M records match". `limit`/`offset` that aren't whole numbers are caught locally and never
 * sent. Save is enabled only for a changed, not-invalid draft and sends the whole query with
 * `If-Match`; a `409` means someone else saved first, so the panel asks the set view to reload
 * instead of overwriting. Revert goes back to the stored query.
 *
 * <p>Read-only (viewer role, time travel) the panel shows the stored query and the stored
 * validation state, and never calls the preview — it is an editor's tool and a `POST`.
 */
@Component({
  selector: 'sf-record-set-query-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfCodeEditorComponent, SfIconComponent],
  templateUrl: './record-set-query-panel.component.html',
  styleUrl: './record-set-query-panel.component.scss',
})
export class RecordSetQueryPanelComponent {
  readonly projectKey = input.required<string>();
  readonly set = input.required<RecordSetDetailView>();
  /** The set's dataset (its schema names the fields the sort picker offers). */
  readonly dataset = input<DatasetDetailView | null>(null);
  readonly readOnly = input<boolean>(false);
  /** Delay between the last edit and its check. */
  readonly debounceMs = input<number>(400);

  /** The saved set, as the server answered the `PUT`. */
  readonly saved = output<RecordSetDetailView>();
  /** The save hit a newer version (`409`): the set view should reload it. */
  readonly stale = output<void>();

  private readonly content = inject(ContentService);
  private readonly toasts = inject(ToastService);

  protected readonly expanded = signal(true);
  /** The stored query, as a draft — what "dirty" and Revert compare against. */
  private readonly base = signal<SetQueryDraft>(EMPTY_DRAFT);
  protected readonly draft = signal<SetQueryDraft>(EMPTY_DRAFT);
  protected readonly state = signal<QueryCheckState>('idle');
  private readonly serverDiagnostics = signal<RecordSetQueryDiagnostic[]>([]);
  protected readonly matchCount = signal(0);
  protected readonly selectedCount = signal(0);
  protected readonly saving = signal(false);

  private readonly preview$ = new Subject<PreviewRequest>();

  protected readonly dirty = computed(() => !sameQuery(this.draft(), this.base()));
  private readonly localIssues = computed(() => localDiagnostics(this.draft()));
  /** Local findings first: while there are any, the server's answer is for an older draft. */
  protected readonly diagnostics = computed(() =>
    this.localIssues().length > 0 ? this.localIssues() : this.serverDiagnostics(),
  );
  protected readonly whereInvalid = computed(() =>
    this.diagnostics().some((d) => d.field === 'where' && d.severity === 'ERROR'),
  );
  protected readonly canSave = computed(
    () => !this.readOnly() && this.dirty() && !this.saving() && this.state() !== 'invalid' && this.state() !== 'validating',
  );

  protected readonly total = computed(() => this.set().recordCount ?? 0);

  /** The status line under the fields — what the set would show, or why it can't say. */
  protected readonly status = computed(() => {
    switch (this.state()) {
      case 'validating':
        return 'Checking the query…';
      case 'valid':
        return matchSummary(this.matchCount(), this.total(), this.selectedCount());
      case 'invalid':
        return 'The query has errors — a set with this query shows no records.';
      case 'unavailable':
        return "Couldn't check the query — try again in a moment.";
      default: {
        const total = this.total();
        return `${total} ${total === 1 ? 'record' : 'records'} in this set`;
      }
    }
  });

  /** A one-line rendering of the stored query for the collapsed header. */
  protected readonly summary = computed(() => {
    const query = queryOf(this.base());
    const parts: string[] = [];
    if (query.where) {
      parts.push(`where ${query.where}`);
    }
    if (query.sort) {
      parts.push(`sort ${query.sort}`);
    }
    if (query.offset != null) {
      parts.push(`offset ${query.offset}`);
    }
    if (query.limit != null) {
      parts.push(`limit ${query.limit}`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'All records, default order';
  });

  /**
   * The sort picker's fields: meta fields, the schema's scalar editors, and any field a key already
   * names that the schema no longer has — listed as unknown, so the select shows what the key says.
   */
  protected readonly sortOptions = computed<SortFieldOption[]>(() => {
    const definition = this.dataset()?.compiledDefinition as unknown as ContentDefinition | undefined;
    const options = [
      ...META_SORT_OPTIONS,
      ...deriveColumns(definition).map((column) => ({ field: column.field, label: column.label })),
    ];
    for (const key of this.draft().sort) {
      if (!options.some((o) => o.field === key.field)) {
        options.push({ field: key.field, label: `${key.field} (unknown field)` });
      }
    }
    return options;
  });

  /** The fields a `where` reads, for completion (M33): meta fields and the schema's editors. */
  protected readonly whereFields = computed(() => {
    const definition = this.dataset()?.compiledDefinition as unknown as ContentDefinition | undefined;
    const names = new Set<string>(META_SORT_OPTIONS.map((option) => option.field));
    const collect = (editors: ContentDefinition['editors'] | undefined) =>
      (editors ?? []).forEach((editor) => {
        if (editor.type === 'GROUP') {
          collect(editor.items);
        } else {
          names.add(editor.name);
        }
      });
    collect(definition?.editors);
    return [...names];
  });

  /** The `where` diagnostics, underlined in the field (they carry a column in the expression). */
  protected readonly whereDiagnostics = computed(() =>
    this.diagnostics()
      .filter((d) => d.field === 'where')
      .map((d) => ({ ...d, line: 1, column: (d.line ?? 1) === 1 ? (d.column ?? 1) : 1 })),
  );

  protected readonly canAddSortKey = computed(() => this.sortOptions().some((o) => !this.isSorted(o.field)));

  constructor() {
    this.preview$
      .pipe(
        switchMap((request) => {
          const draft = request.draft;
          if (!draft) {
            return EMPTY;
          }
          const wait: Observable<unknown> = request.immediate ? of(0) : timer(this.debounceMs());
          return wait.pipe(switchMap(() => this.runPreview(draft)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => this.applyPreview(outcome));

    // A (re)loaded set resets the draft only when it's another set or its stored query changed —
    // a rename (new revision, same query) keeps unsaved edits.
    let currentUuid: string | undefined;
    effect(
      () => {
        const set = this.set();
        const readOnly = this.readOnly();
        untracked(() => {
          const next = draftOf(set.query);
          const otherSet = set.uuid !== currentUuid;
          const queryChanged = !sameQuery(next, this.base());
          currentUuid = set.uuid;
          this.base.set(next);
          if (otherSet || queryChanged || readOnly) {
            this.draft.set(next);
          }
          if (readOnly) {
            this.preview$.next({ draft: null, immediate: true });
            this.serverDiagnostics.set(set.queryDiagnostics ?? []);
            this.state.set(set.queryValid === false ? 'invalid' : 'idle');
          } else {
            this.check(true);
          }
        });
      },
      { allowSignalWrites: true },
    );
  }

  /** "Use current filter as set query": the grid's filter and sort replace the draft's (unsaved). */
  adopt(where: string, sort: readonly RecordSort[]): void {
    if (this.readOnly()) {
      return;
    }
    this.expanded.set(true);
    this.edit(adoptGridFilter(this.draft(), where, sort));
  }

  protected toggle(): void {
    this.expanded.update((v) => !v);
  }

  protected onWhereInput(where: string): void {
    this.edit({ ...this.draft(), where });
  }

  protected onLimitInput(event: Event): void {
    this.edit({ ...this.draft(), limit: (event.target as HTMLInputElement).value });
  }

  protected onOffsetInput(event: Event): void {
    this.edit({ ...this.draft(), offset: (event.target as HTMLInputElement).value });
  }

  protected isSorted(field: string): boolean {
    return this.draft().sort.some((s) => s.field === field);
  }

  /** Adds a key on the first field not sorted by yet — set explicitly, never left to the select's fallback. */
  protected addSortKey(): void {
    const field = this.sortOptions().find((o) => !this.isSorted(o.field))?.field;
    if (field) {
      this.edit({ ...this.draft(), sort: [...this.draft().sort, { field, direction: 'asc' }] });
    }
  }

  protected onSortField(index: number, event: Event): void {
    const field = (event.target as HTMLSelectElement).value;
    const sort = this.draft().sort.map((key, i) => (i === index ? { ...key, field } : key));
    this.edit({ ...this.draft(), sort });
  }

  protected onSortDirection(index: number, event: Event): void {
    const direction: RecordSort['direction'] = (event.target as HTMLSelectElement).value === 'desc' ? 'desc' : 'asc';
    const sort = this.draft().sort.map((key, i) => (i === index ? { ...key, direction } : key));
    this.edit({ ...this.draft(), sort });
  }

  protected moveSortKey(index: number, delta: number): void {
    this.edit({ ...this.draft(), sort: moveSortKey(this.draft().sort, index, delta) });
  }

  protected removeSortKey(index: number): void {
    this.edit({ ...this.draft(), sort: this.draft().sort.filter((_, i) => i !== index) });
  }

  protected revert(): void {
    this.draft.set(this.base());
    this.check(true);
  }

  protected save(): void {
    const set = this.set();
    if (!set.uuid || !this.canSave()) {
      return;
    }
    const query = queryOf(this.draft());
    this.saving.set(true);
    this.content
      .updateRecordSet(this.projectKey(), set.uuid, { query }, etagFor(set.revision ?? 0))
      .subscribe({
        next: (view) => {
          this.saving.set(false);
          this.base.set(draftOf(view.query));
          this.toasts.show('Set query saved', 'success');
          this.saved.emit(view);
        },
        error: (err: unknown) => this.onSaveError(err),
      });
  }

  protected diagnosticPosition(diagnostic: RecordSetQueryDiagnostic): string {
    return diagnostic.line && diagnostic.column ? ` ${diagnostic.line}:${diagnostic.column}` : '';
  }

  private edit(draft: SetQueryDraft): void {
    if (this.readOnly()) {
      return;
    }
    this.draft.set(draft);
    this.check(false);
  }

  /** Validates the current draft: locally first, then (debounced unless `immediate`) on the server. */
  private check(immediate: boolean): void {
    if (this.localIssues().length > 0) {
      this.preview$.next({ draft: null, immediate: true });
      this.state.set('invalid');
      return;
    }
    this.state.set('validating');
    this.preview$.next({ draft: this.draft(), immediate });
  }

  private runPreview(draft: SetQueryDraft): Observable<PreviewOutcome> {
    const uuid = this.set().uuid;
    if (!uuid) {
      return EMPTY;
    }
    return this.content.previewSetQuery(this.projectKey(), uuid, queryOf(draft)).pipe(
      map((view): PreviewOutcome => ({ ok: true, view })),
      catchError(() => of<PreviewOutcome>({ ok: false })),
    );
  }

  private applyPreview(outcome: PreviewOutcome): void {
    if (!outcome.ok) {
      this.serverDiagnostics.set([]);
      this.state.set('unavailable');
      return;
    }
    const view = outcome.view;
    this.serverDiagnostics.set(view.diagnostics ?? []);
    this.matchCount.set(view.matchCount ?? 0);
    this.selectedCount.set(view.selectedCount ?? 0);
    this.state.set(view.valid ? 'valid' : 'invalid');
  }

  private onSaveError(err: unknown): void {
    this.saving.set(false);
    if (err instanceof HttpErrorResponse) {
      const body = (err.error ?? {}) as { diagnostics?: RecordSetQueryDiagnostic[]; detail?: string };
      if (err.status === 422 && Array.isArray(body.diagnostics)) {
        this.serverDiagnostics.set(body.diagnostics);
        this.state.set('invalid');
        this.toasts.show('The set query has errors — see the messages in the panel.', 'error');
        return;
      }
      if (err.status === 409) {
        this.toasts.show('Someone else changed this record set — reloading the current version.', 'error');
        this.stale.emit();
        return;
      }
      if (err.status === 403) {
        this.toasts.show('You need the editor role to change a set query.', 'error');
        return;
      }
      if (body.detail) {
        this.toasts.show(body.detail, 'error');
        return;
      }
    }
    this.toasts.show('Could not save the set query — try again in a moment.', 'error');
  }
}
