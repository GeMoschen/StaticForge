import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { findingCountsLabel, severityCountLabel, type FindingCountsView, type FindingSeverity } from './findings.util';

/**
 * A run's findings in the run list (M30.6.2): an error chip (only when there are errors) and a warnings chip, each
 * opening the run's findings of that severity; "No findings" when the checks found nothing. Separate from the run's
 * diagnostics counts, which count template and file problems.
 */
@Component({
  selector: 'sf-finding-counts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let totals = counts();
    <span class="counts" [attr.aria-label]="'Findings: ' + summary()">
      @if ((totals.errors ?? 0) > 0) {
        <button type="button" class="chip chip--error" (click)="pick.emit('ERROR')">
          {{ label(totals.errors, 'ERROR') }}
        </button>
      }
      @if ((totals.warnings ?? 0) > 0) {
        <button type="button" class="chip chip--warning" (click)="pick.emit('WARNING')">
          {{ label(totals.warnings, 'WARNING') }}
        </button>
      }
      @if ((totals.errors ?? 0) === 0 && (totals.warnings ?? 0) === 0) {
        <span class="chip chip--clean">No findings</span>
      }
    </span>
  `,
  styles: [
    `
      .counts {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--sf-1);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        padding: 0 var(--sf-2);
        border: none;
        border-radius: var(--sf-radius-sm);
        font: inherit;
        font-size: var(--sf-text-xs);
        line-height: 1.5;
        white-space: nowrap;
      }
      button.chip {
        cursor: pointer;
      }
      .chip--error {
        background: color-mix(in srgb, var(--sf-rust) 14%, transparent);
        color: var(--sf-rust);
      }
      .chip--warning {
        background: color-mix(in srgb, var(--sf-amber) 18%, transparent);
        color: var(--sf-amber);
      }
      .chip--clean {
        background: color-mix(in srgb, var(--sf-jade) 16%, transparent);
        color: var(--sf-jade);
      }
    `,
  ],
})
export class SfFindingCountsComponent {
  readonly counts = input.required<FindingCountsView>();
  /** A chip was clicked: show the run's findings of that severity. */
  readonly pick = output<FindingSeverity>();

  protected readonly summary = computed(() => findingCountsLabel(this.counts()));
  protected readonly label = severityCountLabel;
}
