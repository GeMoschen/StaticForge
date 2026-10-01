import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDataTableColumn, SfDataTableFilter } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { minutesAgo } from '../changes/sample-area.util';
import { PROJECT_KEY, RegisteredUrl, URLS } from './publishing-data';
import { PublishingState } from './publishing-state';

const TYPE_ICONS: Readonly<Record<RegisteredUrl['type'], string>> = { page: 'description', media: 'image', folder: 'folder' };

/**
 * Publishing › URLs: the URL registry — every URL a page, folder or file was given, per channel, language and area —
 * in an `sf-data-table` with its search and filters in one aligned bar. **Reset all** lives in the bar's ⋮ menu, asks
 * for the project key, and is hidden when the registry is empty.
 */
@Component({
  selector: 'sf-sample-urls',
  standalone: true,
  imports: [SfBadgeComponent, SfDataTableCellDirective, SfDataTableComponent, SfIconComponent, SfMenuComponent, SfRelativeTimeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-urls.component.html',
  styleUrl: './sample-urls.component.scss',
})
export class SampleUrlsComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  private readonly confirms = inject(ConfirmService);
  private readonly now = Date.now();

  protected readonly rows = signal<readonly RegisteredUrl[]>(URLS);
  protected readonly typeIcons = TYPE_ICONS;
  protected readonly rowKey = (row: RegisteredUrl) => row.id;
  protected readonly rowLabel = (row: RegisteredUrl) => row.url;

  protected readonly columns = computed<SfDataTableColumn<RegisteredUrl>[]>(() => {
    const h = (id: string) => this.t(`urls.columns.${id}`);
    return [
      { id: 'target', header: h('target'), value: (r) => r.target, sortable: true, hideable: false, width: 220 },
      { id: 'type', header: h('type'), value: (r) => r.type, hidden: true, width: 100 },
      { id: 'channel', header: h('channel'), value: (r) => r.channel, sortable: true, width: 100 },
      { id: 'lang', header: h('lang'), value: (r) => r.lang, sortable: true, width: 100 },
      { id: 'area', header: h('area'), value: (r) => r.area, sortable: true, width: 110 },
      { id: 'url', header: h('url'), value: (r) => r.url, sortable: true, width: 280 },
      { id: 'overridden', header: h('overridden'), value: (r) => (r.overridden ? 'manual' : 'auto'), width: 110 },
      { id: 'assigned', header: h('assigned'), value: (r) => r.assignedMinutes, sortable: true, width: 130 },
    ];
  });

  protected readonly filters = computed<SfDataTableFilter<RegisteredUrl>[]>(() => [
    {
      id: 'type',
      label: this.t('urls.columns.type'),
      options: (['page', 'folder', 'media'] as const).map((v) => ({ value: v, label: this.t(`urls.type.${v}`) })),
    },
    { id: 'channel', label: this.t('urls.columns.channel'), options: ['html', 'rss', 'all'].map((v) => ({ value: v, label: v })) },
    { id: 'lang', label: this.t('urls.columns.lang'), options: ['DE', 'EN'].map((v) => ({ value: v, label: v })) },
    {
      id: 'area',
      label: this.t('urls.columns.area'),
      options: (['generated', 'preview'] as const).map((v) => ({ value: v, label: this.t(`urls.area.${v}`) })),
    },
  ]);

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    { id: 'resetAll', label: this.t('urls.resetAll'), icon: 'restart_alt', danger: true, action: () => void this.resetAll() },
  ]);

  protected assigned(row: RegisteredUrl): number {
    return minutesAgo(row.assignedMinutes, this.now);
  }

  private async resetAll(): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.t('urls.resetTitle'),
      message: this.t('urls.resetMessage', { count: this.rows().length, key: PROJECT_KEY }),
      confirmLabel: this.t('urls.resetConfirm'),
      tone: 'danger',
      typeToConfirm: PROJECT_KEY,
      irreversible: true,
    });
    if (confirmed) {
      this.rows.set([]);
      this.state.notice('urls.resetDone');
    }
  }
}
