import { Injectable, computed, inject, signal } from '@angular/core';
import { UnsavedChangesService, type SaveResult } from '../../../../shared/components/dialog/unsaved-changes.service';
import { injectSampleNotice, injectSampleText } from '../changes/sample-area.util';
import { checkPassword, passwordProblems } from '../auth/auth-password.util';
import { AccountSection, PROFILE, ProfileForm } from './account-data';

export interface PasswordForm {
  readonly current: string;
  readonly next: string;
  readonly confirm: string;
}

const EMPTY_PASSWORD: PasswordForm = { current: '', next: '', confirm: '' };

/** Which Profile fields the last refused save complained about. */
export interface ProfileErrors {
  readonly displayName?: string;
  readonly email?: string;
  readonly currentPassword?: string;
}

/**
 * State of the sample's My account area (M35.16), provided by {@link SampleAccountAreaComponent} and shared by its
 * pages: the open section (mirrored in the URL by the area), the texts, and the drafts of the two explicit-save pages
 * (Profile and Password). Drafts live here, so switching sections keeps unsaved edits; Save only moves the draft into
 * the saved values (nothing leaves the browser). Preferences apply at once and have no draft.
 */
@Injectable()
export class AccountState {
  readonly section = signal<AccountSection>('profile');

  /** A `styleguide.sample.account.*` text. */
  readonly t = injectSampleText('styleguide.sample.account');
  private readonly toast = injectSampleNotice();
  private readonly unsaved = inject(UnsavedChangesService);

  // ── Profile ────────────────────────────────────────────────────────────────
  readonly profile = signal<ProfileForm>(PROFILE);
  readonly profileSaved = signal<ProfileForm>(PROFILE);
  /** The current password a changed username or email asks for. */
  readonly profilePassword = signal('');
  readonly profileErrors = signal<ProfileErrors>({});
  readonly profileDirty = computed(() => {
    const a = this.profile();
    const b = this.profileSaved();
    return a.displayName !== b.displayName || a.username !== b.username || a.email !== b.email;
  });
  /** Changing the username or the email needs the current password. */
  readonly needsCurrentPassword = computed(() => {
    const a = this.profile();
    const b = this.profileSaved();
    return a.username !== b.username || a.email !== b.email;
  });

  // ── Password ───────────────────────────────────────────────────────────────
  readonly password = signal<PasswordForm>(EMPTY_PASSWORD);
  /** How many things the last refused password save complained about (0: none); the save status shows it. */
  readonly passwordErrors = signal(0);
  readonly passwordCheck = computed(() => checkPassword(this.password().next, this.password().confirm));
  readonly passwordDirty = computed(() => {
    const p = this.password();
    return p.current !== '' || p.next !== '' || p.confirm !== '';
  });

  /** Every action that would change something says so instead. */
  notice(key: string, params?: Record<string, unknown>): void {
    this.toast(this.t(key, params));
  }

  dirtyOf(section: AccountSection): boolean {
    return section === 'profile' ? this.profileDirty() : section === 'password' ? this.passwordDirty() : false;
  }

  /** Saves a page's draft; a refusal keeps the person on the page (the save status says why). */
  saveSection(section: AccountSection): SaveResult {
    if (section === 'profile') {
      return this.saveProfile();
    }
    if (section === 'password') {
      return this.savePassword();
    }
    return { ok: true };
  }

  discardSection(section: AccountSection): void {
    if (section === 'profile') {
      this.profile.set(this.profileSaved());
      this.profilePassword.set('');
      this.profileErrors.set({});
    } else if (section === 'password') {
      this.password.set(EMPTY_PASSWORD);
      this.passwordErrors.set(0);
    }
  }

  /** Whether the open section may be left: nothing unsaved, or the person saved or discarded it. */
  async canLeaveSection(): Promise<boolean> {
    const section = this.section();
    if (!this.dirtyOf(section)) {
      return true;
    }
    return this.unsaved.confirmLeave({
      name: `${this.t('title')} › ${this.t(`sections.${section}`)}`,
      save: async () => this.saveSection(section),
      discard: () => this.discardSection(section),
    });
  }

  open(section: AccountSection): void {
    this.section.set(section);
  }

  private saveProfile(): SaveResult {
    const p = this.profile();
    const errors: { displayName?: string; email?: string; currentPassword?: string } = {};
    if (p.displayName.trim() === '') {
      errors.displayName = this.t('profile.nameRequired');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) {
      errors.email = this.t('profile.emailInvalid');
    }
    if (this.needsCurrentPassword() && this.profilePassword() === '') {
      errors.currentPassword = this.t('profile.currentRequired');
    }
    this.profileErrors.set(errors);
    if (Object.keys(errors).length > 0) {
      return { ok: false, message: this.t('profile.notSaved') };
    }
    this.profileSaved.set(p);
    this.profilePassword.set('');
    return { ok: true };
  }

  private savePassword(): SaveResult {
    const p = this.password();
    const problems = (p.current === '' ? 1 : 0) + passwordProblems(this.passwordCheck());
    this.passwordErrors.set(problems);
    if (problems > 0) {
      return { ok: false, message: this.t('password.notSaved') };
    }
    this.password.set(EMPTY_PASSWORD);
    return { ok: true };
  }
}
