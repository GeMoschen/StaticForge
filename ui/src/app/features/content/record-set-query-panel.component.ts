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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { catchError, EMPTY, map, of, Subject, switchMap, timer, type Observable } from 'rxjs';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfCodeEditorComponent } from '../../shared/code-editor/code-editor.component';
import { SfDateInputComponent } from '../../shared/components/forms/sf-date-input.component';
import { sfUniqueId } from '../../shared/components/forms/sf-field-context';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../shared/components/forms/sf-number-input.component';
import { SfSegmentedComponent, type SfSegmentedOption } from '../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, type SfSelectOption } from '../../shared/components/forms/sf-select.component';
import { SfFindingComponent } from '../../shared/components/forms/sf-finding.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
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
  type Condition,
  type ConditionKind,
  type ConditionOp,
  type QueryField,
  OPERATORS,
  fieldOf,
  isComplete,
  newCondition,
  parseWhere,
  queryFieldsOf,
  whereOf,
} from './set-query-builder.util';
import {
  adoptGridFilter,
  draftOf,
  EMPTY_DRAFT,
  localDiagnostics,
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

/** Record meta fields a set can be sorted by (`META_SORT_FIELDS`), with the translation key of their names. */
const META_SORT_OPTIONS: readonly { field: string; key: string }[] = [
  { field: '_displayName', key: 'name' },
  { field: '_uid', key: 'uid' },
  { field: '_changedAt', key: 'changed' },
];

/** A preview request: the draft to check, or `null` to drop a pending one. */
interface PreviewRequest {
  draft: SetQueryDraft | null;
  immediate: boolean;
}

type PreviewOutcome = { ok: true; view: RecordSetQueryPreviewView } | { ok: false };

/** One builder row with what its controls need. */
interface ConditionRow {
  condition: Condition;
  kind: ConditionKind;
  field: QueryField | null;
  operators: SfSelectOption<ConditionOp>[];
  values: SfSelectOption<string>[];
}

/**
 * The **Filter** panel of a record set (M25.5.1, redone in M35.20 after the signed-off sample, gate decision 13): the
 * stored `where` / sort keys / `limit` / `offset` deciding which of the set's records it shows and in which order.
 *
 * <p>Collapsed it is one line: a readable summary ("Where role is lead · sorted by name") and how many records match.
 * Expanded, editors get a **filter builder** — condition rows (field, operator, value), the sort keys, and the limit and
 * offset — and developer mode adds the expression the builder writes, editable. The stored query stays the server's
 * expression text: the builder writes it, and reads it back only when it could have written it. A stored expression it
 * cannot show (`||`, groups, functions) stays as it is: the builder steps aside and says so, and the expression is
 * shown (editable in developer mode); *Clear filter* returns to the builder.
 *
 * <p>Every edit is checked by `POST …/preview-query` after a short debounce (a newer edit cancels a pending or in-flight
 * check), which answers with the server's diagnostics and live counts — "N of M records match". `limit`/`offset` that
 * aren't whole numbers are caught locally and never sent. Save is enabled only for a changed, not-invalid draft and sends
 * the whole query with `If-Match`; a `409` means someone else saved first, so the panel asks the set view to reload
 * instead of overwriting. Revert goes back to the stored query.
 *
 * <p>Read-only (viewer role, time travel) the panel shows the stored query and the stored validation state, and never
 * calls the preview — it is an editor's tool and a `POST`.
 */
@Component({
  selector: 'sf-record-set-query-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfCodeEditorComponent,
    SfDateInputComponent,
    SfFindingComponent,
    SfInputComponent,
    SfNumberInputComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    TranslocoPipe,
  ],
  templateUrl: './record-set-query-panel.component.html',
  styleUrl: './record-set-query-panel.component.scss',
})
export class RecordSetQueryPanelComponent {
  readonly projectKey = input.required<string>();
  readonly set = input.required<RecordSetDetailView>();
  /** The set's dataset (its schema names the fields the builder and the sort picker offer). */
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
  private readonly transloco = inject(TranslocoService);
  protected readonly developerMode = inject(DeveloperModeService).enabled;

  protected readonly bodyId = sfUniqueId('set-query-body');
  protected readonly headingId = sfUniqueId('set-query-heading');

