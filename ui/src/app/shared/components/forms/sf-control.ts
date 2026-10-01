import { Directive, Provider, Type, booleanAttribute, computed, forwardRef, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SF_FIELD, sfUniqueId } from './sf-field-context';

/**
 * The shared half of every M35.6 form control: `ControlValueAccessor` plumbing, disabled/read-only/required/invalid
 * state, and the link to a surrounding `sf-field` (the control's id, `aria-describedby`, `aria-invalid`,
 * `aria-required`). A subclass owns its value (a `model()`), calls {@link emitChange} when the user changes it and
 * {@link markTouched} on blur, and implements {@link writeModel} for values coming from a form.
 *
 * Outside an `sf-field`, give the control an accessible name with `aria-label` (or `aria-labelledby`), or pass
 * `inputId` and label it yourself.
 */
@Directive({
  host: {
    // The ARIA inputs are forwarded to the focusable element inside; the host itself carries none.
    '[attr.aria-label]': 'null',
    '[attr.aria-labelledby]': 'null',
    '[attr.aria-describedby]': 'null',
  },
})
export abstract class SfControlBase<T> implements ControlValueAccessor {
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly readonly = input(false, { transform: booleanAttribute });
  readonly required = input(false, { transform: booleanAttribute });
  /** Marks the control invalid on its own; inside an `sf-field` its `error` does that too. */
  readonly invalid = input(false, { transform: booleanAttribute });
  /** The id of the focusable element when the control is not inside an `sf-field` (which assigns one). */
  readonly inputId = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });
  readonly ariaLabelledBy = input<string | null>(null, { alias: 'aria-labelledby' });
  readonly ariaDescribedBy = input<string | null>(null, { alias: 'aria-describedby' });

  protected readonly field = inject(SF_FIELD, { optional: true });
  private readonly ownId = sfUniqueId('sf-control');
  private readonly formDisabled = signal(false);

  readonly controlId = computed(() => this.field?.controlId ?? this.inputId() ?? this.ownId);
  readonly isDisabled = computed(() => this.disabled() || this.formDisabled());
  readonly isInvalid = computed(() => this.invalid() || (this.field?.invalid() ?? false));
  readonly isRequired = computed(() => this.required() || (this.field?.required() ?? false));
  readonly describedBy = computed(() => joinIds(this.field?.describedBy() ?? null, this.ariaDescribedBy()));
  /** `aria-labelledby` for a group control: its own, else the field's label. */
  readonly groupLabelledBy = computed(() => this.ariaLabelledBy() ?? (this.field && !this.ariaLabel() ? this.field.labelId : null));

  private changeCallback: (value: T) => void = () => undefined;
  private touchedCallback: () => void = () => undefined;

  protected constructor(kind: 'single' | 'group' = 'single') {
    this.field?.registerControl(kind);
  }

  /** A value set by a form (`formControl`, `ngModel`). */
  protected abstract writeModel(value: T | null | undefined): void;

  writeValue(value: T | null | undefined): void {
    this.writeModel(value);
  }

  registerOnChange(fn: (value: T) => void): void {
    this.changeCallback = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.touchedCallback = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.formDisabled.set(disabled);
  }

  /** Tells a bound form about a change the user made. */
  protected emitChange(value: T): void {
    this.changeCallback(value);
  }

  protected markTouched(): void {
    this.touchedCallback();
  }
}

/** The `NG_VALUE_ACCESSOR` provider of control `type`. */
export function provideSfControl(type: () => Type<unknown>): Provider {
  return { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(type), multi: true };
}

/** Space-separated ids, `null` when there are none. */
export function joinIds(...ids: (string | null | undefined)[]): string | null {
  const joined = ids.filter((id) => !!id).join(' ');
  return joined || null;
}
