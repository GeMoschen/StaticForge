import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { UserMenuComponent } from '../account/user-menu.component';

type ProjectSummary = components['schemas']['ProjectSummary'];

@Component({
  selector: 'sf-dashboard',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfSpinnerComponent,
    UserMenuComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly projects = signal<ProjectSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly query = signal('');

  readonly formOpen = signal(false);
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);

  readonly isAdmin = computed(() => this.auth.systemRole() === 'INSTANCE_ADMIN');

  readonly form = this.fb.nonNullable.group({
    key: ['', Validators.required],
    name: ['', Validators.required],
    description: [''],
  });

  readonly searchActive = computed(() => this.projects().length > 12);

  readonly filtered = computed<ProjectSummary[]>(() => {
    const q = this.query().trim().toLowerCase();
    const projects = this.projects();
    if (!q) {
      return projects;
    }
    return projects.filter(
      (p) =>
        (p.key ?? '').toLowerCase().includes(q) ||
        (p.name ?? '').toLowerCase().includes(q),
    );
  });

  constructor() {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listProjects().subscribe({
      next: (projects) => {
        this.projects.set(projects ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load projects — check your connection and try again.');
        this.loading.set(false);
      },
    });
  }

  openCreate(): void {
    this.formError.set(null);
    this.form.reset({ key: '', name: '', description: '' });
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.formError.set(null);
  }

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    const value = this.form.getRawValue();
    this.submitting.set(true);
    this.formError.set(null);

    this.api
      .createProject({
        key: value.key.trim(),
        name: value.name.trim(),
        description: value.description.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.closeForm();
          this.toasts.show('Project created', 'success');
          this.reload();
          // The access token's embedded `projects` claim (what the `/p/:projectKey`
          // route guard checks) is baked in at token-issue time and doesn't include
          // the new project yet. `/auth/me` just re-decodes that same stale token, so
          // it can't help — only minting a fresh token via `/auth/refresh` (which
          // re-reads current project memberships from the DB) picks up the new role.
          this.api.refresh().subscribe({
            next: (res) => this.auth.setSession(res),
            error: () => {
              /* the guard will still work after the next natural token refresh */
            },
          });
        },
        error: (err) => this.onSubmitError(err),
      });
  }

  onSearch(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.query.set(target.value);
  }

  trackProject(index: number, project: ProjectSummary): string {
    return project.key ?? project.name ?? `${index}`;
  }

  private onSubmitError(err: unknown): void {
    this.submitting.set(false);
    const e = err as {
      message?: string;
      error?: { detail?: string; message?: string };
    };
    this.formError.set(e?.error?.detail ?? e?.error?.message ?? e?.message ?? 'Could not create project — check the key is unique.');
  }
}
