import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  numberAttribute,
  viewChild,
} from '@angular/core';
import { I18nFormatService } from '../../../core/i18n/i18n-format.service';
import { SfControlBase, provideSfControl } from './sf-control';

/**
 * A slider (M35.6): the native `<input type=range>` — its `role=slider`, arrow/Page/Home/End keys and touch handling
 * stay the browser's — restyled with the tokens, with the current value shown beside it (`showValue`, in the UI
 * locale's number format plus `unit`) and announced the same way through `aria-valuetext`. Value: a number, `min`
 * until set. A native range can't be read-only, so `readonly` blocks changes and sets `aria-readonly`.
 */
@Component({
  selector: 'sf-slider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-slider.component.scss',
  providers: [provideSfControl(() => SfSliderComponent)],
  template: `
    <div class="sf-slider" [class.is-readonly]="readonly()" [class.is-disabled]="isDisabled()">
      <input
        #input
        class="sf-slider__input"
        type="range"
        [id]="controlId()"
        [min]="min()"
        [max]="max()"
        [step]="step()"
        [value]="current()"
        [disabled]="isDisabled()"
        [style.--slider-fill]="fill()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-labelledby]="ariaLabelledBy()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="isInvalid() || null"
        [attr.aria-required]="isRequired() || null"
        [attr.aria-readonly]="readonly() || null"
        [attr.aria-valuetext]="valueText()"
        (input)="onInput($event)"
        (blur)="markTouched()"
      />
      @if (showValue()) {
        <output class="sf-slider__value" [attr.for]="controlId()" aria-hidden="true">{{ valueText() }}</output>
      }
    </div>
  `,
})
export class SfSliderComponent extends SfControlBase<number> {
  readonly value = model<number | null>(null);
  readonly min = input(0, { transform: numberAttribute });
  readonly max = input(100, { transform: numberAttribute });
  readonly step = input(1, { transform: numberAttribute });
  /** Shows the value beside the track. */
  readonly showValue = input(true, { transform: booleanAttribute });
  /** Appended to the shown and announced value, e.g. `%` or `px`. */
  readonly unit = input<string | null>(null);

  private readonly format = inject(I18nFormatService);
  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');

  /** The value within the range (a native range shows `min` for an unset or out-of-range value). */
  protected readonly current = computed(() => {
    const value = this.value();
    return value === null ? this.min() : Math.min(Math.max(value, this.min()), this.max());
  });
  protected readonly valueText = computed(() => {
    const text = this.format.number(this.current());
    return this.unit() ? `${text} ${this.unit()}` : text;
  });
  /** How much of the track is filled, for the accent part of the track. */
  protected readonly fill = computed(() => {
    const span = this.max() - this.min();
    return `${span > 0 ? ((this.current() - this.min()) / span) * 100 : 0}%`;
  });

  constructor() {
    super();
  }

  focus(): void {
    this.inputEl().nativeElement.focus();
  }

  protected writeModel(value: number | null | undefined): void {
    this.value.set(typeof value === 'number' && Number.isFinite(value) ? value : null);
  }

  protected onInput(event: Event): void {
    const element = event.target as HTMLInputElement;
    if (this.readonly()) {
      element.value = String(this.current()); // read-only: put the thumb back
      return;
    }
    const value = Number(element.value);
    if (value !== this.value()) {
      this.value.set(value);
      this.emitChange(value);
    }
  }
}
