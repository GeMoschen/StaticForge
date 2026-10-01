import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { AuthStore } from '../../core/auth/auth.store';
import { projectRoleLabel } from '../../core/auth/roles';
import { SessionService } from '../../core/auth/session.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { OwnPasswordFormComponent } from './own-password-form.component';

type UpdateMeRequest = components['schemas']['UpdateMeRequest'];

type ProfileField = 'displayName' | 'username' | 'email' | 'currentPassword';

const PROFILE_FIELDS: readonly string[] = ['displayName', 'username', 'email', 'currentPassword'];

/**
 * My account (M26): the profile (display name; username and email need the current password), the password,
 * the user's projects, and signing out everywhere.
 */
@Component({
  selector: 'sf-account',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    SfButtonComponent,
    SfFieldComponent,
    OwnPasswordFormComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account.component.html',
  styleUrl: './account.component.scss',
})
export class AccountComponent implements AfterViewInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly session = inject(SessionService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly memberships = this.auth.memberships;
  protected readonly roleLabel = projectRoleLabel;

  /** What the server has now: the baseline for "dirty". */
  private readonly saved = computed(() => ({
    displayName: this.auth.displayName() ?? '',
    username: this.auth.username() ?? '',
    email: this.auth.email() ?? '',
  }));

  protected readonly form = this.fb.nonNullable.group({
    displayName: [''],
    username: [''],
    email: [''],
    currentPassword: [''],
  });
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  /** Username or email changed: the server wants the current password for that. */
  protected readonly needsCurrentPassword = computed(() => {
    const v = this.value();
    const saved = this.saved();
    return (v.username ?? '').trim() !== saved.username || (v.email ?? '').trim() !== saved.email;
  });
  protected readonly dirty = computed(
    () => this.needsCurrentPassword() || (this.value().displayName ?? '').trim() !== this.saved().displayName,
  );
  protected readonly valid = computed(() => {
    const v = this.value();
    return (
      (v.username ?? '').trim() !== '' &&
      (v.email ?? '').trim() !== '' &&
      (!this.needsCurrentPassword() || (v.currentPassword ?? '') !== '')
    );
  });

  protected readonly saving = signal(false);
  protected readonly fieldErrors = signal<Partial<Record<ProfileField, string>>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly signingOutEverywhere = signal(false);

  constructor() {
    this.resetForm();
    // The email and the memberships aren't in the token: read the profile fresh.
    this.session.reloadUser().subscribe({ next: () => this.resetForm(), error: () => undefined });
  }

  ngAfterViewInit(): void {
    if (this.route.snapshot.fragment === 'password') {
      this.host.nativeElement.querySelector('#password')?.scrollIntoView?.({ block: 'start' });
    }
  }

  protected saveProfile(): void {
    if (!this.dirty() || !this.valid() || this.saving()) {
      return;
    }
    const v = this.form.getRawValue();
    const body: UpdateMeRequest = {
      displayName: v.displayName.trim(),
      username: v.username.trim(),
      email: v.email.trim(),
    };
    if (this.needsCurrentPassword()) {
      body.currentPassword = v.currentPassword;
    }
    this.saving.set(true);
    this.fieldErrors.set({});
    this.error.set(null);
    this.api.updateMe(body).subscribe({
      next: (me) => {
        this.auth.setUser(me);
        this.saving.set(false);
        this.resetForm();
        this.toasts.show('Profile saved.', 'success');
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const problem = problemOf(err, 'The profile could not be saved.');
        if (problem.field && PROFILE_FIELDS.includes(problem.field)) {
          this.fieldErrors.set({ [problem.field as ProfileField]: problem.detail });
        } else {
          this.error.set(problem.detail);
        }
      },
    });
  }

  protected discard(): void {
    this.fieldErrors.set({});
    this.error.set(null);
    this.resetForm();
  }

  protected passwordChanged(): void {
    this.toasts.show('Password changed. Every other session has been signed out.', 'success');
  }

  protected signOutEverywhere(): void {
    if (
      this.signingOutEverywhere() ||
      !window.confirm('Sign out of every session, on every device, including this one?')
    ) {
      return;
    }
    this.signingOutEverywhere.set(true);
    this.session.signOutEverywhere().subscribe({
      error: () => this.signingOutEverywhere.set(false),
    });
  }

  private resetForm(): void {
    this.form.reset({ ...this.saved(), currentPassword: '' });
  }
}
