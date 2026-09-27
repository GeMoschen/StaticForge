import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SfFileSizePipe } from '../../shared/pipes/sf-file-size.pipe';
import {
  AdminJobRunView,
  outcomeChipClass,
  outcomeLabel,
  reportError,
  reportExtras,
  runDuration,
  sampleTable,
  triggerLabel,
} from './admin-jobs.util';

/**
 * A system job run's report (M29.5.1): outcome, counters, bytes and the bounded sample as a table. A dry run says what
 * a real run *would* remove. Used for the run the page started and for an expanded history row.
 */
@Component({
  selector: 'sf-admin-job-run-report',
  standalone: true,
  imports: [JsonPipe, SfFileSizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = run();
    <div class="report">
      <p class="report__head">
        <span [class]="outcomeChipClass(r.outcome)">{{ outcomeLabel(r.outcome) }}</span>
        @if (r.dryRun) {
          <span class="chip chip--signal">Dry run — nothing was changed</span>
        }
        <span class="muted">{{ triggerLabel(r.trigger) }} · took {{ runDuration(r.durationMs) }}</span>
      </p>
      @if (r.message) {
        <p class="report__message">{{ r.message }}</p>
      }
      @if (error(); as e) {
        <p class="error">{{ e }}</p>
      }
      <dl class="report__counts">
        <div>
          <dt>Examined</dt>
          <dd>{{ r.itemsExamined ?? 0 }}</dd>
        </div>
        <div>
          <dt>{{ r.dryRun ? 'Would affect' : 'Affected' }}</dt>
          <dd>{{ r.itemsAffected ?? 0 }}</dd>
        </div>
        <div>
          <dt>{{ r.dryRun ? 'Would free' : 'Freed' }}</dt>
          <dd>{{ (r.bytesFreed ?? 0) | sfFileSize }}</dd>
        </div>
      </dl>
      @if (table().rows.length > 0) {
        <div class="table sf-table-wrap">
          <table>
            <caption class="report__caption">
              {{ r.dryRun ? 'Would remove' : 'Sample' }} — showing {{ table().rows.length }} of {{ r.sampleTotal ?? table().rows.length }}
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
                    <td class="mono">{{ cell }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (r.finishedAt) {
        <p class="muted">No items in the sample.</p>
      }
      @if (extras(); as x) {
        <details class="report__extras">
          <summary>Report details</summary>
          <pre>{{ x | json }}</pre>
        </details>
      }
    </div>
  `,
  styleUrl: './admin-job-run-report.component.scss',
})
export class AdminJobRunReportComponent {
  readonly run = input.required<AdminJobRunView>();

  protected readonly outcomeLabel = outcomeLabel;
  protected readonly outcomeChipClass = outcomeChipClass;
  protected readonly triggerLabel = triggerLabel;
  protected readonly runDuration = runDuration;

  protected readonly table = computed(() => sampleTable(this.run().sample));
  protected readonly extras = computed(() => reportExtras(this.run().report));
  protected readonly error = computed(() => reportError(this.run().report));
}
