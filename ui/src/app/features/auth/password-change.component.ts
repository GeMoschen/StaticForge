import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { SfFieldComponent } from '../../shared/components/sf-field.component';

@Component({
  selector: 'sf-password-change',
  standalone: true,
  imports: [ReactiveFormsModule, SfFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './password-change.component.html',
  styleUrl: './password-change.component.scss',
})
export class PasswordChangeComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  protected readonly submitting = signal(false);
  protected readonly mismatch = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', Validators.required],
    confirmPassword: ['', Validators.required],
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    const { currentPassword, newPassword, confirmPassword } = this.form.getRawValue();

    if (newPassword !== confirmPassword) {
      this.mismatch.set(true);
      return;
    }
    this.mismatch.set(false);
    this.submitting.set(true);

    this.api.changePassword(currentPassword, newPassword).subscribe({
      next: () => {
        this.submitting.set(false);
        this.form.reset();
        this.toasts.show('Password updated.', 'success');
      },
      error: () => {
        this.submitting.set(false);
      },
    });
  }
}
