import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';

/**
 * A generated password, shown exactly once (M26): the server never returns it again, and the page never keeps it
 * beyond this panel — the owner drops it when the panel is done.
 */
@Component({
  selector: 'sf-admin-one-time-password',
  standalone: true,
  imports: [SfButtonComponent, SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="otp" role="status">
      <p class="otp__warning">
        <sf-icon name="warning" />
        Copy this password now and give it to {{ username() }}. It won't be shown again.
      </p>
      <div class="otp__row">
        <code class="otp__password" aria-label="Generated password">{{ password() }}</code>
        <sf-button variant="secondary" (click)="copy()">{{ copied() ? 'Copied' : 'Copy' }}</sf-button>
      </div>
      <div class="otp__actions">
        <sf-button variant="primary" (click)="done.emit()">Done</sf-button>
      </div>
    </div>
  `,
  styles: `
    .otp {
      display: flex;
      flex-direction: column;
      gap: var(--sf-3);
    }
    .otp__warning {
      display: flex;
      align-items: flex-start;
      gap: var(--sf-2);
      margin: 0;
      padding: var(--sf-2) var(--sf-3);
      border-radius: var(--sf-radius-md);
      background: color-mix(in srgb, var(--sf-amber) 16%, transparent);
      color: var(--sf-ink);
      font-size: var(--sf-text-sm);
    }
    .otp__row {
      display: flex;
      align-items: center;
      gap: var(--sf-2);
    }
    .otp__password {
      flex: 1;
      padding: var(--sf-2) var(--sf-3);
      border: 1px solid var(--sf-line);
      border-radius: var(--sf-radius-md);
      background: var(--sf-paper);
      font-family: var(--sf-font-mono);
      font-size: var(--sf-text-md);
      user-select: all;
      word-break: break-all;
    }
    .otp__actions {
      display: flex;
      justify-content: flex-end;
    }
  `,
})
export class AdminOneTimePasswordComponent {
  readonly password = input.required<string>();
  readonly username = input('the user');
  readonly done = output<void>();

  protected readonly copied = signal(false);

  protected copy(): void {
    void navigator.clipboard?.writeText(this.password()).then(
      () => this.copied.set(true),
      () => undefined,
    );
  }
}
