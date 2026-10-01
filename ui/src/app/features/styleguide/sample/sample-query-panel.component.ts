import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { sfUniqueId } from '../../../shared/components/forms/sf-field-context';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../shared/components/forms/sf-number-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../shared/components/forms/sf-select.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SampleCondition, SampleDataset, SampleOperator, SampleQuery } from './sample-content-data';
import { OPERATORS, SampleQueryKind, expressionOf, fieldOf, isComplete, newCondition, queryFields, queryKind, valueLabel } from './sample-query';
import { SampleState } from './sample-state';

/**
 * The record set's query panel (M35.9, decision 13): collapsed it is one line — a readable summary ("Where roast is
 * light and stock is greater than 0 · sorted by name") and how many records match. Expanded it is a filter builder:
 * condition rows (field, operator, value; add and remove), the sort field and direction, and — in developer mode only —
 * the expression the builder writes. The host owns the query (`query`, two-way) and applies it.
 */
@Component({
  selector: 'sf-sample-query-panel',
  standalone: true,
  imports: [
    SfButtonComponent,
    SfFieldComponent,
    SfIconComponent,
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

  readonly dataset = input.required<SampleDataset>();
  readonly query = model.required<SampleQuery>();
  readonly expanded = model(false);
  /** Records selected by the query, and in the set. */
  readonly matching = input.required<number>();
  readonly total = input.required<number>();

  protected readonly bodyId = sfUniqueId('sample-query-body');
  protected readonly headingId = sfUniqueId('sample-query-heading');

  protected readonly fieldOptions = computed<SfSelectOption<string>[]>(() =>
    queryFields(this.dataset()).map((field) => ({ value: field.id, label: field.label })),
  );

  protected readonly directionOptions = computed<SfSegmentedOption<'asc' | 'desc'>[]>(() => [
    { value: 'asc', label: this.state.t('query.ascending'), icon: 'arrow_upward' },
    { value: 'desc', label: this.state.t('query.descending'), icon: 'arrow_downward' },
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
        operators: OPERATORS[kind].map((op): SfSelectOption<SampleOperator> => ({ value: op, label: this.state.t(`query.ops.${op}`) })),
        values: (field?.options ?? []).map((o): SfSelectOption<string> => ({ value: o.value, label: o.label })),
        fieldLabel: field?.label ?? condition.field,
      };
    });
  });

  protected readonly expression = computed(() => expressionOf(this.query(), this.dataset()));

  /** "Where roast is light and stock is greater than 0 · sorted by name". */
  protected readonly summary = computed(() => {
    const dataset = this.dataset();
    const query = this.query();
    const parts = query.conditions.filter(isComplete).map((condition) =>
      this.state.t('query.condition', {
        field: (fieldOf(dataset, condition.field)?.label ?? condition.field).toLowerCase(),
        op: this.state.t(`query.ops.${condition.op}`),
        value: valueLabel(condition, dataset).toLowerCase(),
      }),
    );
    const sort = this.state.t(query.sortDirection === 'desc' ? 'query.sortedDesc' : 'query.sortedBy', {
      field: (fieldOf(dataset, query.sortField)?.label ?? query.sortField).toLowerCase(),
    });
    const where = parts.length ? this.state.t('query.where', { conditions: parts.join(this.state.t('query.and')) }) : this.state.t('query.all');
    return `${where} · ${sort}`;
  });

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }

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

  protected setSortField(field: string | null): void {
    if (field) {
      this.query.update((q) => ({ ...q, sortField: field }));
    }
  }

  protected setSortDirection(direction: 'asc' | 'desc' | null): void {
    if (direction) {
      this.query.update((q) => ({ ...q, sortDirection: direction }));
    }
  }

  private replace(next: SampleCondition): void {
    this.query.update((q) => ({ ...q, conditions: q.conditions.map((c) => (c.id === next.id ? next : c)) }));
  }
}
