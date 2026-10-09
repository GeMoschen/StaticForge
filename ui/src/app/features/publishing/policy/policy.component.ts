import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../../core/api/api.client';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { problemOf } from '../../../core/api/problem.util';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import type { PublishPermission } from '../../../core/project/publish-permissions';
import { ToastService } from '../../../core/ui/toast.service';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../shared/components/dialog/sf-dialog.component';
import { SfSwitchComponent } from '../../../shared/components/forms/sf-switch.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { formatInstant } from '../../schedules/zoned-time.util';
import { POLICY_SWITCHES, policyKey, samePolicy, togglePolicy } from './policy.util';

type FailingSchedule = components['schemas']['FailingSchedule'];

/**
 * Publishing › Policy (M35.24, gate decisions 27-30, 186-212): what **editors** may do to put content online, one card
 * "Publishing by editors" with four switches (developers and admins can always do all of it). Switching a base
 * permission off switches off what needs it and disables that switch ("Needs ..."). The save UX is a status (Saved /
 * Unsaved changes) with Discard and Save, enabled only when something changed. The shown state is the server's until
 * the admin changes a switch (lessons: no state written only by change handlers). Before saving, the impact check lists
 * the pending schedules the change would make fail; Save then asks. Only project admins change it, everyone else
 * reads it.
 */
@Component({
  selector: 'sf-publishing-policy',
  standalone: true,
  imports: [SfBannerComponent, SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfIconComponent, SfSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './policy.component.html',
  styleUrl: './policy.component.scss',
})
export class PublishingPolicyComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly context = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  protected readonly access = inject(ProjectAccessStore);
  private readonly permissions = inject(ProjectPermissionsStore);

  protected readonly switches = POLICY_SWITCHES;
  protected readonly policyKey = policyKey;
  protected readonly formatInstant = formatInstant;
  protected readonly editable = this.permissions.canAdminProject;

  /** The policy as the server last said; `null` until loaded. */
  private readonly saved = signal<string[] | null>(null);
  /** The admin's unsaved change; `null` while there is none. */
  private readonly draft = signal<string[] | null>(null);
  private readonly current = computed(() => this.draft() ?? this.saved() ?? []);
  protected readonly loaded = computed(() => this.saved() !== null);
  protected readonly dirty = computed(() => {
    const saved = this.saved();
    return saved !== null && !samePolicy(this.current(), saved);
  });
  protected readonly saving = signal(false);
  protected readonly loadError = signal(false);
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

  protected toggle(permission: PublishPermission, on: boolean): void {
    if (!this.editable() || this.isOn(permission) === on) {
      return;
    }
    this.errors.set([]);
    const next = togglePolicy(this.current(), permission, on);
    this.draft.set(samePolicy(next, this.saved() ?? []) ? null : next);
  }

  protected discard(): void {
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

  protected typeName(type: string | undefined): string {
    return this.transloco.translate(`release.schedule.kinds.${type}`);
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.policy.${key}`, params);
  }

  private commit(editor: string[]): void {
    this.api.updatePublishPolicy(this.projectKey(), { editor }).subscribe({
      next: (policy) => {
        this.saving.set(false);
        this.saved.set(policy.editor ?? []);
        this.draft.set(null);
        this.errors.set([]);
        this.toasts.show(this.t('savedToast'), 'success');
        // The caller's own permissions come with the project detail.
        this.context.refreshDetail();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const problem = problemOf(err, this.t('saveFailed'));
        this.errors.set(problem.errors.length > 0 ? problem.errors : [problem.detail]);
      },
    });
  }

  private load(projectKey: string): void {
    this.saved.set(null);
    this.draft.set(null);
    this.errors.set([]);
    this.loadError.set(false);
    this.api.publishPolicy(projectKey).subscribe({
      next: (policy) => this.saved.set(policy.editor ?? []),
      error: () => this.loadError.set(true),
    });
  }
}
