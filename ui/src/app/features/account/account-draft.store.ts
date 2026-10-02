import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ToastService } from '../../core/ui/toast.service';
import type { SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import { ACCOUNT_SECTIONS, AccountSection, SAVEABLE_SECTIONS } from './account-sections';
import { PasswordPolicyStore } from './password-policy.store';
import { checkPassword } from './password-rules.util';

type UpdateMeRequest = components['schemas']['UpdateMeRequest'];

/** Which Profile fields the last refused save complained about. */
export interface ProfileErrors {
  displayName?: string;
  username?: string;
  email?: string;
  currentPassword?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROFILE_FIELDS: readonly string[] = ['displayName', 'username', 'email', 'currentPassword'];

/**
 * The drafts of My account's two explicit-save pages (M35.16, decisions 11 and 47), provided by the account shell and
 * shared by its pages: the Profile form and the Password form. Drafts live here, so they survive a switch of section
 * until the person saves, discards or leaves. Preferences apply at once and have no draft.
 *
 * `saveSection` resolves `{ ok: false, message }` when a save is refused (a rule, the server): the person stays on the
 * page, and the save status says why.
 */
@Injectable()
export class AccountDraftStore {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly session = inject(SessionService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly frame = inject(FrameContextStore);
  readonly policy = inject(PasswordPolicyStore);

  /** The open section, from the URL. */
  readonly section = computed<AccountSection>(() => {
    const sub = this.frame.location().sub;
    return (ACCOUNT_SECTIONS as readonly string[]).includes(sub ?? '') ? (sub as AccountSection) : 'profile';
  });

  // ── Profile ────────────────────────────────────────────────────────────────
  /** What the server has now: the baseline for "dirty". */
  readonly saved = computed(() => ({
    displayName: this.auth.displayName() ?? '',
    username: this.auth.username() ?? '',
    email: this.auth.email() ?? '',
  }));
  readonly displayName = signal(this.auth.displayName() ?? '');
  readonly username = signal(this.auth.username() ?? '');
  readonly email = signal(this.auth.email() ?? '');
  /** The current password a changed username or email asks for. */
  readonly currentPassword = signal('');
  readonly profileErrors = signal<ProfileErrors>({});
  /** A refusal that belongs to no field. */
  readonly profileError = signal<string | null>(null);

  /** Changing the username or the email needs the current password. */
  readonly needsCurrentPassword = computed(
    () => this.username().trim() !== this.saved().username || this.email().trim() !== this.saved().email,
  );
  readonly profileDirty = computed(() => this.needsCurrentPassword() || this.displayName().trim() !== this.saved().displayName);

  // ── Password ───────────────────────────────────────────────────────────────
  readonly current = signal('');
  readonly next = signal('');
  readonly confirm = signal('');
  readonly currentError = signal<string | null>(null);
  readonly passwordError = signal<string | null>(null);
  readonly passwordDirty = computed(() => this.current() !== '' || this.next() !== '' || this.confirm() !== '');
  readonly passwordCheck = computed(() => checkPassword(this.policy.policy(), this.next(), this.confirm()));

  readonly saving = signal(false);

  constructor() {
    this.policy.load();
    // The email and the memberships aren't in the token: read the profile fresh, and show it unless the person already
    // started editing.
    this.session.reloadUser().subscribe({
      next: () => {
        if (!this.profileDirty()) {
          this.resetProfile();
        }
      },
      error: () => undefined,
    });
  }

  dirtyOf(section: AccountSection): boolean {
    return section === 'profile' ? this.profileDirty() : section === 'password' ? this.passwordDirty() : false;
  }

  /** How many things the last refused save of the section complained about (0: none). */
  errorCountOf(section: AccountSection): number {
    if (section === 'profile') {
      return Object.keys(this.profileErrors()).length + (this.profileError() ? 1 : 0);
    }
    if (section === 'password') {
      return (this.currentError() ? 1 : 0) + (this.passwordError() ? 1 : 0);
    }
    return 0;
  }

  /** The reason the last save of the section was refused, for the leave dialog; `null` when it was not. */
  messageOf(section: AccountSection): string | null {
    return this.errorCountOf(section) > 0 ? this.t(`${section}.notSaved`) : null;
  }

  async saveSection(section: AccountSection): Promise<SaveResult> {
    if (!SAVEABLE_SECTIONS.includes(section)) {
      return { ok: true };
    }
    return section === 'profile' ? this.saveProfile() : this.savePassword();
  }

  discardSection(section: AccountSection): void {
    if (section === 'profile') {
      this.resetProfile();
    } else if (section === 'password') {
      this.resetPassword();
    }
  }

  private async saveProfile(): Promise<SaveResult> {
    if (!this.profileDirty() || this.saving()) {
      return { ok: true };
    }
    const errors: ProfileErrors = {};
    if (this.displayName().trim() === '') {
      errors.displayName = this.t('profile.nameRequired');
    }
    if (this.username().trim() === '') {
      errors.username = this.t('profile.usernameRequired');
    }
    if (!EMAIL.test(this.email().trim())) {
      errors.email = this.t('profile.emailInvalid');
    }
    if (this.needsCurrentPassword() && this.currentPassword() === '') {
      errors.currentPassword = this.t('profile.currentRequired');
    }
    this.profileErrors.set(errors);
    this.profileError.set(null);
    if (Object.keys(errors).length > 0) {
      return { ok: false, message: this.t('profile.notSaved') };
    }
    const body: UpdateMeRequest = {
      displayName: this.displayName().trim(),
      username: this.username().trim(),
      email: this.email().trim(),
    };
    if (this.needsCurrentPassword()) {
      body.currentPassword = this.currentPassword();
    }
    this.saving.set(true);
    try {
      const me = await firstValueFrom(this.api.updateMe(body));
      this.auth.setUser(me);
      this.resetProfile();
      this.toasts.show(this.t('profile.saved'), 'success');
      return { ok: true };
    } catch (err) {
      const problem = problemOf(err, this.t('profile.saveFailed'));
      if (problem.field && PROFILE_FIELDS.includes(problem.field)) {
        this.profileErrors.set({ [problem.field]: problem.detail });
      } else {
        this.profileError.set(problem.detail);
      }
      return { ok: false, message: problem.detail };
    } finally {
      this.saving.set(false);
    }
  }

  private async savePassword(): Promise<SaveResult> {
    if (!this.passwordDirty() || this.saving()) {
      return { ok: true };
    }
    this.currentError.set(null);
    this.passwordError.set(null);
    if (this.current() === '' || !this.passwordCheck().valid) {
      this.passwordError.set(this.t('password.notSaved'));
      if (this.current() === '') {
        this.currentError.set(this.t('password.currentRequired'));
      }
      return { ok: false, message: this.t('password.notSaved') };
    }
    this.saving.set(true);
    try {
      await firstValueFrom(this.session.changeOwnPassword(this.current(), this.next()));
      this.resetPassword();
      this.toasts.show(this.t('password.saved'), 'success');
      return { ok: true };
    } catch (err) {
      const problem = problemOf(err, this.t('password.saveFailed'));
      if (problem.field === 'currentPassword') {
        this.currentError.set(problem.detail);
      } else {
        this.passwordError.set(problem.errors.length > 0 ? problem.errors.join(' ') : problem.detail);
      }
      return { ok: false, message: problem.detail };
    } finally {
      this.saving.set(false);
    }
  }

  private resetProfile(): void {
    const saved = this.saved();
    this.displayName.set(saved.displayName);
    this.username.set(saved.username);
    this.email.set(saved.email);
    this.currentPassword.set('');
    this.profileErrors.set({});
    this.profileError.set(null);
  }

  private resetPassword(): void {
    this.current.set('');
    this.next.set('');
    this.confirm.set('');
    this.currentError.set(null);
    this.passwordError.set(null);
  }

  private t(key: string): string {
    return this.transloco.translate(`account.${key}`);
  }
}
