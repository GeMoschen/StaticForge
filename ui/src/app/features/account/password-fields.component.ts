import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { PasswordChecklistComponent } from './password-checklist.component';
import { checkPassword } from './password-rules.util';

type PasswordPolicyView = components['schemas']['PasswordPolicyView'];

/**
 * The fields of a password change (M35.16), shared by *Set password* and *My account › Password*: the current password,
 * the new one with its live checklist, and the confirmation, with one show/hide toggle for all of them. The parent owns
 * the values (the models) and the save; this only collects and judges what is typed.
 */
@Component({
  selector: 'sf-password-fields',
  standalone: true,
  imports: [PasswordChecklistComponent, SfButtonComponent, SfFieldComponent, SfInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './password-fields.component.scss',
  template: `
    <sf-field [label]="currentLabel() | transloco" [error]="currentError()">
      <sf-input [type]="type()" [value]="current()" autocomplete="current-password" (valueChange)="current.set($event)" />
    </sf-field>
    <sf-field [label]="'account.password.new' | transloco">
      <div class="password">
        <sf-input class="password__input" [type]="type()" [value]="next()" autocomplete="new-password" (valueChange)="next.set($event)" />
        <sf-button
          variant="ghost"
          [icon]="visible() ? 'visibility_off' : 'visibility'"
          [label]="(visible() ? 'account.password.hide' : 'account.password.show') | transloco"
          [aria-pressed]="visible()"
          (click)="visible.set(!visible())"
        />
      </div>
    </sf-field>
    <sf-field [label]="'account.password.confirm' | transloco">
      <sf-input [type]="type()" [value]="confirm()" autocomplete="new-password" (valueChange)="confirm.set($event)" />
    </sf-field>
    <sf-password-checklist [check]="check()" />
  `,
})
export class PasswordFieldsComponent {
  readonly policy = input<PasswordPolicyView | null>(null);
  /** The Transloco key of the current-password label (*Current password* or *Temporary password*). */
  readonly currentLabel = input('account.password.current');
  /** Why the server refused the current password; shown on that field. */
  readonly currentError = input<string | null>(null);

  readonly current = model('');
  readonly next = model('');
  readonly confirm = model('');

  protected readonly visible = signal(false);
  protected readonly type = computed(() => (this.visible() ? 'text' : 'password'));
  /** The judgement of the new password: the parent reads it through a template reference (`#fields`) or recomputes. */
  readonly check = computed(() => checkPassword(this.policy(), this.next(), this.confirm()));
}
