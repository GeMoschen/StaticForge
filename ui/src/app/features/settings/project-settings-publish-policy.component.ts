import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import type { PublishPermission } from '../../core/project/publish-permissions';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { formatInstant } from '../schedules/zoned-time.util';
import { typeLabel } from '../schedules/schedule.util';
import { POLICY_SWITCHES, policyLabel, samePolicy, togglePolicy } from './publish-policy.util';

type FailingSchedule = components['schemas']['FailingSchedule'];

/**
 * "Publishing by editors" (M28.3.2): the project's publish policy as four switches. Project admins change it; everyone
 * else sees it read-only. The shown state is the server's until the admin changes a switch (lessons: no state written
 * only by change handlers), Save is enabled only with a change, and before saving the impact check lists the pending
 * schedules the change would make fail.
 */
@Component({
  selector: 'sf-project-settings-publish-policy',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent],
  templateUrl: './project-settings-publish-policy.component.html',
  styleUrl: './project-settings-publish-policy.component.scss',
})
export class ProjectSettingsPublishPolicyComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly context = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);
  protected readonly permissions = inject(ProjectPermissionsStore);

  protected readonly switches = POLICY_SWITCHES;
  protected readonly label = policyLabel;
  protected readonly typeLabel = typeLabel;
  protected readonly formatInstant = formatInstant;

  /** The policy as the server last said; `null` until loaded. */
  private readonly saved = signal<string[] | null>(null);
  /** The admin's unsaved change; `null` while there is none. */
  private readonly draft = signal<string[] | null>(null);
  protected readonly current = computed(() => this.draft() ?? this.saved() ?? []);
  protected readonly loaded = computed(() => this.saved() !== null);
  protected readonly editable = this.permissions.canAdminProject;
  protected readonly dirty = computed(() => {
    const saved = this.saved();
    return saved !== null && !samePolicy(this.current(), saved);
  });
  protected readonly saving = signal(false);
  protected readonly errors = signal<string[]>([]);
  /** The schedules the change would make fail, while the confirmation is open. */
  protected readonly failing = signal<FailingSchedule[] | null>(null);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.load(key));
    });
  }

  protected isOn(permission: PublishPermission): boolean {
    return this.current().includes(permission);
  }

  /** A switch whose prerequisite is off can't be switched on. */
  protected isBlocked(requires: PublishPermission | undefined): boolean {
    return requires !== undefined && !this.isOn(requires);
  }

  protected toggle(permission: PublishPermission, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.errors.set([]);
    const next = togglePolicy(this.current(), permission, on);
    const saved = this.saved() ?? [];
    this.draft.set(samePolicy(next, saved) ? null : next);
  }

  protected reset(): void {
    this.draft.set(null);
    this.errors.set([]);
  }

  /** Checks the impact first; saves at once when nothing would fail, else asks. */
  protected save(): void {
    if (!this.dirty() || this.saving() || !this.editable()) {
      return;
    }
    const editor = this.current();
    this.saving.set(true);
    this.api.publishPolicyImpact(this.projectKey(), { editor }).subscribe({
      next: (impact) => {
        const failing = impact.failingSchedules ?? [];
        if (failing.length > 0) {
          this.saving.set(false);
          this.failing.set(failing);
        } else {
          this.commit(editor);
        }
      },
      error: () => this.saving.set(false),
    });
  }

  protected confirmSave(): void {
    this.failing.set(null);
    this.saving.set(true);
    this.commit(this.current());
  }

  protected cancelSave(): void {
    this.failing.set(null);
  }

  private commit(editor: string[]): void {
    this.api.updatePublishPolicy(this.projectKey(), { editor }).subscribe({
      next: (policy) => {
        this.saving.set(false);
        this.saved.set(policy.editor ?? []);
        this.draft.set(null);
        this.errors.set([]);
        this.toasts.show('Publishing by editors saved.', 'success');
        // The caller's own permissions come with the project detail.
        this.context.refreshDetail();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const problem = problemOf(err, 'Could not save the publishing settings — try again.');
        this.errors.set(problem.errors.length > 0 ? problem.errors : [problem.detail]);
      },
    });
  }

  private load(projectKey: string): void {
    this.saved.set(null);
    this.draft.set(null);
    this.errors.set([]);
    this.api.publishPolicy(projectKey).subscribe({
      next: (policy) => this.saved.set(policy.editor ?? []),
      error: () => this.errors.set(['Could not load the publishing settings — reload the page to try again.']),
    });
  }
}
