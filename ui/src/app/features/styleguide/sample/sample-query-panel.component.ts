import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { SfDateInputComponent } from '../../../shared/components/forms/sf-date-input.component';
import { sfUniqueId } from '../../../shared/components/forms/sf-field-context';
import { SfFindingComponent } from '../../../shared/components/forms/sf-finding.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../shared/components/forms/sf-number-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../shared/components/forms/sf-select.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SampleCondition, SampleDataset, SampleOperator, SampleQuery, SampleSortKey } from './sample-content-data';
import {
  OPERATORS,
  SampleQueryKind,
  conditionsOfExpression,
  expressionOf,
  fieldOf,
  isComplete,
  newCondition,
  operatorKey,
  queryFields,
  queryKind,
  valueLabel,
} from './sample-query';
import { SampleState } from './sample-state';

/**
 * The record set's query panel (M35.9, decision 13; M35.20, gate round 11): collapsed it is one line — a readable summary
 * ("Where roast is light and stock is greater than 0 · sorted by name") and how many records match. Expanded it is a
 * filter builder: condition rows (field, operator, value — a date picker for a date, Yes/No for a yes/no field; add and
 * remove), the sort keys (several, each with a direction, reorderable) and the offset and limit; developer mode adds the
 * expression the builder writes. A stored expression the builder cannot show (`||`) is shown as it is, the builder steps
 * aside and *Clear filter* returns to it. Edits are a draft: **Save filter** keeps them (the table follows the saved
 * filter), **Revert** drops them. The host owns both queries (`query` the draft, `saved`, two-way).
 */
