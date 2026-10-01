import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDataTableColumn, SfDataTableFilter } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfTooltipDirective } from '../../../../shared/directives/sf-tooltip.directive';
import { minutesAgo } from '../changes/sample-area.util';
import { PROJECT_KEY, REDIRECTS, RedirectState, SampleRedirect } from './publishing-data';
import { PublishingState } from './publishing-state';
import { REDIRECT_STATE_ICONS, REDIRECT_STATE_TONES } from './publishing-status';

const STATES: readonly RedirectState[] = ['active', 'shadowed', 'dangling', 'loop'];

/**
 * Publishing › Redirects: old paths and where they lead, in an `sf-data-table` with its search and filters (kind,
 * state, language) in one aligned bar; the state explains itself in a tooltip. "Delete all manual redirects" sits in
 * the ⋮ menu of the bar, asks for the project key, and is hidden when there is nothing to delete.
 */
@Component({
  selector: 'sf-sample-redirects',
  standalone: true,
  imports: [
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfMenuComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    SfTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-redirects.component.html',
  styleUrl: './sample-redirects.component.scss',
})
export class SampleRedirectsComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  private readonly confirms = inject(ConfirmService);
  private readonly now = Date.now();

  protected readonly rows = signal<readonly SampleRedirect[]>(REDIRECTS);
  protected readonly tones = REDIRECT_STATE_TONES;
  protected readonly icons = REDIRECT_STATE_ICONS;
  protected readonly rowKey = (row: SampleRedirect) => row.id;
  protected readonly rowLabel = (row: SampleRedirect) => row.from;

  protected readonly columns = computed<SfDataTableColumn<SampleRedirect>[]>(() => {
    const h = (id: string) => this.t(`redirects.columns.${id}`);
    return [
      { id: 'from', header: h('from'), value: (r) => r.from, sortable: true, hideable: false, width: 260 },
      { id: 'to', header: h('to'), value: (r) => `${r.toPage ?? ''} ${r.to}`, width: 260 },
      { id: 'lang', header: h('lang'), value: (r) => r.lang, sortable: true, width: 100 },
      { id: 'kind', header: h('kind'), value: (r) => r.kind, sortable: true, width: 120 },
      { id: 'state', header: h('state'), value: (r) => r.state, sortable: true, width: 130 },
      { id: 'created', header: h('created'), value: (r) => r.createdMinutes, sortable: true, width: 170 },
    ];
  });

  protected readonly filters = computed<SfDataTableFilter<SampleRedirect>[]>(() => [
    {
      id: 'kind',
      label: this.t('redirects.columns.kind'),
      options: (['auto', 'manual'] as const).map((k) => ({ value: k, label: this.t(`redirects.kind.${k}`) })),
    },
    {
      id: 'state',
      label: this.t('redirects.columns.state'),
      options: STATES.map((s) => ({ value: s, label: this.t(`redirects.state.${s}`) })),
    },
    {
      id: 'lang',
      label: this.t('redirects.columns.lang'),
      options: ['DE', 'EN'].map((l) => ({ value: l, label: l })),
    },
  ]);

  protected readonly manualCount = computed(() => this.rows().filter((r) => r.kind === 'manual').length);

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    { id: 'export', label: this.t('redirects.export'), icon: 'download', action: () => this.state.notice() },
    {
      id: 'deleteManual',
      label: this.t('redirects.deleteManual'),
      icon: 'delete_sweep',
      danger: true,
      separatorBefore: true,
      action: () => void this.deleteManual(),
    },
  ]);

  protected created(row: SampleRedirect): number {
    return minutesAgo(row.createdMinutes, this.now);
  }

  private async deleteManual(): Promise<void> {
    const count = this.manualCount();
    const confirmed = await this.confirms.confirm({
      title: this.t('redirects.deleteTitle', { count }),
      message: this.t('redirects.deleteMessage', { key: PROJECT_KEY }),
      confirmLabel: this.t('redirects.deleteConfirm', { count }),
      tone: 'danger',
      typeToConfirm: PROJECT_KEY,
      irreversible: true,
    });
    if (confirmed) {
      this.rows.update((rows) => rows.filter((r) => r.kind !== 'manual'));
      this.state.notice('redirects.deleted', { count });
    }
  }
}
