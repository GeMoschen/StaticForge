import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { I18nFormatService } from '../../../core/i18n/i18n-format.service';
import { SfButtonComponent } from '../sf-button.component';
import { sfUniqueId } from './sf-field-context';
import {
  Day,
  addDays,
  addMonths,
  clampDay,
  compareDays,
  monthWeeks,
  parseIsoDate,
  sameDay,
  toIsoDate,
  today,
  weekStartOf,
  weekday,
} from './date-time.util';

/**
 * A month calendar (M35.6), the grid of the date picker: WAI-ARIA date-picker grid with one tab stop.
 *
 * Keys on the grid: `←`/`→` a day, `↑`/`↓` a week, `Home`/`End` the start/end of the week, `PageUp`/`PageDown` a month,
 * `Shift+PageUp`/`Shift+PageDown` a year, `Enter`/`Space` pick. Days outside `min`/`max` are shown but `aria-disabled`
 * and never focused. Week start, month and day names follow the UI locale. Values are ISO `yyyy-MM-dd`.
 */
@Component({
  selector: 'sf-calendar',
  standalone: true,
  imports: [SfButtonComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-calendar.component.scss',
  template: `
    <div class="sf-calendar__header">
      <sf-button
        variant="ghost"
        size="sm"
        icon="keyboard_double_arrow_left"
        [label]="'shared.datePicker.previousYear' | transloco"
        [disabled]="!canMove(-12)"
        (click)="moveMonths(-12)"
      />
      <sf-button
        variant="ghost"
        size="sm"
        icon="chevron_left"
        [label]="'shared.datePicker.previousMonth' | transloco"
        [disabled]="!canMove(-1)"
        (click)="moveMonths(-1)"
      />
      <h2 class="sf-calendar__title" [id]="titleId" aria-live="polite">{{ title() }}</h2>
      <sf-button
        variant="ghost"
        size="sm"
        icon="chevron_right"
        [label]="'shared.datePicker.nextMonth' | transloco"
        [disabled]="!canMove(1)"
        (click)="moveMonths(1)"
      />
      <sf-button
        variant="ghost"
        size="sm"
        icon="keyboard_double_arrow_right"
        [label]="'shared.datePicker.nextYear' | transloco"
        [disabled]="!canMove(12)"
        (click)="moveMonths(12)"
      />
    </div>
    <table class="sf-calendar__grid" role="grid" [attr.aria-labelledby]="titleId" (keydown)="onKeydown($event)">
      <thead>
        <tr>
          @for (name of weekdayNames(); track name.long) {
            <th scope="col" class="sf-calendar__weekday" [attr.abbr]="name.long">{{ name.short }}</th>
          }
        </tr>
      </thead>
      <tbody>
        @for (week of weeks(); track $index) {
          <tr>
            @for (day of week; track day.day + '-' + day.month) {
              <td
                role="gridcell"
                class="sf-calendar__day"
                [class.is-outside]="day.month !== focused().month"
                [class.is-today]="isToday(day)"
                [class.is-selected]="isSelected(day)"
                [attr.data-day]="iso(day)"
                [attr.tabindex]="isFocused(day) ? 0 : -1"
                [attr.aria-selected]="isSelected(day)"
                [attr.aria-current]="isToday(day) ? 'date' : null"
                [attr.aria-disabled]="isOutOfRange(day) || null"
                [attr.aria-label]="fullLabel(day)"
                (click)="pick(day)"
              >
                {{ day.day }}
              </td>
            }
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class SfCalendarComponent {
  /** The selected day, `yyyy-MM-dd`. */
  readonly value = input<string | null>(null);
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);

  /** The user picked a day (`yyyy-MM-dd`). */
  readonly picked = output<string>();

  private readonly format = inject(I18nFormatService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changeDetector = inject(ChangeDetectorRef);

  protected readonly titleId = sfUniqueId('sf-calendar-title');
  private readonly minDay = computed(() => parseIsoDate(this.min()));
  private readonly maxDay = computed(() => parseIsoDate(this.max()));
  private readonly selected = computed(() => parseIsoDate(this.value()));
  private readonly todayDay = signal(today());

  /** Where the user moved the tab stop, for the value it was moved under (a new value starts over). */
  private readonly moved = signal<{ value: string | null; day: Day } | null>(null);
  /** The day with the grid's tab stop — the moved one, else the selected day or today, within the range. Its month is
   * the one shown. */
  protected readonly focused = computed(() => {
    const moved = this.moved();
    if (moved && moved.value === this.value()) {
      return moved.day;
    }
    return clampDay(this.selected() ?? this.todayDay(), this.minDay(), this.maxDay());
  });

  protected readonly weeks = computed(() =>
    monthWeeks(this.focused().year, this.focused().month, weekStartOf(this.format.locale())),
  );
  protected readonly title = computed(() => {
    const { year, month } = this.focused();
    return new Intl.DateTimeFormat(this.format.locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      Date.UTC(year, month - 1, 1),
    );
  });
  protected readonly weekdayNames = computed(() => {
    const locale = this.format.locale();
    const short = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    const long = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
    return this.weeks()[0].map((day) => {
      const date = Date.UTC(day.year, day.month - 1, day.day);
      return { short: short.format(date), long: long.format(date) };
    });
  });
  private readonly labelFormat = computed(
    () => new Intl.DateTimeFormat(this.format.locale(), { dateStyle: 'full', timeZone: 'UTC' }),
  );

  /** Puts the keyboard focus on the grid's current day. */
  focusGrid(): void {
    this.changeDetector.detectChanges();
    this.host.nativeElement.querySelector<HTMLElement>('td[tabindex="0"]')?.focus();
  }

  protected iso(day: Day): string {
    return toIsoDate(day);
  }

  protected fullLabel(day: Day): string {
    return this.labelFormat().format(Date.UTC(day.year, day.month - 1, day.day));
  }

  protected isFocused(day: Day): boolean {
    return sameDay(day, this.focused());
  }

  protected isSelected(day: Day): boolean {
    return sameDay(day, this.selected());
  }

  protected isToday(day: Day): boolean {
    return sameDay(day, this.todayDay());
  }

  protected isOutOfRange(day: Day): boolean {
    const min = this.minDay();
    const max = this.maxDay();
    return (!!min && compareDays(day, min) < 0) || (!!max && compareDays(day, max) > 0);
  }

  /** Whether moving `months` still reaches a day inside the range. */
  protected canMove(months: number): boolean {
    const target = monthIndex(addMonths(this.focused(), months));
    const min = this.minDay();
    const max = this.maxDay();
    return !(min && target < monthIndex(min)) && !(max && target > monthIndex(max));
  }

  protected moveMonths(months: number): void {
    this.moveTo(clampDay(addMonths(this.focused(), months), this.minDay(), this.maxDay()));
  }

  protected pick(day: Day): void {
    if (!this.isOutOfRange(day)) {
      this.moveTo(day);
      this.picked.emit(toIsoDate(day));
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const current = this.focused();
    let next: Day;
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(current, -1);
        break;
      case 'ArrowRight':
        next = addDays(current, 1);
        break;
      case 'ArrowUp':
        next = addDays(current, -7);
        break;
      case 'ArrowDown':
        next = addDays(current, 7);
        break;
      case 'Home':
        next = addDays(current, -((weekday(current) - weekStartOf(this.format.locale()) + 7) % 7));
        break;
      case 'End':
        next = addDays(current, 6 - ((weekday(current) - weekStartOf(this.format.locale()) + 7) % 7));
        break;
      case 'PageUp':
        next = addMonths(current, event.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = addMonths(current, event.shiftKey ? 12 : 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.pick(current);
        return;
      default:
        return;
    }
    event.preventDefault();
    this.moveTo(clampDay(next, this.minDay(), this.maxDay()));
    this.focusGrid();
  }

  private moveTo(day: Day): void {
    this.moved.set({ value: this.value(), day });
  }
}

function monthIndex(day: Day): number {
  return day.year * 12 + day.month;
}
