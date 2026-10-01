import { ChangeDetectionStrategy, Component, ElementRef, computed, model, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfControlBase, provideSfControl } from './sf-control';

/**
 * A colour input (M35.6): the native colour picker as a swatch beside a hex text input. The value is `#rrggbb`
 * (lowercase) or `null` when the text is empty. The text also takes `rrggbb` and `#rgb`; it is normalised on blur.
 * Text that is no colour marks the input invalid and changes nothing until it is fixed. A value from a form that is no
 * hex colour shows as empty.
 *
 * Inside an `sf-field` the field label names the hex input; outside one it is named by `aria-label`, else "Hex
 * value". The swatch is always "Pick a colour".
 */
@Component({
  selector: 'sf-color-input',
  standalone: true,
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-color-input.component.scss',
  providers: [provideSfControl(() => SfColorInputComponent)],
  template: `
    <div
      class="sf-color-input"
      [class.is-invalid]="hexInvalid()"
      [class.is-readonly]="readonly()"
      [class.is-disabled]="isDisabled()"
    >
      <input
        class="sf-color-input__swatch"
        type="color"
        [value]="value() ?? fallbackColor"
        [class.sf-color-input__swatch--empty]="!value()"
        [disabled]="isDisabled() || readonly()"
        [attr.aria-label]="'shared.color.picker' | transloco"
        [attr.aria-describedby]="describedBy()"
        (input)="onPick($event)"
        (blur)="markTouched()"
      />
      <input
        #hex
        class="sf-color-input__hex"
        type="text"
        maxlength="7"
        autocomplete="off"
        spellcheck="false"
        [id]="controlId()"
        [value]="shownText()"
        [readOnly]="readonly()"
        [disabled]="isDisabled()"
        [required]="isRequired()"
        [attr.aria-label]="ariaLabel() ?? (needsHexName() ? ('shared.color.hex' | transloco) : null)"
        [attr.aria-labelledby]="ariaLabelledBy()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="hexInvalid() || null"
        [attr.aria-required]="isRequired() || null"
        (input)="onType($event)"
        (blur)="onHexBlur()"
      />
    </div>
  `,
})
export class SfColorInputComponent extends SfControlBase<string | null> {
  readonly value = model<string | null>(null);

  /** What the native picker shows while there is no value (it cannot be empty). */
  protected readonly fallbackColor = '#000000';

  private readonly hexEl = viewChild.required<ElementRef<HTMLInputElement>>('hex');
  /** The text as typed, while it differs from the normalised value; `null` shows the value. */
  private readonly draft = signal<string | null>(null);

  /** Typed text that is no colour. */
  private readonly draftInvalid = computed(() => {
    const draft = this.draft();
    return draft !== null && parseHex(draft) === undefined;
  });
  protected readonly hexInvalid = computed(() => this.isInvalid() || this.draftInvalid());
  protected readonly shownText = computed(() => {
    const draft = this.draft();
    if (draft !== null && (this.draftInvalid() || parseHex(draft) === this.value())) {
      return draft;
    }
    return this.value() ?? '';
  });
  protected readonly needsHexName = computed(() => !this.field && !this.ariaLabelledBy());

  constructor() {
    super();
  }

  focus(): void {
    this.hexEl().nativeElement.focus();
  }

  protected writeModel(value: string | null | undefined): void {
    this.draft.set(null);
    this.value.set(parseHex(value ?? '') ?? null);
  }

  protected onPick(event: Event): void {
    this.draft.set(null);
    this.update((event.target as HTMLInputElement).value.toLowerCase());
  }

  protected onType(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.draft.set(text);
    const value = parseHex(text);
    if (value !== undefined) {
      this.update(value);
    }
  }

  protected onHexBlur(): void {
    if (!this.draftInvalid()) {
      this.draft.set(null);
    }
    this.markTouched();
  }

  private update(value: string | null): void {
    if (value !== this.value()) {
      this.value.set(value);
      this.emitChange(value);
    }
  }
}

/** `#rrggbb` for a hex colour (`#rgb`, `rrggbb`, any case), `null` for empty text, `undefined` for anything else. */
export function parseHex(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (!match) {
    return undefined;
  }
  const digits = match[1].toLowerCase();
  return '#' + (digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits);
}