@Component({
  selector: 'sf-sample-query-panel',
  standalone: true,
  imports: [
    SfButtonComponent,
    SfDateInputComponent,
    SfFieldComponent,
    SfFindingComponent,
    SfInputComponent,
    SfNumberInputComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-query-panel.component.html',
  styleUrl: './sample-query-panel.component.scss',
})
export class SampleQueryPanelComponent {
  protected readonly state = inject(SampleState);
  private readonly toasts = inject(ToastService);

  readonly dataset = input.required<SampleDataset>();
  /** The draft the builder edits. */
  readonly query = model.required<SampleQuery>();
  /** The stored filter: what the table shows, what Revert returns to. */
  readonly saved = model.required<SampleQuery>();
  readonly expanded = model(false);
  /** Records the filter selects, those the set shows (after offset and limit), and those in the set. */
  readonly matching = input.required<number>();
  readonly shown = input.required<number>();
  readonly total = input.required<number>();

  protected readonly bodyId = sfUniqueId('sample-query-body');
  protected readonly headingId = sfUniqueId('sample-query-heading');

  protected readonly custom = computed(() => !!this.query().custom);
  protected readonly dirty = computed(() => JSON.stringify(this.query()) !== JSON.stringify(this.saved()));

  protected readonly fieldOptions = computed<SfSelectOption<string>[]>(() =>
    queryFields(this.dataset()).map((field) => ({ value: field.id, label: field.label })),
  );

  protected readonly directionOptions = computed<SfSegmentedOption<'asc' | 'desc'>[]>(() => [
    { value: 'asc', label: this.state.t('query.ascending'), icon: 'arrow_upward' },
    { value: 'desc', label: this.state.t('query.descending'), icon: 'arrow_downward' },
  ]);

  protected readonly booleanOptions = computed<SfSelectOption<string>[]>(() => [
    { value: 'true', label: this.state.t('dataset.yes') },
    { value: 'false', label: this.state.t('dataset.no') },
  ]);

  /** Per condition: its value control and operator choices. */
  protected readonly rows = computed(() => {
    const dataset = this.dataset();
    this.state.t('query.ops.is'); // tracks the language file
    return this.query().conditions.map((condition) => {
      const field = fieldOf(dataset, condition.field);
      const kind: SampleQueryKind = field ? queryKind(field) : 'text';
      return {
        condition,
        kind,
        operators: OPERATORS[kind].map(
          (op): SfSelectOption<SampleOperator> => ({ value: op, label: this.state.t(`query.ops.${operatorKey(kind, op)}`) }),
        ),
        values: (field?.options ?? []).map((o): SfSelectOption<string> => ({ value: o.value, label: o.label })),
        fieldLabel: field?.label ?? condition.field,
      };
    });
  });

  /** Per sort key: its field choices — a field another key already sorts by is taken. */
  protected readonly sortRows = computed(() => {
    const keys = this.query().sort;
    return keys.map((key) => ({
      key,
      options: this.fieldOptions().map((option) => ({
        ...option,
        disabled: option.value !== key.field && keys.some((other) => other.field === option.value),
      })),
    }));
  });
  protected readonly canAddSortKey = computed(() => this.query().sort.length < this.fieldOptions().length);

  protected readonly expression = computed(() => expressionOf(this.query(), this.dataset()));

  private label(field: string): string {
    return (fieldOf(this.dataset(), field)?.label ?? field).toLowerCase();
  }

  private valueText(condition: SampleCondition): string {
    const field = fieldOf(this.dataset(), condition.field);
    if (field && queryKind(field) === 'boolean') {
      return this.state.t(condition.value === 'true' ? 'query.yes' : 'query.no');
    }
    return valueLabel(condition, this.dataset()).toLowerCase();
  }

  /** "Where roast is light and stock is greater than 0 · sorted by name · skipping the first 2 · at most 10". */
  protected readonly summary = computed(() => {
    const dataset = this.dataset();
    const query = this.query();
    const parts: string[] = [];
    if (query.custom) {
      parts.push(this.state.t('query.where', { conditions: query.custom }));
    } else {
      const sentences = query.conditions.filter(isComplete).map((condition) => {
        const field = fieldOf(dataset, condition.field);
        return this.state.t('query.condition', {
          field: this.label(condition.field),
          op: this.state.t(`query.ops.${operatorKey(field ? queryKind(field) : 'text', condition.op)}`),
          value: this.valueText(condition),
        });
      });
      parts.push(sentences.length ? this.state.t('query.where', { conditions: sentences.join(this.state.t('query.and')) }) : this.state.t('query.all'));
    }
    parts.push(this.sortSummary(query.sort));
    if (query.offset) {
      parts.push(this.state.t('query.skipping', { count: query.offset }));
    }
    if (query.limit !== null) {
      parts.push(this.state.t('query.atMost', { count: query.limit }));
    }
    return parts.join(' · ');
  });

  /** How many records match, and — when the offset or limit cut the list — how many the set shows. */
  protected readonly status = computed(() => {
    const base = this.state.t('query.matching', { count: this.matching(), total: this.total() });
    return this.shown() === this.matching() ? base : `${base} · ${this.state.t('query.shows', { count: this.shown() })}`;
  });

  private sortSummary(sort: readonly SampleSortKey[]): string {
    if (sort.length === 0) {
      return this.state.t('query.sortedBy', { field: this.label(this.dataset().displayField) });
    }
    if (sort.length === 1) {
      return this.state.t(sort[0].direction === 'desc' ? 'query.sortedDesc' : 'query.sortedBy', { field: this.label(sort[0].field) });
    }
    const keys = sort.map((key) =>
      key.direction === 'desc' ? this.state.t('query.keyDesc', { field: this.label(key.field) }) : this.label(key.field),
    );
    return this.state.t('query.sortedBy', { field: keys.join(this.state.t('query.then')) });
  }

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }

  /** "Use as set filter": the table's expression filter and sort replace the draft's (unsaved), and the panel opens. */
  adopt(where: string, sort: readonly SampleSortKey[]): void {
    this.expanded.set(true);
    const conditions = conditionsOfExpression(where, this.dataset());
    this.query.update((q) => ({
      ...q,
      conditions: conditions ?? [],
      custom: conditions === null ? where.trim() : null,
      sort: sort.length > 0 ? sort : q.sort,
    }));
  }

  // ── The builder ────────────────────────────────────────────────────────────

  protected addCondition(): void {
    this.query.update((q) => ({ ...q, conditions: [...q.conditions, newCondition(this.dataset())] }));
  }

  protected removeCondition(id: string): void {
    this.query.update((q) => ({ ...q, conditions: q.conditions.filter((c) => c.id !== id) }));
  }

  /** A new field resets the operator and value to that field's defaults. */
  protected setField(condition: SampleCondition, fieldId: string | null): void {
    if (!fieldId || fieldId === condition.field) {
      return;
    }
    this.replace({ ...newCondition(this.dataset(), fieldId), id: condition.id });
  }

  protected setOperator(condition: SampleCondition, op: SampleOperator | null): void {
    if (op) {
      this.replace({ ...condition, op });
    }
  }

  protected setValue(condition: SampleCondition, value: string | number | null): void {
    this.replace({ ...condition, value });
  }

  /** The stored expression is given up: the builder returns, with no conditions. */
  protected clearFilter(): void {
    this.query.update((q) => ({ ...q, conditions: [], custom: null }));
  }

  // ── The sort order ─────────────────────────────────────────────────────────

  protected addSortKey(): void {
    const taken = new Set(this.query().sort.map((key) => key.field));
    const field = this.fieldOptions().find((option) => !taken.has(option.value));
    if (field) {
      this.query.update((q) => ({ ...q, sort: [...q.sort, { field: field.value, direction: 'asc' }] }));
    }
  }

  protected removeSortKey(index: number): void {
    this.query.update((q) => ({ ...q, sort: q.sort.filter((_, i) => i !== index) }));
  }

  protected setSortField(index: number, field: string | null): void {
    if (field) {
      this.query.update((q) => ({ ...q, sort: q.sort.map((key, i) => (i === index ? { ...key, field } : key)) }));
    }
  }

  protected setSortDirection(index: number, direction: 'asc' | 'desc' | null): void {
    if (direction) {
      this.query.update((q) => ({ ...q, sort: q.sort.map((key, i) => (i === index ? { ...key, direction } : key)) }));
    }
  }

  protected moveSortKey(index: number, delta: -1 | 1): void {
    const target = index + delta;
    this.query.update((q) => {
      if (target < 0 || target >= q.sort.length) {
        return q;
      }
      const sort = [...q.sort];
      [sort[index], sort[target]] = [sort[target], sort[index]];
      return { ...q, sort };
    });
  }

  protected setOffset(value: number | null): void {
    this.query.update((q) => ({ ...q, offset: value }));
  }

  protected setLimit(value: number | null): void {
    this.query.update((q) => ({ ...q, limit: value }));
  }

  // ── Save and revert ────────────────────────────────────────────────────────

  protected save(): void {
    this.saved.set(this.query());
    this.toasts.show(this.state.t('query.savedNotice'), 'success');
  }

  protected revert(): void {
    this.query.set(this.saved());
  }

  private replace(next: SampleCondition): void {
    this.query.update((q) => ({ ...q, conditions: q.conditions.map((c) => (c.id === next.id ? next : c)) }));
  }
}