  /** Collapsed by default (decision 13): the summary says what the filter does. */
  readonly expanded = signal(false);
  /** The stored query, as a draft — what "dirty" and Revert compare against. */
  private readonly base = signal<SetQueryDraft>(EMPTY_DRAFT);
  protected readonly draft = signal<SetQueryDraft>(EMPTY_DRAFT);
  /** The builder's rows (including the ones still without a value, which the expression leaves out). */
  protected readonly conditions = signal<Condition[]>([]);
  /** The draft's `where` is more than the builder can show: it is the expression that counts. */
  protected readonly custom = signal(false);
  protected readonly state = signal<QueryCheckState>('idle');
  private readonly serverDiagnostics = signal<RecordSetQueryDiagnostic[]>([]);
  protected readonly matchCount = signal(0);
  protected readonly selectedCount = signal(0);
  protected readonly saving = signal(false);

  private readonly preview$ = new Subject<PreviewRequest>();

  private readonly columns = computed(() =>
    deriveColumns(this.dataset()?.compiledDefinition as unknown as ContentDefinition | undefined),
  );
  protected readonly fields = computed(() => queryFieldsOf(this.columns(), this.t('query.nameField')));
  protected readonly fieldOptions = computed<SfSelectOption<string>[]>(() =>
    this.fields().map((field) => ({ value: field.id, label: field.label })),
  );
  protected readonly directionOptions = computed<SfSegmentedOption<'asc' | 'desc'>[]>(() => [
    { value: 'asc', label: this.t('query.ascending'), icon: 'arrow_upward' },
    { value: 'desc', label: this.t('query.descending'), icon: 'arrow_downward' },
  ]);

  protected readonly booleanOptions = computed<SfSelectOption<string>[]>(() => [
    { value: 'true', label: this.transloco.translate('common.yes') },
    { value: 'false', label: this.transloco.translate('common.no') },
  ]);

  protected readonly rows = computed<ConditionRow[]>(() => {
    const fields = this.fields();
    return this.conditions().map((condition) => {
      const field = fieldOf(fields, condition.field);
      const kind = field?.kind ?? 'text';
      return {
        condition,
        kind,
        field,
        operators: OPERATORS[kind].map((op) => ({ value: op, label: this.opLabel(kind, op) })),
        values: (field?.options ?? []).map((option) => ({ value: option.value, label: option.label })),
      };
    });
  });

  protected readonly dirty = computed(() => !sameQuery(this.draft(), this.base()));
  private readonly localIssues = computed(() =>
    localDiagnostics(this.draft(), (field) => this.t(field === 'limit' ? 'query.limitInvalid' : 'query.offsetInvalid')),
  );
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
  protected readonly invalid = computed(() => this.state() === 'invalid');

  protected readonly total = computed(() => this.set().recordCount ?? 0);

  /** What the bar says beside the summary — what the set would show, or why it can't say. */
  protected readonly status = computed(() => {
    switch (this.state()) {
      case 'validating':
        return this.t('query.checking');
      case 'valid': {
        const base = this.t('query.matching', { count: this.matchCount(), total: this.total() });
        return this.selectedCount() !== this.matchCount() ? `${base} · ${this.t('query.shows', { count: this.selectedCount() })}` : base;
      }
      case 'invalid':
        return this.t('query.invalid');
      case 'unavailable':
        return this.t('query.unavailable');
      default:
        return this.t('query.total', { count: this.total() });
    }
  });

  /** "Where roast is Light and stock is greater than 0 · sorted by name": the draft in words. */
  protected readonly summary = computed(() => {
    const draft = this.draft();
    const fields = this.fields();
    const where = draft.where.trim();
    const parts: string[] = [];
    if (!where) {
      parts.push(this.t('query.all'));
    } else if (this.custom()) {
      parts.push(this.t('query.where', { conditions: where }));
    } else {
      const sentences = this.conditions()
        .filter((condition) => isComplete(condition, fields))
        .map((condition) => {
          const field = fieldOf(fields, condition.field);
          const option = field?.options.find((o) => o.value === condition.value);
          return this.t('query.condition', {
            field: (field?.label ?? condition.field).toLowerCase(),
            op: this.opLabel(field?.kind ?? 'text', condition.op),
            value: option?.label ?? this.valueText(condition, field),
          });
        });
      parts.push(this.t('query.where', { conditions: sentences.join(this.t('query.and')) }));
    }
    parts.push(this.sortSummary(draft.sort));
    if (draft.offset.trim()) {
      parts.push(this.t('query.skipping', { count: draft.offset.trim() }));
    }
    if (draft.limit.trim()) {
      parts.push(this.t('query.atMost', { count: draft.limit.trim() }));
    }
    return parts.join(' · ');
  });

