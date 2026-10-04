import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import { assetRoute } from '../../shared/asset-route.util';
import { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import type { EditorDefinition } from '../forms/form.model';
import type { DatasetField } from './dataset-fields.util';

type UsageDto = components['schemas']['UsageDto'];

/**
 * The Overview tab of the dataset editor (M35.21 C, gate decision 167): the dataset's fields in an `sf-data-table`
 * (name, type, required, localized, rules), the definition the schema editor never had a CDL line for (description and
 * the title field), and *Used by* — the record sets and templates built on the dataset, each linking to its screen.
 * It holds no state: the editor owns the values.
 */
@Component({
  selector: 'sf-dataset-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    SfBadgeComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfFieldComponent,
    SfIconComponent,
    SfSectionComponent,
    TranslocoPipe,
  ],
  templateUrl: './dataset-overview.component.html',
  styleUrl: './dataset-overview.component.scss',
})
export class DatasetOverviewComponent {
  readonly projectKey = input.required<string>();
  readonly datasetUuid = input.required<string>();
  readonly name = input.required<string>();
  readonly fields = input.required<readonly DatasetField[]>();
  readonly recordCount = input(0);
  /** What uses the dataset (`null` while it is being read, `undefined`-free: an empty list means nothing does). */
  readonly usages = input<readonly UsageDto[] | null>(null);
  readonly usagesFailed = input(false);
  readonly description = input('');
  readonly titleEditor = input('');
  /** The text editors a record's display name can come from. */
  readonly textEditors = input<readonly EditorDefinition[]>([]);
  readonly loopSnippet = input('');
  readonly readOnly = input(false);

  readonly descriptionChange = output<string>();
  readonly titleEditorChange = output<string>();

  private readonly transloco = inject(TranslocoService);

  protected readonly fieldKey = (field: DatasetField) => field.name;
  protected readonly fieldLabel = (field: DatasetField) => field.label;

  protected readonly columns = computed<SfDataTableColumn<DatasetField>[]>(() => {
    const header = (id: string) => this.transloco.translate(`templates.dataset.columns.${id}`);
    return [
      { id: 'name', header: header('name'), value: (f) => f.label, sortable: true, hideable: false, width: 220 },
      { id: 'type', header: header('type'), value: (f) => f.type, sortable: true, width: 140 },
      { id: 'required', header: header('required'), value: (f) => (f.required ? 1 : 0), sortable: true, width: 100, align: 'center' },
      { id: 'localized', header: header('localized'), value: (f) => (f.localized ? 1 : 0), sortable: true, width: 100, align: 'center' },
      { id: 'rules', header: header('rules'), value: (f) => f.rules, sortable: true, width: 80, align: 'end' },
    ];
  });

  /** The usages with where they open and what kind of thing they are. */
  protected readonly rows = computed(() =>
    (this.usages() ?? []).map((usage) => ({
      usage,
      link: usage.fromUuid && usage.fromType ? assetRoute(this.projectKey(), { type: usage.fromType, uuid: usage.fromUuid }) : null,
      type: this.typeLabel(usage.fromType),
    })),
  );

  protected typeLabel(type: string | undefined): string {
    const known = ['PAGE', 'PAGE_TEMPLATE', 'SECTION_TEMPLATE', 'RECORD', 'RECORD_SET', 'DATASET', 'GLOBAL_SET', 'NAVIGATION'];
    return type && known.includes(type)
      ? this.transloco.translate(`content.record.panel.type.${type}`)
      : (type ?? '').toLowerCase().replace(/_/g, ' ');
  }

  protected onDescription(event: Event): void {
    this.descriptionChange.emit((event.target as HTMLTextAreaElement).value);
  }

  protected onTitleEditor(event: Event): void {
    this.titleEditorChange.emit((event.target as HTMLSelectElement).value);
  }
}
