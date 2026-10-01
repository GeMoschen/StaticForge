import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  input,
  model,
  viewChild,
} from '@angular/core';
import { SfIconComponent } from '../sf-icon.component';
import { optionalNumber } from './optional-number';
import { SfControlBase, provideSfControl } from './sf-control';

export type SfInputType = 'text' | 'email' | 'url' | 'password' | 'tel';

/**
 * A single-line text input (M35.6): `type` text/email/url/password/tel, an optional leading `icon` and a `monospace`
 * look for identifiers (uids, keys). The value is the text, never `null` (a form's `null` shows as empty).
 */
@Component({
  selector: 'sf-input',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-input.component.scss',
  providers: [provideSfControl(() => SfInputComponent)],
  template: `
    <div
      class="sf-input"
      [class.is-invalid]="isInvalid()"
      [class.is-readonly]="readonly()"
      [class.is-disabled]="isDisabled()"
    >
      @if (icon()) {
        <sf-icon class="sf-input__icon" [name]="icon()!" />
      }
      <input
        #input
        class="sf-input__control"
        [class.sf-input__control--mono]="monospace()"
        [attr.type]="type()"
        [id]="controlId()"
        [value]="value()"
        [attr.placeholder]="placeholder()"
        [attr.maxlength]="maxlength()"
        [attr.autocomplete]="autocomplete()"
        [attr.spellcheck]="spellcheckAttr()"
        [readOnly]="readonly()"
        [disabled]="isDisabled()"
        [required]="isRequired()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-labelledby]="ariaLabelledBy()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="isInvalid() || null"
        [attr.aria-required]="isRequired() || null"
        (input)="onInput($event)"
        (blur)="markTouched()"
      />
    </div>
  `,
})
export class SfInputComponent extends SfControlBase<string> {
  readonly value = model<string>('');
  readonly type = input<SfInputType>('text');
  readonly placeholder = input<string | null>(null);
  readonly maxlength = input(null, { transform: optionalNumber });
  readonly autocomplete = input<string | null>(null);
  /** `false` turns the browser's spell check off (identifiers, URLs); unset leaves the browser default. */
  readonly spellcheck = input<boolean | null>(null);
  /** Monospace text, for uids and other identifiers. */
  readonly monospace = input(false, { transform: booleanAttribute });
  /** A leading Material Symbols icon (decoration). */
  readonly icon = input<string | null>(null);

  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');

  protected readonly spellcheckAttr = computed(() => {
    const spellcheck = this.spellcheck();
    return spellcheck === null ? null : String(spellcheck);
  });

  constructor() {
    super();
  }

  focus(): void {
    this.inputEl().nativeElement.focus();
  }

  protected writeModel(value: string | null | undefined): void {
    this.value.set(value ?? '');
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.value.set(value);
    this.emitChange(value);
  }
}