  /**
   * The sort picker's fields: meta fields, the schema's scalar editors, and any field a key already
   * names that the schema no longer has — listed as unknown, so the select shows what the key says.
   */
  protected readonly sortOptions = computed<SfSelectOption<string>[]>(() => {
    const options: SortFieldOption[] = [
      ...META_SORT_OPTIONS.map((meta) => ({ field: meta.field, label: this.t(`query.sortFields.${meta.key}`) })),
      ...this.columns().map((column) => ({ field: column.field, label: column.label })),
    ];
    for (const key of this.draft().sort) {
      if (!options.some((o) => o.field === key.field)) {
        options.push({ field: key.field, label: this.t('query.unknownField', { field: key.field }) });
      }
    }
    return options.map((o) => ({ value: o.field, label: o.label }));
  });

  /** Per sort key: its choices — a field another key already sorts by is taken. */
  protected readonly sortRows = computed(() =>
    this.draft().sort.map((key) => ({
      key,
      options: this.sortOptions().map((o) => ({ ...o, disabled: o.value !== key.field && this.isSorted(o.value) })),
    })),
  );

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

  protected readonly canAddSortKey = computed(() => this.sortOptions().some((o) => !this.isSorted(o.value)));

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
            this.syncRows(next.where, true);
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

    // The schema arrives (or changes) after the set: read the rows again with its fields.
    effect(
      () => {
        this.fields();
        untracked(() => this.syncRows(this.draft().where, false));
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
    const next = adoptGridFilter(this.draft(), where, sort);
    this.syncRows(next.where, true);
    this.edit(next);
  }

  protected toggle(): void {
    this.expanded.update((v) => !v);
  }

  // ── The filter builder ─────────────────────────────────────────────────────

  protected addCondition(): void {
    this.setConditions([...this.conditions(), newCondition(this.fields())]);
  }

  protected removeCondition(id: string): void {
    this.setConditions(this.conditions().filter((c) => c.id !== id));
  }

  /** A new field resets the operator and value to that field's defaults. */
  protected setField(condition: Condition, fieldId: string | null): void {
    if (fieldId && fieldId !== condition.field) {
      this.replaceCondition({ ...newCondition(this.fields(), fieldId), id: condition.id });
    }
  }

  protected setOperator(condition: Condition, op: ConditionOp | null): void {
    if (op) {
      this.replaceCondition({ ...condition, op });
    }
  }

  protected setValue(condition: Condition, value: string | number | null): void {
    this.replaceCondition({ ...condition, value: value === null ? '' : String(value) });
  }

  protected clearFilter(): void {
    this.syncRows('', true);
    this.edit({ ...this.draft(), where: '' });
  }

  /** The dev-mode expression: typing it re-reads the builder's rows, or hands over to the expression when it isn't simple. */
  protected onWhereInput(where: string): void {
    this.syncRows(where, true);
    this.edit({ ...this.draft(), where });
  }

  private replaceCondition(next: Condition): void {
    this.setConditions(this.conditions().map((c) => (c.id === next.id ? next : c)));
  }

  private setConditions(conditions: Condition[]): void {
    this.conditions.set(conditions);
    this.edit({ ...this.draft(), where: whereOf(conditions, this.fields()) });
  }

  /**
   * Makes the builder rows say what `where` says: they stay when they already do (a row without a value is in the
   * rows but not in the expression), else they're read from the expression, or the builder steps aside.
   */
  private syncRows(where: string, force: boolean): void {
    const fields = this.fields();
    const trimmed = where.trim();
    if (!force && !this.custom() && whereOf(this.conditions(), fields) === trimmed) {
      return;
    }
    const parsed = parseWhere(trimmed, fields);
    this.custom.set(parsed === null);
    this.conditions.set(parsed ?? []);
  }

  // ── Sort, limit, offset ────────────────────────────────────────────────────

  protected isSorted(field: string): boolean {
    return this.draft().sort.some((s) => s.field === field);
  }

  /** Adds a key on the first field not sorted by yet — set explicitly, never left to the select's fallback. */
  protected addSortKey(): void {
    const field = this.sortOptions().find((o) => !this.isSorted(o.value))?.value;
    if (field) {
      this.edit({ ...this.draft(), sort: [...this.draft().sort, { field, direction: 'asc' }] });
    }
  }

  protected setSortField(index: number, field: string | null): void {
    if (field) {
      this.edit({ ...this.draft(), sort: this.draft().sort.map((key, i) => (i === index ? { ...key, field } : key)) });
    }
  }

  protected setSortDirection(index: number, direction: 'asc' | 'desc' | null): void {
    if (direction) {
      this.edit({ ...this.draft(), sort: this.draft().sort.map((key, i) => (i === index ? { ...key, direction } : key)) });
    }
  }

  protected moveSortKey(index: number, delta: number): void {
    this.edit({ ...this.draft(), sort: moveSortKey(this.draft().sort, index, delta) });
  }

  protected removeSortKey(index: number): void {
    this.edit({ ...this.draft(), sort: this.draft().sort.filter((_, i) => i !== index) });
  }

  protected setLimit(value: number | null): void {
    this.edit({ ...this.draft(), limit: value === null ? '' : String(value) });
  }

  protected setOffset(value: number | null): void {
    this.edit({ ...this.draft(), offset: value === null ? '' : String(value) });
  }

  protected numberOf(text: string): number | null {
    return text.trim() === '' || !Number.isFinite(Number(text)) ? null : Number(text);
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  protected revert(): void {
    this.draft.set(this.base());
    this.syncRows(this.base().where, true);
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
          this.toasts.show(this.t('query.saved'), 'success');
          this.saved.emit(view);
        },
        error: (err: unknown) => this.onSaveError(err),
      });
  }

  protected diagnosticPosition(diagnostic: RecordSetQueryDiagnostic): string {
    return diagnostic.line && diagnostic.column ? ` ${diagnostic.line}:${diagnostic.column}` : '';
  }

  // ── Words ──────────────────────────────────────────────────────────────────

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`content.recordSet.${key}`, params);
  }

  /** A date's greater-than reads "is after"; the rest reads the same for every kind. */
  private opLabel(kind: ConditionKind, op: ConditionOp): string {
    return this.t(`query.ops.${kind === 'date' && (op === 'gt' || op === 'lt') ? (op === 'gt' ? 'after' : 'before') : op}`);
  }

  private valueText(condition: Condition, field: QueryField | null): string {
    if (field?.kind === 'boolean') {
      return this.t(condition.value === 'true' ? 'query.yes' : 'query.no');
    }
    return condition.value.trim();
  }

  private sortSummary(sort: readonly RecordSort[]): string {
    if (sort.length === 0) {
      return this.t('query.sortedBy', { field: this.t('query.sortFields.name').toLowerCase() });
    }
    const label = (key: RecordSort) =>
      (this.sortOptions().find((o) => o.value === key.field)?.label ?? key.field).toLowerCase();
    if (sort.length === 1) {
      return this.t(sort[0].direction === 'desc' ? 'query.sortedDesc' : 'query.sortedBy', { field: label(sort[0]) });
    }
    const keys = sort.map((key) => (key.direction === 'desc' ? this.t('query.keyDesc', { field: label(key) }) : label(key)));
    return this.t('query.sortedBy', { field: keys.join(this.t('query.then')) });
  }

  // ── Checking ───────────────────────────────────────────────────────────────

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
        this.toasts.show(this.t('query.saveInvalid'), 'error');
        return;
      }
      if (err.status === 409) {
        this.toasts.show(this.t('query.saveConflict'), 'error');
        this.stale.emit();
        return;
      }
      if (err.status === 403) {
        this.toasts.show(this.t('query.saveForbidden'), 'error');
        return;
      }
      if (body.detail) {
        this.toasts.show(body.detail, 'error');
        return;
      }
    }
    this.toasts.show(this.t('query.saveFailed'), 'error');
  }
}
