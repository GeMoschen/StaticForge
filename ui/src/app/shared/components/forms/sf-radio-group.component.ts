import { ChangeDetectionStrategy, Component, ElementRef, inject, input, model } from '@angular/core';
import { SfControlBase, provideSfControl } from './sf-control';
import { sfUniqueId } from './sf-field-context';

export interface SfRadioOption<T> {
  value: T;
  label: string;
  /** A second line under the label; it describes the radio. */
  description?: string;
  disabled?: boolean;
}

/**
 * A radio group (M35.6): a `role=radiogroup` of native radios sharing a generated `name`, so the browser provides the
 * arrow-key behaviour (move and select, wrapping). The radios are restyled; each `<label>` names its radio.
 *
 * The group is labelled by the surrounding `sf-field`'s label (`aria-labelledby`), or by `aria-label` /
 * `aria-labelledby`, and carries `aria-required`, `aria-invalid`, `aria-describedby` and `aria-readonly`.
 *
 * - Value: `T | null`; options are matched with `compareWith` (default `Object.is`).
 * - `orientation`: `vertical` (default) or `horizontal`.
 * - `readonly`: the checked radio stays readable; clicks and arrow keys don't change it.
 */
@Component({
  selector: 'sf-radio-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideSfControl(() => SfRadioGroupComponent)],
  template: `
    <div
      role="radiogroup"
      class="sf-radio-group"
      [class.sf-radio-group--horizontal]="orientation() === 'horizontal'"
      [id]="controlId()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="groupLabelledBy()"
      [attr.aria-describedby]="describedBy()"
      [attr.aria-invalid]="isInvalid() || null"
      [attr.aria-required]="isRequired() || null"
      [attr.aria-readonly]="readonly() || null"
      [attr.aria-disabled]="isDisabled() || null"
    >
      @for (option of options(); track $index; let i = $index) {
        <div class="sf-radio" [class.is-disabled]="isDisabled() || option.disabled" [class.is-readonly]="readonly()">
          <label class="sf-radio__main">
            <input
              type="radio"
              class="sf-radio__dot"
              [name]="name"
              [value]="i"
              [checked]="isSelected(option)"
              [disabled]="isDisabled() || !!option.disabled"
              [attr.aria-describedby]="option.description ? name + '-d' + i : null"
              (change)="select(option)"
              (blur)="markTouched()"
            />
            <span class="sf-radio__label">{{ option.label }}</span>
          </label>
          <!-- Outside the <label>, so it describes the radio instead of joining its name. -->
          @if (option.description) {
            <span class="sf-radio__description" [id]="name + '-d' + i">{{ option.description }}</span>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './sf-radio-group.component.scss',
})
export class SfRadioGroupComponent<T = unknown> extends SfControlBase<T | null> {
  readonly options = input<readonly SfRadioOption<T>[]>([]);
  readonly orientation = input<'vertical' | 'horizontal'>('vertical');
  readonly compareWith = input<(a: T, b: T) => boolean>(Object.is);
  readonly value = model<T | null>(null);

  /** The radios' shared `name`; also the prefix of the description ids. */
  protected readonly name = sfUniqueId('sf-radio-group');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    super('group');
  }

  protected writeModel(value: T | null | undefined): void {
    this.value.set(value ?? null);
  }

  protected isSelected(option: SfRadioOption<T>): boolean {
    const value = this.value();
    return value !== null && this.compareWith()(option.value, value);
  }

  protected select(option: SfRadioOption<T>): void {
    if (this.readonly() || option.disabled) {
      // The browser has already moved the check (click or arrow key): put it back on the value.
      this.radios().forEach((radio, index) => (radio.checked = this.isSelected(this.options()[index])));
      return;
    }
    this.value.set(option.value);
    this.emitChange(option.value);
  }

  private radios(): HTMLInputElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  }
}
