import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfTab, SfTabsComponent } from '../../../../shared/components/sf-tabs.component';
import { minutesAgo } from '../changes/sample-area.util';
import { RebuiltPage, SampleRun, findingCounts, pageById, targetById } from './publishing-data';
import { PublishingState } from './publishing-state';
import { RUN_STATUS_ICONS, RUN_STATUS_TONES, formatDuration } from './publishing-status';
import { SampleRunLogComponent } from './sample-run-log.component';

export type RunTab = 'summary' | 'rebuilt' | 'findings' | 'log';

interface RebuiltRow extends RebuiltPage {
  readonly key: string;
  readonly name: string;
  readonly path: string;
}

/**
 * A run's detail: a summary header (status, counts, duration), then `sf-tabs` Summary | Rebuilt | Findings | Log.
 * Findings are grouped by code with a count, name their pages (links) and say how to fix them. The running run opens
 * on its Log, which follows the tail.
 */
@Component({
  selector: 'sf-sample-run-detail',
  standalone: true,
  imports: [
    SampleRunLogComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    SfTabsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-run-detail.component.html',
  styleUrl: './sample-run-detail.component.scss',
})
export class SampleRunDetailComponent {
  readonly run = input.required<SampleRun>();

  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  protected readonly tones = RUN_STATUS_TONES;
  protected readonly icons = RUN_STATUS_ICONS;
  private readonly now = Date.now();

  private readonly picked = signal<RunTab | null>(null);
  /** The chosen tab; by default Log for a running run, else Summary. */
  protected readonly tab = computed<RunTab>(() => this.picked() ?? (this.run().status === 'running' ? 'log' : 'summary'));

  protected readonly counts = computed(() => findingCounts(this.run()));
  protected readonly target = computed(() => targetById(this.run().targetId));
  protected readonly started = computed(() => minutesAgo(this.run().startedMinutes, this.now));
  protected readonly duration = computed(() => {
    const seconds = this.run().durationSeconds;
    return seconds === null ? this.t('runs.inProgress') : formatDuration(seconds);
  });

  protected readonly tabs = computed<SfTab[]>(() => {
    const counts = this.counts();
    return [
      { id: 'summary', label: this.t('detail.tabs.summary') },
      { id: 'rebuilt', label: this.t('detail.tabs.rebuilt') },
      { id: 'findings', label: this.t('detail.tabs.findings'), errors: counts.errors || undefined },
      { id: 'log', label: this.t('detail.tabs.log') },
    ];
  });

  protected readonly findings = computed(() =>
    this.run().findings.map((f) => ({
      ...f,
      pages: f.pages.map((p) => ({ ...p, name: pageById(p.pageId)?.name ?? p.pageId, path: pageById(p.pageId)?.path ?? '' })),
    })),
  );

  protected readonly rebuiltRows = computed<RebuiltRow[]>(() =>
    this.run().rebuilt.map((r) => ({
      ...r,
      key: `${r.pageId}-${r.lang}`,
      name: pageById(r.pageId)?.name ?? r.pageId,
      path: `/${r.lang.toLowerCase()}${pageById(r.pageId)?.path ?? ''}`,
    })),
  );

  protected readonly rebuiltColumns = computed<SfDataTableColumn<RebuiltRow>[]>(() => {
    const h = (id: string) => this.t(`detail.rebuiltColumns.${id}`);
    const columns: SfDataTableColumn<RebuiltRow>[] = [
      { id: 'name', header: h('page'), value: (r) => r.name, sortable: true, hideable: false, width: 240 },
      { id: 'lang', header: h('lang'), value: (r) => r.lang, sortable: true, width: 100 },
      { id: 'reason', header: h('reason'), value: (r) => r.reason, sortable: true, width: 160 },
    ];
    if (this.state.devMode()) {
      columns.push({ id: 'path', header: h('path'), value: (r) => r.path, width: 260 });
    }
    return columns;
  });
  protected readonly rebuiltKey = (row: RebuiltRow) => row.key;

  protected selectTab(id: string): void {
    this.picked.set(id as RunTab);
  }

  protected openPage(): void {
    this.state.notice('detail.openNotice');
  }
}
