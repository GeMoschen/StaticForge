import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  model,
  numberAttribute,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { I18nFormatService, SF_HOUR_CYCLE } from '../../../core/i18n/i18n-format.service';
import { anchorPanel } from '../../overlay/anchored-position';
import { SfButtonComponent } from '../sf-button.component';
import { SfIconComponent } from '../sf-icon.component';
import { SfCalendarComponent } from './sf-calendar.component';
import { SfControlBase, joinIds, provideSfControl } from './sf-control';
import { sfUniqueId } from './sf-field-context';
import {
  datePattern,
  formatDay,
  formatTime,
  parseIsoDate,
  parseIsoTime,
  parseTypedDate,
  parseTypedTime,
  toIsoDate,
  toIsoTime,
  today,
  uses12HourClock,
} from './date-time.util';

export type SfDateInputMode = 'date' | 'time' | 'datetime';

/**
 * A date, time or date-and-time field (M35.6) with its own picker — no native browser picker.
 *
 * - **Date:** typed in the UI locale's own order (`31.12.2026`, `12/31/2026`; ISO always works), or picked in a
 *   calendar dialog (button, or `Alt+↓` in the field) with `Today` and `Clear`. The dialog is modal: `Tab` stays inside,
 *   `Escape` closes it and returns focus to the button.
 * - **Time:** typed (`14:30`, `2:30 pm`, `1430`) on the locale's clock, or picked from a list (`↓`/`↑` open and move,
 *   `Enter` picks, `Escape` closes) in `minuteStep` steps.
 * - **Value:** `yyyy-MM-dd`, `HH:mm` or `yyyy-MM-ddTHH:mm` (local, no zone), like the API. `null` while empty,
 *   incomplete, unreadable or outside `min`/`max` (same formats); then the part in question is `aria-invalid`.
 *
 * Typed text is only reformatted on blur, never while the user types. A format hint describes each field.
 */
