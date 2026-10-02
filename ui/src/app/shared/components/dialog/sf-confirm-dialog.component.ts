import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfInputComponent } from '../forms/sf-input.component';
import { sfUniqueId } from '../forms/sf-field-context';
import { SfButtonComponent } from '../sf-button.component';
import { SfFieldComponent } from '../sf-field.component';
import type { ConfirmOptions } from './confirm.service';
import { SfDialogRef, injectDialogData } from './dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from './sf-dialog.component';

/** The dialog behind `ConfirmService.confirm()` (M35.7). Closes with `true` only through its confirm button. */
@Component({
  selector: 'sf-confirm-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-confirm-dialog.component.scss',
  template: `
    <sf-dialog size="sm" [title]="options.title" [describedBy]="messageId">
      <form class="sf-confirm" (submit)="onSubmit($event)">
        <div [id]="messageId" class="sf-confirm__message">
          @if (options.message) {
            <p>{{ options.message }}</p>
          }
          @if (options.details?.length) {
            <ul class="sf-confirm__details">
              @for (detail of options.details; track $index) {
                <li>{{ detail }}</li>
              }
            </ul>
          }
          @if (options.irreversible) {
            <p class="sf-confirm__irreversible">{{ 'shared.confirm.irreversible' | transloco }}</p>
          }
        </div>
        @if (options.typeToConfirm) {
          <sf-field
            [label]="'shared.confirm.typeToConfirm' | transloco: { value: options.typeToConfirm }"
          >
            <sf-input
              data-sf-autofocus
              autocomplete="off"
              [spellcheck]="false"
              [value]="typed()"
              (valueChange)="typed.set($event)"
            />
          </sf-field>
        }
      </form>
      <ng-container sfDialogFooter>
        <sf-button variant="secondary" [attr.data-sf-autofocus]="focusCancel() ? '' : null" (click)="ref.close(false)">{{
          options.cancelLabel ?? ('shared.confirm.cancel' | transloco)
        }}</sf-button>
        <sf-button
          [variant]="options.tone === 'danger' ? 'danger' : 'primary'"
          [attr.data-sf-autofocus]="focusConfirm() ? '' : null"
          [disabled]="!matches()"
          (click)="confirm()"
          >{{ options.confirmLabel ?? ('shared.confirm.confirm' | transloco) }}</sf-button
        >
      </ng-container>
    </sf-dialog>
  `,
})
export class SfConfirmDialogComponent {
  protected readonly options = injectDialogData<Omit<ConfirmOptions, 'injector'>>();
  protected readonly ref = inject<SfDialogRef<boolean>>(SfDialogRef);

  protected readonly messageId = sfUniqueId('sf-confirm-message');
  protected readonly typed = signal('');
  /** Typed confirmations compare trimmed text, case-sensitively (a name is a name). */
  protected readonly matches = computed(
    () => !this.options.typeToConfirm || this.typed().trim() === this.options.typeToConfirm.trim(),
  );
  /** Where focus starts: the typed field if any, Cancel for a danger action, else the confirm button. */
  protected readonly focusCancel = computed(() => !this.options.typeToConfirm && this.options.tone === 'danger');
  protected readonly focusConfirm = computed(() => !this.options.typeToConfirm && this.options.tone !== 'danger');

  protected confirm(): void {
    if (this.matches()) {
      this.ref.close(true);
    }
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.confirm();
  }
}
