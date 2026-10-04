import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  SfDataTableBulkAction,
  SfDataTableColumn,
  SfDataTableFilter,
  SfDataTableSelection,
} from '../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { SfAvatarComponent } from '../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent, SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import { SamplePagesReview } from './pages/sample-pages-review';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { SampleTemplateEntry, SampleTemplateKind, templateChildren, templateEntry, templateMeta, templateUsageCount } from './sample-content-data';
import { SampleState } from './sample-state';
import { TEMPLATE_ICONS } from './sample-templates-tree.component';

const KIND_FILTER = 'kind';
const KINDS: readonly SampleTemplateKind[] = ['page', 'section', 'dataset', 'folder'];

/**
 * The Templates folder view (M35.21, gate round 13 — **awaiting sign-off**): a page header with the folder's name, the
 * breadcrumb, **New** (a menu that names the kind: page template, section template, dataset, folder) and the folder's ⋮
 * (Rename…, Move…, Delete — the top level has none), and an `sf-data-table` of what is inside: **Name** (icon of the
 * kind), **Kind**, **Channels** (a chip per channel), **Used by** (the count, a button that opens the *Used by* drawer)
 * and **Modified**. A *Kind* filter chip group ("Kind: Page template"), multi-select with bulk **Move…** and **Delete**
 * (confirmation naming what is in use, Undo). Folders show "—" for channels, used by and modified. Loading, error (with
 * Retry) and an empty folder are the same states as the other folder tables (`fstate=loading|error|empty`).
 */
@Component({
  selector: 'sf-sample-template-folder',
  standalone: true,
  imports: [
    SampleBreadcrumbComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfTooltipDirective,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-template-folder.component.html',
  styleUrl: './sample-folder-view.component.scss',
})
export class SampleTemplateFolderComponent {
  protected readonly state = inject(SampleState);
  protected readonly review = inject(SamplePagesReview);
  private readonly table = viewChild.required<SfDataTableComponent<SampleTemplateEntry>>(SfDataTableComponent);
  private readonly now = Date.now();

  protected readonly folder = computed(() => templateEntry(this.state.templateId()));
  protected readonly title = computed(() => this.folder()?.name ?? this.state.t('rail.templates'));
  protected readonly rows = computed(() => (['empty', 'loading', 'error'].includes(this.review.folder()) ? [] : templateChildren(this.state.templateId())));
  protected readonly loading = computed(() => this.review.folder() === 'loading');
  protected readonly failed = computed(() => this.review.folder() === 'error');
  protected readonly icons = TEMPLATE_ICONS;
  protected readonly meta = templateMeta;
  protected readonly usage = templateUsageCount;
  protected readonly rowKey = (row: SampleTemplateEntry) => row.id;
  protected readonly rowLabel = (row: SampleTemplateEntry) => row.name;

  protected readonly columns = computed<SfDataTableColumn<SampleTemplateEntry>[]>(() => {
    const header = (id: string) => this.state.t(`templateFolder.columns.${id}`);
    return [
      { id: 'name', header: header('name'), value: (r) => r.name, sortable: true, hideable: false, width: 260 },
      { id: 'kind', header: header('kind'), value: (r) => this.kindLabel(r.kind), sortable: true, width: 150 },
      { id: 'channels', header: header('channels'), value: (r) => templateMeta(r).channels.join(), width: 150, searchable: false },
      { id: 'usedBy', header: header('usedBy'), value: (r) => templateUsageCount(r), sortable: true, align: 'end', width: 130, searchable: false },
      { id: 'modified', header: header('modified'), value: (r) => (r.kind === 'folder' ? Number.MAX_SAFE_INTEGER : templateMeta(r).modifiedMinutes), sortable: true, width: 170 },
    ];
  });

  protected readonly filters = computed<SfDataTableFilter<SampleTemplateEntry>[]>(() => [
    {
      id: KIND_FILTER,
      label: this.state.t('templateFolder.kindFilter'),
      options: KINDS.map((kind) => ({ value: kind, label: this.kindLabel(kind), icon: TEMPLATE_ICONS[kind] })),
      match: (row, values) => values.includes(row.kind),
    },
  ]);

  protected readonly bulkActions = computed<SfDataTableBulkAction<SampleTemplateEntry>[]>(() => [
    { id: 'move', label: this.state.t('folder.bulk.move'), icon: 'drive_file_move', action: (s) => void this.move(s.rows) },
    { id: 'delete', label: this.state.t('folder.bulk.delete'), icon: 'delete', variant: 'danger', action: (s) => void this.delete(s) },
  ]);

  /** *New* names the kind in each entry; the folder it opened in is where the new item goes. */
  protected readonly newItems = computed<SfMenuItem[]>(() => {
    const where = this.state.templateId();
    const item = (id: 'page' | 'section' | 'dataset' | 'folder', action: () => void): SfMenuItem => ({
      id,
      icon: TEMPLATE_ICONS[id],
      label: this.state.t(`templates.new.${id}`),
      action,
    });
    return [
      item('page', () => void this.state.newTemplate(where, 'page')),
      item('section', () => void this.state.newTemplate(where, 'section')),
      item('dataset', () => void this.state.newTemplate(where, 'dataset')),
      { ...item('folder', () => this.state.notice('folder.newFolderNotice')), separatorBefore: true },
    ];
  });

  /** The folder's menu; the top level has none (it cannot be renamed, moved or deleted). */
  protected readonly moreActions = computed<SfMenuItem[]>(() =>
    this.folder()
      ? [
          { id: 'rename', label: this.state.t('templateActions.renameDialog'), icon: 'edit', shortcut: 'F2' },
          { id: 'move', label: this.state.t('folder.move'), icon: 'drive_file_move' },
          { id: 'delete', label: this.state.t('folder.delete'), icon: 'delete', danger: true, separatorBefore: true },
        ]
      : [],
  );

  protected kindLabel(kind: SampleTemplateKind): string {
    return this.state.t(`templates.kind.${kind}`);
  }

  protected open(row: SampleTemplateEntry): void {
    this.state.openTemplate(row.id);
  }

  protected minutesAgo(minutes: number): number {
    return this.now - minutes * 60_000;
  }

  protected showUsedBy(row: SampleTemplateEntry, event: Event): void {
    event.stopPropagation();
    this.state.templateUsedBy.set(row.id);
  }

  protected secondary(item: SfMenuItem): void {
    const folder = this.folder();
    if (!folder) {
      return;
    }
    if (item.id === 'rename') {
      void this.state.renameTemplate(folder);
    } else if (item.id === 'move') {
      void this.state.moveTemplates([folder]);
    } else {
      void this.state.deleteTemplates([folder]);
    }
  }

  private async move(entries: readonly SampleTemplateEntry[]): Promise<void> {
    if (await this.state.moveTemplates(entries)) {
      this.table().clearSelection();
    }
  }

  private async delete(selection: SfDataTableSelection<SampleTemplateEntry>): Promise<void> {
    if (await this.state.deleteTemplates(selection.rows)) {
      this.table().clearSelection();
    }
  }
}
