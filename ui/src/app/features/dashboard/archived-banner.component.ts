import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';

/**
 * Tells everyone in an archived project that it is read-only (M26), and lets an instance admin unarchive it right
 * there. Renders nothing for a project that isn't archived.
 */
@Component({
  selector: 'sf-archived-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (access.archived()) {
      <div class="archived" role="status">
        <span class="archived__label">This project is archived and read-only.</span>
        @if (auth.isInstanceAdmin()) {
          <button class="archived__action" type="button" [disabled]="unarchiving()" (click)="unarchive()">
            {{ unarchiving() ? 'Unarchiving…' : 'Unarchive' }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    .archived {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sf-3);
      padding: var(--sf-2) var(--sf-4);
      background: color-mix(in srgb, var(--sf-slate) 12%, transparent);
      border-bottom: 1px solid var(--sf-line);
    }
    .archived__label {
      font-size: var(--sf-text-sm);
      color: var(--sf-ink);
      font-weight: 500;
    }
    .archived__action {
      padding: var(--sf-1) var(--sf-3);
      border: 1px solid var(--sf-line);
      border-radius: var(--sf-radius-md);
      background: var(--sf-surface);
      color: var(--sf-ink);
      font: inherit;
      font-size: var(--sf-text-sm);
      cursor: pointer;
    }
    .archived__action:hover:not(:disabled) {
      border-color: var(--sf-signal);
    }
  `,
})
export class ArchivedBannerComponent {
  protected readonly access = inject(ProjectAccessStore);
  protected readonly auth = inject(AuthStore);
  private readonly api = inject(ApiClient);
  private readonly context = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);

  readonly projectKey = input.required<string | null>();

  protected readonly unarchiving = signal(false);

  protected unarchive(): void {
    const key = this.projectKey();
    if (!key || this.unarchiving()) {
      return;
    }
    this.unarchiving.set(true);
    this.api.unarchiveProject(key).subscribe({
      next: () => {
        this.unarchiving.set(false);
        this.context.loadFor(key, true).subscribe();
        this.toasts.show('The project is active again.', 'success');
      },
      error: () => this.unarchiving.set(false),
    });
  }
}
