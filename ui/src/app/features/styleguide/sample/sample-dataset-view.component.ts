import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfCodePanelComponent } from '../../../shared/code-editor/sf-code-panel.component';
import { SfDataTableColumn } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfSectionComponent } from '../../../shared/components/layout/sf-section.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfTab, SfTabsComponent, panelIdOf, tabIdOf } from '../../../shared/components/sf-tabs.component';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { SampleContentEntry, SampleDataset, SampleDatasetField, cdlOf, contentPath, datasetById, recordSets } from './sample-content-data';
import { SAMPLE_DATASET_TABS, SampleDatasetTab, SampleState } from './sample-state';

const TABS_ID = 'sample-dataset';

/** A code tab: its source, language and file name. */
interface CodeTab {
  readonly id: SampleDatasetTab;
  readonly fileName: string;
  readonly language: 'cdl' | 'octl';
  readonly languageLabel: string;
  readonly format: 'PLAIN' | 'HTML' | 'XML';
  readonly source: string;
}

/**
 * The dataset view (developer mode, M35.9 decision 14): page header (name, "Dataset", ⋮) and tabs — Overview (the
 * fields in an `sf-data-table`, and the record sets using the dataset, which open in the Content area), Schema and
 * Rules (CDL), and one tab per record template channel (OCTL), each read-only in an `sf-code-panel`.
 */
@Component({
  selector: 'sf-sample-dataset-view',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    SampleBreadcrumbComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfCodePanelComponent,
    SfCopyableComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfPageHeaderComponent,
    SfSectionComponent,
    SfTabsComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-dataset-view.component.html',
  styleUrl: './sample-dataset-view.component.scss',
})
export class SampleDatasetViewComponent {
  protected readonly state = inject(SampleState);
  protected readonly tabsId = TABS_ID;

  protected readonly dataset = computed<SampleDataset>(() => datasetById(this.state.templateId())!);
  protected readonly fieldKey = (field: SampleDatasetField) => field.id;
  protected readonly fieldLabel = (field: SampleDatasetField) => field.label;

  protected readonly tabs = computed<SfTab[]>(() => {
    const channels = this.dataset().channels;
    return SAMPLE_DATASET_TABS.filter((id) => (id === 'html' || id === 'rss' ? !!channels[id] : true)).map((id) => ({
      id,
      label: id === 'html' || id === 'rss' ? id : this.state.t(`dataset.tabs.${id}`),
    }));
  });
  protected readonly tab = computed<SampleDatasetTab>(() => {
    const selected = this.state.datasetTab();
    return this.tabs().some((t) => t.id === selected) ? selected : 'overview';
  });

  protected readonly code = computed<CodeTab | null>(() => {
    const dataset = this.dataset();
    switch (this.tab()) {
      case 'schema':
        return { id: 'schema', fileName: `${dataset.uid}.content.cdl`, language: 'cdl', languageLabel: 'CDL', format: 'PLAIN', source: cdlOf(dataset) };
      case 'rules':
        return {
          id: 'rules',
          fileName: `${dataset.uid}.rules.cdl`,
          language: 'cdl',
          languageLabel: 'CDL',
          format: 'PLAIN',
          source: dataset.rules || this.state.t('dataset.noRules'),
        };
      case 'html':
      case 'rss': {
        const channel = this.tab() as 'html' | 'rss';
        const format = channel === 'html' ? 'HTML' : 'XML';
        return {
          id: channel,
          fileName: `${dataset.uid}.${channel}.octl`,
          language: 'octl',
          languageLabel: `OCTL · ${format}`,
          format,
          source: dataset.channels[channel] ?? '',
        };
      }
      default:
        return null;
    }
  });

  protected readonly columns = computed<SfDataTableColumn<SampleDatasetField>[]>(() => {
    const header = (id: string) => this.state.t(`dataset.columns.${id}`);
    return [
      { id: 'name', header: header('name'), value: (f) => f.label, sortable: true, hideable: false, width: 220 },
      { id: 'type', header: header('type'), value: (f) => this.state.t(`dataset.types.${f.type}`), sortable: true, width: 140 },
      { id: 'required', header: header('required'), value: (f) => (f.required ? 1 : 0), sortable: true, width: 100, align: 'center' },
      { id: 'localized', header: header('localized'), value: (f) => (f.localized ? 1 : 0), sortable: true, width: 100, align: 'center' },
      { id: 'rules', header: header('rules'), value: (f) => f.rules, sortable: true, width: 80, align: 'end' },
    ];
  });

  /** The record sets built on this dataset, with where they live. */
  protected readonly usedBy = computed(() => {
    const id = this.dataset().id;
    const records = this.state.records();
    return recordSets()
      .filter((set) => set.dataset === id)
      .map((set: SampleContentEntry) => ({
        set,
        path: contentPath(set.id)
          .slice(0, -1)
          .map((e) => e.name)
          .join(' › '),
        count: records.get(set.id)?.length ?? 0,
      }));
  });

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    { id: 'rename', label: this.state.t('editor.rename'), icon: 'edit', shortcut: 'F2' },
    { id: 'duplicate', label: this.state.t('editor.duplicate'), icon: 'content_copy' },
    { id: 'usedBy', label: this.state.t('content.usedBy'), icon: 'link' },
    { id: 'delete', label: this.state.t('editor.delete'), icon: 'delete', danger: true, separatorBefore: true },
  ]);

  protected selectTab(id: string): void {
    this.state.datasetTab.set(id as SampleDatasetTab);
  }

  protected tabId(id: string): string {
    return tabIdOf(TABS_ID, id);
  }

  protected panelId(id: string): string {
    return panelIdOf(TABS_ID, id);
  }
}
