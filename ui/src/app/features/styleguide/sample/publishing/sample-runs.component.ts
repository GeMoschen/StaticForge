import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SfDataTableColumn, SfDataTableFilter } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfSpinnerComponent } from '../../../../shared/components/sf-spinner.component';
import type { ContextMenuItem } from '../../../../shared/services/context-menu.service';
import { minutesAgo } from '../changes/sample-area.util';
import { RUNS, RUN_STATUSES, SampleRun, TARGETS, findingCounts, isActiveRun, runById, targetById } from './publishing-data';
import { PublishingState } from './publishing-state';
import { RUN_STATUS_ICONS, RUN_STATUS_TONES, formatDuration } from './publishing-status';
import { SampleRunDetailComponent } from './sample-run-detail.component';

/**
 * Publishing › Runs: the run table (one line per cell; one run queued, one running) or, with a run open, its detail.
 * The bar holds the search and the Status, Mode, Target and Trigger filters (like Redirects). Every row has a ⋮ menu,
 * also opened by a right click: *Open*, *Live log* (queued or running), *Cancel* (queued or running; an editor only
 * for their own runs; confirms) and *Promote* (succeeded or partial, developers only; confirms). Nothing is saved.
 */
@Component({
  selector: 'sf-sample-runs',
  standalone: true,
  imports: [
    SampleRunDetailComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfMenuComponent,
    SfRelativeTimeComponent,
    SfSpinnerComponent,
    SfStatusComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-runs.component.html',
  styleUrl: './sample-runs.component.scss',
})
export class SampleRunsComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  protected readonly rows = RUNS;
  protected readonly tones = RUN_STATUS_TONES;
  protected readonly icons = RUN_STATUS_ICONS;
  private readonly now = Date.now();

  protected readonly openRun = computed(() => runById(this.state.runId()) ?? null);
  protected readonly rowKey = (row: SampleRun) => row.id;
  protected readonly rowLabel = (row: SampleRun) => this.t('runs.number', { n: row.number });

  protected readonly filters = computed<SfDataTableFilter<SampleRun>[]>(() => [
    {
      id: 'status',
      label: this.t('runs.columns.status'),
      options: RUN_STATUSES.map((v) => ({ value: v, label: this.t(`status.${v}`) })),
    },
    {
      id: 'mode',
      label: this.t('runs.columns.mode'),
      options: (['full', 'incremental'] as const).map((v) => ({ value: v, label: this.t(`mode.${v}`) })),
      match: (r, values) => values.includes(r.mode),
    },
    {
      id: 'target',
      label: this.t('runs.columns.target'),
      options: TARGETS.map((v) => ({ value: v.id, label: v.name })),
      match: (r, values) => values.includes(r.targetId),
    },
    {
      id: 'trigger',
      label: this.t('runs.columns.trigger'),
      options: (['manual', 'schedule', 'release'] as const).map((v) => ({ value: v, label: this.t(`trigger.${v}`) })),
      match: (r, values) => values.includes(r.trigger),
    },
  ]);

  /** The ⋮ menu of a row: what the viewer may do with the run. */
  protected rowActions(row: SampleRun): SfMenuItem[] {
    const items: SfMenuItem[] = [{ id: 'open', label: this.t('runs.actions.open'), icon: 'open_in_new', action: () => this.state.openRun(row.id) }];
    if (isActiveRun(row)) {
      items.push({ id: 'log', label: this.t('runs.actions.log'), icon: 'terminal', action: () => this.state.openRun(row.id, 'log') });
    }
    if (this.state.canPromote(row)) {
      items.push({ id: 'promote', label: this.t('runs.actions.promote'), icon: 'publish', action: () => void this.state.promoteRun(row) });
    }
    if (this.state.canCancel(row)) {
      items.push({ id: 'cancel', label: this.t('runs.actions.cancel'), icon: 'block', danger: true, separatorBefore: true, action: () => void this.state.cancelRun(row) });
    }
    return items;
  }

  /** A right click on a row: the same entries as its ⋮ menu. */
  protected readonly rowMenu = (rows: SampleRun[]): ContextMenuItem[] =>
    rows.length === 1
      ? this.rowActions(rows[0]).flatMap((item) => [
          ...(item.separatorBefore ? [{ label: '', separator: true }] : []),
          { label: item.label, icon: item.icon, danger: item.danger, action: item.action },
        ])
      : [];

  protected readonly columns = computed<SfDataTableColumn<SampleRun>[]>(() => {
    const h = (id: string) => this.t(`runs.columns.${id}`);
    return [
      { id: 'status', header: h('status'), value: (r) => r.status, width: 190, hideable: false },
      { id: 'mode', header: h('mode'), value: (r) => this.t(`mode.${r.mode}`), width: 130 },
      { id: 'target', header: h('target'), value: (r) => targetById(r.targetId)?.name ?? '', width: 140 },
      { id: 'trigger', header: h('trigger'), value: (r) => this.t(`trigger.${r.trigger}`), width: 130 },
      { id: 'started', header: h('started'), value: (r) => r.startedMinutes, sortable: true, width: 130 },
      { id: 'duration', header: h('duration'), value: (r) => r.durationSeconds ?? -1, sortable: true, width: 100, align: 'end' },
      { id: 'pages', header: h('pages'), value: (r) => r.pages, sortable: true, width: 80, align: 'end' },
      { id: 'findings', header: h('findings'), value: (r) => this.findingsText(r), width: 180 },
      { id: 'actions', header: h('actions'), hideable: false, searchable: false, width: 64, align: 'end' },
    ];
  });

  protected started(row: SampleRun): number {
    return minutesAgo(row.startedMinutes, this.now);
  }

  protected duration(row: SampleRun): string {
    return row.durationSeconds === null ? '' : formatDuration(row.durationSeconds);
  }

  protected findingsText(row: SampleRun): string {
    if (row.status === 'queued' || row.status === 'running' || row.planState === 'none') {
      return '—';
    }
    const { errors, warnings } = findingCounts(row);
    return errors + warnings === 0 ? this.t('runs.noFindings') : this.t('runs.findings', { errors, warnings });
  }

  protected hasErrors(row: SampleRun): boolean {
    return findingCounts(row).errors > 0;
  }
}
