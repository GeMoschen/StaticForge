import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiClient } from '../../core/api/api.client';
import { SfFieldComponent } from '../../shared/components/sf-field.component';

@Component({
  selector: 'sf-login',
  standalone: true,
  imports: [ReactiveFormsModule, SfFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authStore = inject(AuthStore);
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);

  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const { username, password } = this.form.getRawValue();

    this.api.login(username, password).subscribe({
      next: (res) => {
        this.authStore.setSession(res);
        this.authStore.loadUser(this.http).subscribe({
          next: () => this.redirect(),
          error: () => this.redirect(),
        });
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(this.messageOf(err));
      },
    });
  }

  private redirect(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    void this.router.navigateByUrl(
      returnUrl && returnUrl.startsWith('/') ? returnUrl : '/',
    );
  }

  private messageOf(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { detail?: string; title?: string } | undefined;
      if (body && typeof body === 'object') {
        if (err.status === 401) {
          return 'Invalid username or password.';
        }
        return body.detail ?? body.title ?? 'Invalid username or password.';
      }
      if (err.status === 401) {
        return 'Invalid username or password.';
      }
    }
    return 'Something went wrong.';
  }
}