@Component({
  selector: 'sf-date-input',
  standalone: true,
  imports: [SfButtonComponent, SfCalendarComponent, SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-date-input.component.html',
  styleUrl: './sf-date-input.component.scss',
  providers: [provideSfControl(() => SfDateInputComponent)],
})
export class SfDateInputComponent extends SfControlBase<string | null> implements OnDestroy {
  readonly value = model<string | null>(null);
  readonly mode = input<SfDateInputMode>('date');
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  /** Spacing of the times in the time list, in minutes. */
  readonly minuteStep = input(30, { transform: numberAttribute });

  private readonly format = inject(I18nFormatService);
  private readonly hourCycle = inject(SF_HOUR_CYCLE);
  private readonly document = inject(DOCUMENT);
  private readonly changeDetector = inject(ChangeDetectorRef);

  private readonly shell = viewChild.required<ElementRef<HTMLElement>>('shell');
  private readonly dateInput = viewChild<ElementRef<HTMLInputElement>>('dateInput');
  private readonly timeInput = viewChild<ElementRef<HTMLInputElement>>('timeInput');
  private readonly calendarButton = viewChild<SfButtonComponent>('calendarButton');
  private readonly calendarPanel = viewChild<ElementRef<HTMLElement>>('calendarPanel');
  private readonly calendar = viewChild(SfCalendarComponent);
  private readonly timesPanel = viewChild<ElementRef<HTMLElement>>('timesPanel');

  protected readonly ids = {
    dateHint: sfUniqueId('sf-date-hint'),
    timeHint: sfUniqueId('sf-time-hint'),
    time: sfUniqueId('sf-time'),
    timeWord: sfUniqueId('sf-time-word'),
    ownLabel: sfUniqueId('sf-date-label'),
    dialog: sfUniqueId('sf-date-dialog'),
    times: sfUniqueId('sf-times'),
  };

  protected readonly hasDate = computed(() => this.mode() !== 'time');
  protected readonly hasTime = computed(() => this.mode() !== 'date');
  protected readonly pattern = computed(() => datePattern(this.format.locale()));
  private readonly twelveHour = computed(() => {
    const cycle = this.hourCycle();
    return cycle === 'auto' ? uses12HourClock(this.format.locale()) : cycle === 'h12';
  });
  protected readonly timeExample = computed(() => formatTime(14 * 60 + 30, this.twelveHour()));
  /** Placeholders show the pattern (`MM/DD/YYYY`, `hh:mm`), never a date that could pass for a value. */
  protected readonly datePlaceholder = computed(() => {
    this.format.lang();
    const { order, separator } = this.pattern();
    return order.map((part) => this.format.translate(`shared.datePicker.placeholder.${part}`)).join(separator);
  });
  protected readonly timePlaceholder = computed(() => {
    this.format.lang();
    return this.format.translate(`shared.datePicker.placeholder.${this.twelveHour() ? 'time12' : 'time24'}`);
  });

  protected readonly dateText = signal('');
  protected readonly timeText = signal('');

  private readonly datePart = computed(() => {
    const day = parseTypedDate(this.dateText(), this.pattern());
    return day ? toIsoDate(day) : null;
  });
  private readonly timePart = computed(() => {
    const minutes = parseTypedTime(this.timeText());
    return minutes === null ? null : toIsoTime(minutes);
  });
  /** The value the texts stand for (range not yet applied). */
  private readonly composed = computed(() => {
    const date = this.datePart();
    const time = this.timePart();
    switch (this.mode()) {
      case 'date':
        return date;
      case 'time':
        return time;
      default:
        return date && time ? `${date}T${time}` : null;
    }
  });
  private readonly outOfRange = computed(() => {
    const value = this.composed();
    const min = this.min();
    const max = this.max();
    return !!value && ((!!min && value < min) || (!!max && value > max));
  });
  protected readonly dateInvalid = computed(
    () => this.isInvalid() || (!!this.dateText().trim() && !this.datePart()) || (this.outOfRange() && this.hasDate()),
  );
  protected readonly timeInvalid = computed(
    () =>
      this.isInvalid() || (!!this.timeText().trim() && !this.timePart()) || (this.outOfRange() && !this.hasDate()),
  );

  /** `aria-labelledby` of the time field next to a date: the control's label plus "Time". */
  protected readonly timeLabelledBy = computed(() => {
    const base = this.ariaLabelledBy() ?? this.field?.labelId ?? (this.ariaLabel() ? this.ids.ownLabel : null);
    return joinIds(base, this.ids.timeWord);
  });
  protected readonly dateDescribedBy = computed(() => joinIds(this.describedBy(), this.ids.dateHint));
  protected readonly timeDescribedBy = computed(() => joinIds(this.describedBy(), this.ids.timeHint));
  protected readonly blocked = computed(() => this.isDisabled() || this.readonly());

  // ── Popups ────────────────────────────────────────────────────────────────────
  protected readonly calendarOpen = signal(false);
  protected readonly timesOpen = signal(false);
  protected readonly activeTime = signal(-1);
  protected readonly calendarValue = computed(() => this.datePart());
  protected readonly calendarMin = computed(() => this.min()?.slice(0, 10) ?? null);
  protected readonly calendarMax = computed(() => this.max()?.slice(0, 10) ?? null);
  protected readonly timeOptions = computed(() => {
    const step = Math.max(1, Math.min(this.minuteStep(), 720));
    const twelveHour = this.twelveHour();
    const min = this.mode() === 'time' ? parseIsoTime(this.min()) : null;
    const max = this.mode() === 'time' ? parseIsoTime(this.max()) : null;
    const options: { minutes: number; label: string; id: string }[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += step) {
      if ((min === null || minutes >= min) && (max === null || minutes <= max)) {
        options.push({ minutes, label: formatTime(minutes, twelveHour), id: `${this.ids.times}-${minutes}` });
      }
    }
    return options;
  });
  protected readonly selectedMinutes = computed(() => parseIsoTime(this.timePart()));

  private stopAnchor: (() => void) | null = null;
  private readonly onDocumentPointerDown = (event: Event) => {
    const target = event.target as Node | null;
    const inside =
      !!target &&
      (this.shell().nativeElement.contains(target) ||
        !!this.calendarPanel()?.nativeElement.contains(target) ||
        !!this.timesPanel()?.nativeElement.contains(target));
    if (!inside) {
      this.closePopups(false);
    }
  };

  constructor() {
    super();
    // A value set from outside (two-way binding, not a form) rewrites the texts; the user's own typing never does,
    // because then the value already is what the texts stand for.
    effect(
      () => {
        const value = this.value();
        untracked(() => {
          if (value !== this.rangedComposed()) {
            this.showValue(value);
          }
        });
      },
      { allowSignalWrites: true },
    );
    // A control that gets disabled or read-only closes its popups.
    effect(
      () => {
        if (this.blocked()) {
          untracked(() => this.closePopups(false));
        }
      },
      { allowSignalWrites: true },
    );
  }

  focus(): void {
    (this.dateInput() ?? this.timeInput())?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    this.closePopups(false);
  }

  protected writeModel(value: string | null | undefined): void {
    this.value.set(value || null);
    // A form write (reset, patch) also replaces half-typed or invalid text.
    this.showValue(value || null);
  }

  protected onDateInput(event: Event): void {
    this.dateText.set((event.target as HTMLInputElement).value);
    this.commit();
  }

  protected onTimeInput(event: Event): void {
    this.timeText.set((event.target as HTMLInputElement).value);
    this.commit();
    if (this.timesOpen()) {
      this.activeTime.set(this.nearestTimeIndex());
      this.scrollActiveTimeIntoView();
    }
  }

  /** Blur: tidy a valid text into the canonical format. */
  protected onDateBlur(): void {
    const day = parseIsoDate(this.datePart());
    if (day) {
      this.dateText.set(formatDay(day, this.pattern()));
    }
    this.markTouched();
  }

  protected onTimeBlur(): void {
    const minutes = parseIsoTime(this.timePart());
    if (minutes !== null) {
      this.timeText.set(formatTime(minutes, this.twelveHour()));
    }
    this.markTouched();
  }

  protected onDateKeydown(event: KeyboardEvent): void {
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      this.openCalendar();
    }
  }

  // ── Calendar dialog ──────────────────────────────────────────────────────────

  protected toggleCalendar(): void {
    if (this.calendarOpen()) {
      this.closeCalendar(true);
    } else {
      this.openCalendar();
    }
  }

  openCalendar(): void {
    if (this.blocked() || this.calendarOpen()) {
      return;
    }
    this.closeTimes();
    this.calendarOpen.set(true);
    this.changeDetector.detectChanges();
    const panel = this.calendarPanel()?.nativeElement;
    if (panel) {
      this.stopAnchor = anchorPanel(this.shell().nativeElement, panel, { align: 'start' });
    }
    this.calendar()?.focusGrid();
    this.document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
  }

  protected pickDate(iso: string): void {
    this.dateText.set(formatDay(parseIsoDate(iso)!, this.pattern()));
    this.commit();
    this.closeCalendar(true);
  }

  protected pickToday(): void {
    this.pickDate(toIsoDate(today()));
  }

  protected clearDate(): void {
    this.dateText.set('');
    this.commit();
    this.closeCalendar(true);
  }

  protected todayInRange(): boolean {
    const iso = toIsoDate(today());
    const min = this.calendarMin();
    const max = this.calendarMax();
    return !(min && iso < min) && !(max && iso > max);
  }

  /** Keys inside the modal dialog: `Escape` closes it, `Tab` cycles through its controls. */
  protected onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeCalendar(true);
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const panel = this.calendarPanel()?.nativeElement;
    const stops = Array.from(panel?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? []);
    if (!stops.length) {
      return;
    }
    const index = stops.indexOf(this.document.activeElement as HTMLElement);
    const step = event.shiftKey ? -1 : 1;
    event.preventDefault();
    stops[(index + step + stops.length) % stops.length].focus();
  }

  private closeCalendar(restoreFocus: boolean): void {
    if (!this.calendarOpen()) {
      return;
    }
    this.calendarOpen.set(false);
    this.unanchor();
    if (restoreFocus) {
      this.calendarButton()?.focus();
    }
  }

  // ── Time list ────────────────────────────────────────────────────────────────

  protected toggleTimes(): void {
    if (this.timesOpen()) {
      this.closeTimes();
    } else {
      this.openTimes();
      this.timeInput()?.nativeElement.focus();
    }
  }

  protected onTimeKeydown(event: KeyboardEvent): void {
    const open = this.timesOpen();
    const count = this.timeOptions().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          this.openTimes();
        } else if (!event.altKey) {
          this.moveTime((this.activeTime() + 1) % count);
        }
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (open && event.altKey) {
          this.closeTimes();
        } else if (!open) {
          this.openTimes();
        } else {
          this.moveTime((this.activeTime() - 1 + count) % count);
        }
        return;
      case 'Home':
      case 'End':
        if (open) {
          event.preventDefault();
          this.moveTime(event.key === 'Home' ? 0 : count - 1);
        }
        return;
      case 'Enter':
        if (open && this.activeTime() >= 0) {
          event.preventDefault();
          this.pickTime(this.activeTime());
        }
        return;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          this.closeTimes();
        }
        return;
      case 'Tab':
        this.closeTimes();
        return;
    }
  }

  protected pickTime(index: number): void {
    const option = this.timeOptions()[index];
    if (!option) {
      return;
    }
    this.timeText.set(option.label);
    this.commit();
    this.closeTimes();
  }

  private openTimes(): void {
    if (this.blocked() || this.timesOpen() || !this.timeOptions().length) {
      return;
    }
    this.closeCalendar(false);
    this.timesOpen.set(true);
    this.activeTime.set(this.nearestTimeIndex());
    this.changeDetector.detectChanges();
    const panel = this.timesPanel()?.nativeElement;
    const anchor = this.timeInput()?.nativeElement;
    if (panel && anchor) {
      this.stopAnchor = anchorPanel(anchor, panel, { align: 'start', matchWidth: true });
    }
    this.scrollActiveTimeIntoView();
    this.document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
  }

  private closeTimes(): void {
    if (!this.timesOpen()) {
      return;
    }
    this.timesOpen.set(false);
    this.activeTime.set(-1);
    this.unanchor();
  }

  private moveTime(index: number): void {
    this.activeTime.set(index);
    this.changeDetector.detectChanges();
    this.scrollActiveTimeIntoView();
  }

  /** The option at or after the typed time (else the current time of day). */
  private nearestTimeIndex(): number {
    const options = this.timeOptions();
    const now = new Date();
    const target = parseIsoTime(this.timePart()) ?? now.getHours() * 60 + now.getMinutes();
    const index = options.findIndex((option) => option.minutes >= target);
    return index === -1 ? options.length - 1 : index;
  }

  private scrollActiveTimeIntoView(): void {
    const option = this.timesPanel()?.nativeElement.querySelector<HTMLElement>('.is-active');
    if (option && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }

  // ── Value ────────────────────────────────────────────────────────────────────

  /** The value the texts stand for, `null` outside the range. */
  private rangedComposed(): string | null {
    return this.outOfRange() ? null : this.composed();
  }

  private commit(): void {
    const value = this.rangedComposed();
    if (value !== this.value()) {
      this.value.set(value);
      this.emitChange(value);
    }
  }

  /** Shows `value` in the texts (both parts, canonical format). */
  private showValue(value: string | null): void {
    const [datePart, timePart] = this.mode() === 'time' ? [null, value] : (value?.split('T') ?? [null, null]);
    const day = parseIsoDate(datePart);
    const minutes = parseIsoTime(timePart ?? null);
    if (this.hasDate()) {
      this.dateText.set(day ? formatDay(day, this.pattern()) : '');
    }
    if (this.hasTime()) {
      this.timeText.set(minutes === null ? '' : formatTime(minutes, this.twelveHour()));
    }
  }

  private closePopups(restoreFocus: boolean): void {
    this.closeCalendar(restoreFocus);
    this.closeTimes();
  }

  private unanchor(): void {
    this.stopAnchor?.();
    this.stopAnchor = null;
    if (!this.calendarOpen() && !this.timesOpen()) {
      this.document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    }
  }
}
