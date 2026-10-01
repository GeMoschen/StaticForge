import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { SfControlBase, provideSfControl } from './sf-control';

/**
 * A switch (M35.6): a `<button type=button role=switch aria-checked>` with an optional projected text. `Space` and
 * `Enter` toggle it (native button activation).
 *
 * Like `sf-checkbox`, its projected text is its name; inside an `sf-field` without text it is `aria-labelledby` the
 * field label (it registers as a group control, so the label never overrides its own text).
 *
 * - Value: `boolean`.
 * - `readonly`: `aria-readonly`, stays focusable and readable, doesn't toggle.
 */
@Component({
  selector: 'sf-switch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideSfControl(() => SfSwitchComponent)],
  template: `
    <button
      type="button"
      role="switch"
      class="sf-switch"
      [class.is-readonly]="readonly()"
      [class.is-invalid]="isInvalid()"
      [id]="controlId()"
      [disabled]="isDisabled()"
      [attr.aria-checked]="value()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="labelledBy(text)"
      [attr.aria-describedby]="describedBy()"
      [attr.aria-invalid]="isInvalid() || null"
      [attr.aria-required]="isRequired() || null"
      [attr.aria-readonly]="readonly() || null"
      (click)="toggle()"
      (blur)="markTouched()"
    >
      <span class="sf-switch__track" aria-hidden="true"><span class="sf-switch__thumb"></span></span>
      <span #text class="sf-switch__text"><ng-content /></span>
    </button>
  `,
  styleUrl: './sf-switch.component.scss',
})
export class SfSwitchComponent extends SfControlBase<boolean> {
  readonly value = model(false);

  constructor() {
    super('group');
  }

  protected writeModel(value: boolean | null | undefined): void {
    this.value.set(!!value);
  }

  /** Its own `aria-labelledby`, else — when it has no text of its own — the field label. */
  protected labelledBy(text: HTMLElement): string | null {
    if (this.ariaLabelledBy()) {
      return this.ariaLabelledBy();
    }
    return text.textContent?.trim() ? null : this.groupLabelledBy();
  }

  protected toggle(): void {
    if (this.readonly() || this.isDisabled()) {
      return;
    }
    const next = !this.value();
    this.value.set(next);
    this.emitChange(next);
  }
}
