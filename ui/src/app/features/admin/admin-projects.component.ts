import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';

type AdminProjectRow = components['schemas']['AdminProjectRow'];

/**
 * Administration → Projects (M26): every project with its member count and last change, archived ones included by
 * default; archive (read-only, hidden from members) and unarchive. New projects are still created on the dashboard.
 */
@Component({
  selector: 'sf-admin-projects',
  standalone: true,
  imports: [DatePipe, RouterLink, SfButtonComponent, SfSpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-projects.component.html',
  styleUrl: './admin-projects.component.scss',
})
export class AdminProjectsComponent {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);

  protected readonly projects = signal<AdminProjectRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly query = signal('');
  protected readonly showArchived = signal(true);
  protected readonly busyKey = signal<string | null>(null);

  /** Filtered on the client: the list is every project of the instance, loaded once. */
  protected readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.projects().filter(
      (p) =>
        (this.showArchived() || !p.archived) &&
        (q === '' ||
          [p.key, p.name, p.description].some((v) => (v ?? '').toLowerCase().includes(q))),
    );
  });

  constructor() {
    this.load();
  }

  protected archive(project: AdminProjectRow): void {
    const key = project.key;
    if (
      !key ||
      this.busyKey() ||
      !window.confirm(
        `Archive "${project.name ?? key}"? Its members lose access at once, and the project becomes read-only ` +
          'until it is unarchived. Published output stays as it is.',
      )
    ) {
      return;
    }
    this.run(key, this.api.archiveProject(key), `"${project.name ?? key}" was archived.`);
  }

  protected unarchive(project: AdminProjectRow): void {
    const key = project.key;
    if (!key || this.busyKey()) {
      return;
    }
    this.run(key, this.api.unarchiveProject(key), `"${project.name ?? key}" is active again.`);
  }

  private run(key: string, request: ReturnType<ApiClient['archiveProject']>, message: string): void {
    this.busyKey.set(key);
    request.subscribe({
      next: () => {
        this.busyKey.set(null);
        this.auth.setProjectArchived(key, !this.projects().find((p) => p.key === key)?.archived);
        this.toasts.show(message, 'success');
        this.load();
      },
      error: () => this.busyKey.set(null),
    });
  }

  private load(): void {
    this.loading.set(true);
    this.api.adminListProjects({ includeArchived: true }).subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
