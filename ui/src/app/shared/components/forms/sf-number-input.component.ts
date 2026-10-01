import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  model,
  viewChild,
} from '@angular/core';
import { optionalNumber } from './optional-number';
import { SfControlBase, joinIds, provideSfControl } from './sf-control';
import { sfUniqueId } from './sf-field-context';

/**
 * A number input (M35.6): native `type=number` with `min`/`max`/`step` and an optional `unit` shown after the number
 * (px, %, s). The value is a `number`, or `null` when the field is empty or holds something that isn't a number.
 *
 * The text is never rewritten while the user types: the input is only written when the value changes from outside
 * and no longer matches what it shows (so a half-typed `1e` stays until it's finished or cleared).
 */
@Component({
  selector: 'sf-number-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-number-input.component.scss',
  providers: [provideSfControl(() => SfNumberInputComponent)],
  template: `
    <div
      class="sf-number-input"
      [class.is-invalid]="isInvalid()"
      [class.is-readonly]="readonly()"
      [class.is-disabled]="isDisabled()"
    >
      <input
        #input
        class="sf-number-input__control"
        type="number"
        [id]="controlId()"
        [attr.min]="min()"
        [attr.max]="max()"
        [attr.step]="step()"
        [attr.placeholder]="placeholder()"
        [readOnly]="readonly()"
        [disabled]="isDisabled()"
        [required]="isRequired()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-labelledby]="ariaLabelledBy()"
        [attr.aria-describedby]="inputDescribedBy()"
        [attr.aria-invalid]="isInvalid() || null"
        [attr.aria-required]="isRequired() || null"
        (input)="onInput($event)"
        (blur)="markTouched()"
      />
      @if (unit()) {
        <span class="sf-number-input__unit" [id]="unitId">{{ unit() }}</span>
      }
    </div>
  `,
})
export class SfNumberInputComponent extends SfControlBase<number | null> {
  readonly value = model<number | null>(null);
  readonly min = input(null, { transform: optionalNumber });
  readonly max = input(null, { transform: optionalNumber });
  readonly step = input(null, { transform: optionalNumber });
  readonly placeholder = input<string | null>(null);
  /** A unit after the number (`px`, `%`); it is part of the input's description. */
  readonly unit = input<string | null>(null);

  protected readonly unitId = sfUniqueId('sf-number-unit');
  protected readonly inputDescribedBy = computed(() => joinIds(this.describedBy(), this.unit() ? this.unitId : null));

  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('input');

  constructor() {
    super();
    effect(() => {
      const element = this.inputEl()?.nativeElement;
      const value = this.value();
      if (element && parseNumber(element) !== value) {
        element.value = value === null ? '' : String(value);
      }
    });
  }

  focus(): void {
    this.inputEl()?.nativeElement.focus();
  }

  protected writeModel(value: number | null | undefined): void {
    const next = typeof value === 'number' && Number.isFinite(value) ? value : null;
    this.value.set(next);
    // A form write (reset, patch) also clears half-typed text like "1e", which reads as null and so matches the model.
    const element = this.inputEl()?.nativeElement;
    if (element) {
      element.value = next === null ? '' : String(next);
    }
  }

  protected onInput(event: Event): void {
    const value = parseNumber(event.target as HTMLInputElement);
    if (value !== this.value()) {
      this.value.set(value);
      this.emitChange(value);
    }
  }
}

/** The number an input shows: `null` when it is empty or not a number. */
function parseNumber(element: HTMLInputElement): number | null {
  if (element.value.trim() === '') {
    return null;
  }
  const value = Number(element.value);
  return Number.isFinite(value) ? value : null;
}
