import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { SfControlBase, provideSfControl } from './sf-control';

/**
 * A checkbox (M35.6): a native `<input type=checkbox>`, restyled, with its projected text beside it. A `<label>` wraps
 * both, so the text is the checkbox's accessible name.
 *
 * Inside an `sf-field` the field label is the context (a group heading), not the name: the checkbox registers as a
 * group control and keeps its own text. Without projected text it falls back to `aria-labelledby` the field label (or
 * takes `aria-label` / `aria-labelledby`).
 *
 * - Value: `boolean`. `indeterminate` shows the mixed state; a user change clears it (two-way bindable).
 * - `readonly`: `aria-readonly`, clicks and `Space` don't toggle, the box stays readable.
 */
@Component({
  selector: 'sf-checkbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideSfControl(() => SfCheckboxComponent)],
  template: `
    <label
      class="sf-checkbox"
      [class.is-disabled]="isDisabled()"
      [class.is-readonly]="readonly()"
      [class.is-invalid]="isInvalid()"
    >
      <input
        type="checkbox"
        class="sf-checkbox__box"
        [id]="controlId()"
        [checked]="value()"
        [indeterminate]="indeterminate()"
        [disabled]="isDisabled()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-labelledby]="labelledBy(text)"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="isInvalid() || null"
        [attr.aria-required]="isRequired() || null"
        [attr.aria-readonly]="readonly() || null"
        (click)="onClick($event)"
        (change)="onToggle($event)"
        (blur)="markTouched()"
      />
      <span #text class="sf-checkbox__text"><ng-content /></span>
    </label>
  `,
  styleUrl: './sf-checkbox.component.scss',
})
export class SfCheckboxComponent extends SfControlBase<boolean> {
  readonly value = model(false);
  readonly indeterminate = model(false);

  constructor() {
    super('group');
  }

  protected writeModel(value: boolean | null | undefined): void {
    this.value.set(!!value);
  }

  /**
   * Its own `aria-labelledby`, else — when it has no text of its own — the field label. Read from the rendered text
   * (projected content is in place when this view is checked).
   */
  protected labelledBy(text: HTMLElement): string | null {
    if (this.ariaLabelledBy()) {
      return this.ariaLabelledBy();
    }
    return text.textContent?.trim() ? null : this.groupLabelledBy();
  }

  protected onClick(event: MouseEvent): void {
    if (this.readonly()) {
      event.preventDefault(); // the native toggle is undone
    }
  }

  protected onToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.indeterminate.set(false);
    this.value.set(checked);
    this.emitChange(checked);
  }
}
