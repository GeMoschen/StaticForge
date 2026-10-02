import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfFileSizePipe } from '../../shared/pipes/sf-file-size.pipe';
import {
  AdminJobRunView,
  OUTCOME_ICONS,
  OUTCOME_TONES,
  reportError,
  reportExtras,
  runDuration,
  sampleTable,
} from './admin-jobs.util';

/**
 * A system job run's report (M29.5.1, M35.16): outcome, counters, bytes and the bounded sample as a table. A dry run says
 * what a real run *would* remove. Used for the run the page started and inside the history row's report dialog.
 */
@Component({
  selector: 'sf-admin-job-run-report',
  standalone: true,
  imports: [JsonPipe, SfBadgeComponent, SfBannerComponent, SfFileSizePipe, SfStatusComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin-job-run-report.component.scss',
  template: `
    @let r = run();
    <div class="report">
      <p class="report__head">
        <sf-status size="sm" [tone]="tones[r.outcome ?? '']" [icon]="icons[r.outcome ?? '']" [label]="outcome()" />
        @if (r.dryRun) {
          <sf-badge tone="info" [label]="'admin.jobs.report.dryRunNote' | transloco" />
        }
        <span>{{ trigger() }} · {{ 'admin.jobs.report.took' | transloco: { duration: runDuration(r.durationMs) } }}</span>
      </p>
      @if (r.message) {
        <p class="report__message">{{ r.message }}</p>
      }
      @if (error(); as e) {
        <sf-banner tone="danger">{{ e }}</sf-banner>
      }
      <dl class="report__counts">
        <div>
          <dt>{{ 'admin.jobs.report.examined' | transloco }}</dt>
          <dd>{{ r.itemsExamined ?? 0 }}</dd>
        </div>
        <div>
          <dt>{{ (r.dryRun ? 'admin.jobs.report.wouldAffect' : 'admin.jobs.report.affected') | transloco }}</dt>
          <dd>{{ r.itemsAffected ?? 0 }}</dd>
        </div>
        <div>
          <dt>{{ (r.dryRun ? 'admin.jobs.report.wouldFree' : 'admin.jobs.report.freed') | transloco }}</dt>
          <dd>{{ r.bytesFreed ?? 0 | sfFileSize }}</dd>
        </div>
      </dl>
      @if (table().rows.length > 0) {
        <div class="report__scroll">
          <table class="report__table">
            <caption class="report__caption">
              {{ (r.dryRun ? 'admin.jobs.report.wouldRemove' : 'admin.jobs.report.sample') | transloco }} —
              {{ 'admin.jobs.report.showing' | transloco: { shown: table().rows.length, total: r.sampleTotal ?? table().rows.length } }}
            </caption>
            <thead>
              <tr>
                @for (column of table().columns; track column) {
                  <th scope="col">{{ column }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of table().rows; track $index) {
                <tr>
                  @for (cell of row; track $index) {
                    <td>{{ cell }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (r.finishedAt) {
        <p class="report__head">{{ 'admin.jobs.report.noSample' | transloco }}</p>
      }
      @if (extras(); as x) {
        <details class="report__extras">
          <summary>{{ 'admin.jobs.report.details' | transloco }}</summary>
          <pre>{{ x | json }}</pre>
        </details>
      }
    </div>
  `,
})
export class AdminJobRunReportComponent {
  readonly run = input.required<AdminJobRunView>();

  private readonly transloco = inject(TranslocoService);

  protected readonly tones = OUTCOME_TONES;
  protected readonly icons = OUTCOME_ICONS;
  protected readonly runDuration = runDuration;

  protected readonly table = computed(() => sampleTable(this.run().sample));
  protected readonly extras = computed(() => reportExtras(this.run().report));
  protected readonly error = computed(() => reportError(this.run().report));
  protected readonly outcome = computed(() => this.transloco.translate(`enum.jobState.${this.run().outcome ?? 'RUNNING'}`));
  protected readonly trigger = computed(() => {
    const trigger = this.run().trigger;
    return trigger ? this.transloco.translate(`enum.jobTrigger.${trigger}`) : '';
  });
}
