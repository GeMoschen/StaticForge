import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfCopyableComponent } from '../../../../shared/components/display/sf-copyable.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfRadioGroupComponent, SfRadioOption } from '../../../../shared/components/forms/sf-radio-group.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { ADMIN_USERS, AdminSystemRole, AdminUser, SYSTEM_ROLES } from './admin-data';
import { AdminState } from './admin-state';

/** How the person gets their password: a generated one-time password they must replace, or one the admin types. */
export type PasswordChoice = 'generate' | 'set';

/** The fixed one-time passwords the prototype hands out (readable words, a number). */
const ONE_TIME_PASSWORDS = ['Tide-Lamp-4821-Fern', 'Maple-Quill-7302-Dune', 'Cedar-Pearl-1957-Moss'];
let issued = 0;

/** The minimum length of a password the admin sets, in characters. */
export const MIN_PASSWORD = 12;

/**
 * The *New user* and *Reset password* dialog of Administration (M35.16). Create asks for username, email, display name
 * and role; both ask how the person gets their password — **Generate a one-time password** (shown once, in a second
 * step with a copy button; the person must choose their own at the first sign-in) or **Set a password**. Errors are
 * inline, after the first attempt to submit. Nothing is saved.
 */
@Component({
  selector: 'sf-sample-admin-user-dialog',
  standalone: true,
  imports: [
    SfBannerComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfInputComponent,
    SfRadioGroupComponent,
    SfSelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-admin-user-dialog.component.html',
  styleUrl: './sample-admin-user-dialog.component.scss',
})
export class SampleAdminUserDialogComponent {
  readonly mode = input.required<'create' | 'reset'>();
  /** The user whose password is reset. */
  readonly user = input<AdminUser | null>(null);
  readonly created = output<AdminUser>();
  readonly closed = output<void>();

  protected readonly admin = inject(AdminState);
  protected readonly t = this.admin.t;

  protected readonly username = signal('');
  protected readonly email = signal('');
  protected readonly displayName = signal('');
  protected readonly role = signal<AdminSystemRole>('user');
  protected readonly choice = signal<PasswordChoice>('generate');
  protected readonly password = signal('');
  protected readonly attempted = signal(false);
  /** The one-time password shown after a successful submit (the second step). */
  protected readonly issuedPassword = signal<string | null>(null);

  protected readonly roleOptions: SfSelectOption<AdminSystemRole>[] = SYSTEM_ROLES.map((value) => ({ value, label: this.t(`systemRoles.${value}`) }));
  protected readonly choiceOptions = computed<SfRadioOption<PasswordChoice>[]>(() => [
    { value: 'generate', label: this.t('password.generate'), description: this.t('password.generateHint') },
    { value: 'set', label: this.t('password.set'), description: this.t('password.setHint', { min: MIN_PASSWORD }) },
  ]);

  protected readonly title = computed(() =>
    this.issuedPassword() !== null
      ? this.t('password.issuedTitle')
      : this.mode() === 'create'
        ? this.t('newUser.title')
        : this.t('reset.title', { name: this.user()?.displayName ?? '' }),
  );

  protected readonly errors = computed(() => {
    if (!this.attempted()) {
      return { username: null, email: null, displayName: null, password: null };
    }
    const username = this.username().trim();
    const taken = ADMIN_USERS.some((u) => u.username === username);
    return {
      username: username === '' ? this.t('newUser.usernameRequired') : !/^[a-z0-9._-]{3,}$/.test(username) ? this.t('newUser.usernameFormat') : taken ? this.t('newUser.usernameTaken') : null,
      email: /^\S+@\S+\.\S+$/.test(this.email().trim()) ? null : this.t('newUser.emailInvalid'),
      displayName: this.displayName().trim() === '' ? this.t('newUser.displayNameRequired') : null,
      password: this.choice() === 'set' && [...this.password()].length < MIN_PASSWORD ? this.t('password.tooShort', { min: MIN_PASSWORD }) : null,
    };
  });

  protected submit(): void {
    this.attempted.set(true);
    const errors = this.errors();
    const create = this.mode() === 'create';
    if ((create && (errors.username || errors.email || errors.displayName)) || errors.password) {
      return;
    }
    if (create) {
      const username = this.username().trim();
      this.created.emit({
        id: `u-${username}`,
        username,
        displayName: this.displayName().trim(),
        email: this.email().trim(),
        role: this.role(),
        status: 'active',
        lastSignInMinutes: null,
        createdDays: 0,
        passwordPending: this.choice() === 'generate',
        memberships: [],
      });
    }
    if (this.choice() === 'generate') {
      this.issuedPassword.set(ONE_TIME_PASSWORDS[issued++ % ONE_TIME_PASSWORDS.length]);
    } else {
      this.admin.notice(this.t(create ? 'newUser.created' : 'reset.done', { name: create ? this.displayName().trim() : (this.user()?.displayName ?? '') }));
      this.closed.emit();
    }
  }
}
