import { ChangeDetectionStrategy, Component, OnInit, computed, input, output, signal } from '@angular/core';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfDateInputComponent } from '../../../../shared/components/forms/sf-date-input.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { injectSampleText } from '../changes/sample-area.util';

/**
 * The custom date range of the History filter (M35.9 review round 2): two dates, either may stay empty (open end).
 * *Apply* needs at least one date and From not after To; the dialog says so instead of just disabling the button.
 */
@Component({
  selector: 'sf-sample-history-range-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDateInputComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sf-dialog size="sm" [title]="t('range.title')" (closed)="closed.emit()">
      <p class="rr__lead">{{ t('range.lead') }}</p>
      <div class="rr__row">
        <sf-field [label]="t('range.from')">
          <sf-date-input [value]="from()" [max]="to()" (valueChange)="from.set($event)" />
        </sf-field>
        <sf-field [label]="t('range.to')" [error]="problem()">
          <sf-date-input [value]="to()" [min]="from()" (valueChange)="to.set($event)" />
        </sf-field>
      </div>
      <ng-container sfDialogFooter>
        <sf-button variant="secondary" (click)="closed.emit()">{{ t('range.cancel') }}</sf-button>
        <sf-button [disabled]="!valid()" (click)="applied.emit({ from: from(), to: to() })">{{ t('range.apply') }}</sf-button>
      </ng-container>
    </sf-dialog>
  `,
  styles: `
    .rr__lead {
      margin: 0 0 var(--sf-space-3);
      color: var(--sf-text-muted);
    }
    .rr__row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--sf-space-3);
    }
  `,
})
export class SampleHistoryRangeDialogComponent implements OnInit {
  /** The range being edited. */
  readonly initialFrom = input<string | null>(null, { alias: 'from' });
  readonly initialTo = input<string | null>(null, { alias: 'to' });
  readonly applied = output<{ readonly from: string | null; readonly to: string | null }>();
  readonly closed = output<void>();

  protected readonly t = injectSampleText('styleguide.sample.history');
  protected readonly from = signal<string | null>(null);
  protected readonly to = signal<string | null>(null);

  /** Only a wrong order is an error; "pick a date" is what the disabled Apply button already says. */
  protected readonly problem = computed(() => (this.from() && this.to() && this.from()! > this.to()! ? this.t('range.order') : null));
  protected readonly valid = computed(() => (this.from() !== null || this.to() !== null) && this.problem() === null);

  ngOnInit(): void {
    this.from.set(this.initialFrom());
    this.to.set(this.initialTo());
  }
}
