import { ChangeDetectionStrategy, Component, ElementRef, booleanAttribute, input, model, numberAttribute, viewChild } from '@angular/core';
import { optionalNumber } from './optional-number';
import { SfControlBase, provideSfControl } from './sf-control';

/**
 * A multi-line text input (M35.6): `rows` high, resizable vertically only, optionally `monospace` (code, lists of
 * ids). The value is the text, never `null`.
 */
@Component({
  selector: 'sf-textarea',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-textarea.component.scss',
  providers: [provideSfControl(() => SfTextareaComponent)],
  template: `
    <textarea
      #textarea
      class="sf-textarea"
      [class.sf-textarea--mono]="monospace()"
      [id]="controlId()"
      [value]="value()"
      [rows]="rows()"
      [attr.placeholder]="placeholder()"
      [attr.maxlength]="maxlength()"
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
    ></textarea>
  `,
})
export class SfTextareaComponent extends SfControlBase<string> {
  readonly value = model<string>('');
  readonly rows = input(4, { transform: numberAttribute });
  readonly placeholder = input<string | null>(null);
  readonly maxlength = input(null, { transform: optionalNumber });
  readonly monospace = input(false, { transform: booleanAttribute });

  private readonly textarea = viewChild.required<ElementRef<HTMLTextAreaElement>>('textarea');

  constructor() {
    super();
  }

  focus(): void {
    this.textarea().nativeElement.focus();
  }

  protected writeModel(value: string | null | undefined): void {
    this.value.set(value ?? '');
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.value.set(value);
    this.emitChange(value);
  }
}
