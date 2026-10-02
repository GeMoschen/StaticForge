import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { SfDialogComponent, SfDialogFooterDirective } from '../../shared/components/dialog/sf-dialog.component';
import { SfDateInputComponent } from '../../shared/components/forms/sf-date-input.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';

/**
 * The custom date range of the History filter (M35.12): two dates, either may stay empty (open end). *Apply* needs at
 * least one date and From not after To; a wrong order is said, a missing date is what the disabled button shows.
 * `prefix` is where its texts live (`history` in the app, the style guide's own in the sample).
 */
@Component({
  selector: 'sf-history-range-dialog',
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
export class HistoryRangeDialogComponent implements OnInit {
  /** The range being edited. */
  readonly initialFrom = input<string | null>(null, { alias: 'from' });
  readonly initialTo = input<string | null>(null, { alias: 'to' });
  /** Where the texts live. */
  readonly prefix = input('history');
  readonly applied = output<{ readonly from: string | null; readonly to: string | null }>();
  readonly closed = output<void>();

  private readonly transloco = inject(TranslocoService);
  protected readonly from = signal<string | null>(null);
  protected readonly to = signal<string | null>(null);

  /** Only a wrong order is an error; "pick a date" is what the disabled Apply button already says. */
  protected readonly problem = computed(() => (this.from() && this.to() && this.from()! > this.to()! ? this.t('range.order') : null));
  protected readonly valid = computed(() => (this.from() !== null || this.to() !== null) && this.problem() === null);

  ngOnInit(): void {
    this.from.set(this.initialFrom());
    this.to.set(this.initialTo());
  }

  protected t(key: string): string {
    return this.transloco.translate(`${this.prefix()}.${key}`);
  }
}
