import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfSpinnerComponent } from '../../../../shared/components/sf-spinner.component';
import { minutesAgo } from '../changes/sample-area.util';
import { RUNS, SampleRun, findingCounts, runById, targetById } from './publishing-data';
import { PublishingState } from './publishing-state';
import { RUN_STATUS_ICONS, RUN_STATUS_TONES, formatDuration } from './publishing-status';
import { SampleRunDetailComponent } from './sample-run-detail.component';

/** Publishing › Runs: the run table (one line per cell; one run still running) or, with a run open, its detail. */
@Component({
  selector: 'sf-sample-runs',
  standalone: true,
  imports: [
    SampleRunDetailComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
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
    ];
  });

  protected started(row: SampleRun): number {
    return minutesAgo(row.startedMinutes, this.now);
  }

  protected duration(row: SampleRun): string {
    return row.durationSeconds === null ? '' : formatDuration(row.durationSeconds);
  }

  protected findingsText(row: SampleRun): string {
    if (row.status === 'running' || row.status === 'failed') {
      return '—';
    }
    const { errors, warnings } = findingCounts(row);
    return errors + warnings === 0 ? this.t('runs.noFindings') : this.t('runs.findings', { errors, warnings });
  }

  protected hasErrors(row: SampleRun): boolean {
    return findingCounts(row).errors > 0;
  }
}
