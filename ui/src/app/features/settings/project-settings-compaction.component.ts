import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfFileSizePipe } from '../../shared/pipes/sf-file-size.pipe';
import { formatInstant } from '../schedules/zoned-time.util';

type CompactionPolicyView = components['schemas']['CompactionPolicyView'];
type CompactionEstimateView = components['schemas']['CompactionEstimateView'];

/** The server's rule (`SF-DOM-0183`): compaction never touches the last 30 days. */
export const MIN_OLDER_THAN_DAYS = 30;
/** What the server stores for a project that never set a value. */
const DEFAULT_OLDER_THAN_DAYS = 90;

/** The confirmation dialog: enabling, or lowering `olderThanDays` while enabled — both remove versions for good. */
interface Confirmation {
  days: number;
  lowering: boolean;
}

/**
 * "Revision compaction" (M29.5.2, epic decision 13): the project's opt-in compaction policy. Every member sees what it
 * does and how far history is compacted; project admins see and change the policy (the server lets only them read it),
 * read-only while the project is archived or in time travel. Enabling, or lowering the age while enabled, shows the
 * dry-run estimate and asks for the project key; disabling is one click.
 */
@Component({
  selector: 'sf-project-settings-compaction',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfFieldComponent, SfFileSizePipe],
  templateUrl: './project-settings-compaction.component.html',
  styleUrl: './project-settings-compaction.component.scss',
})
export class ProjectSettingsCompactionComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly context = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);
  private readonly permissions = inject(ProjectPermissionsStore);

  protected readonly minDays = MIN_OLDER_THAN_DAYS;
  protected readonly formatInstant = formatInstant;

  /** Project admins read the policy (also in an archived project); only a writable project lets them change it. */
  protected readonly canRead = this.permissions.readsAsProjectAdmin;
  protected readonly editable = this.permissions.canAdminProject;

  /** The policy as the server last said; `null` until loaded (and for members who can't read it). */
  protected readonly saved = signal<CompactionPolicyView | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** The admin's unsaved "older than" text; `null` while untouched (lessons: model the shown default explicitly). */
  private readonly daysText = signal<string | null>(null);
  protected readonly daysValue = computed(
    () => this.daysText() ?? String(this.saved()?.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS),
  );
  /** The entered age in days, or `null` when it isn't a whole number of at least 30. */
  protected readonly days = computed(() => {
    const text = this.daysValue().trim();
    if (!/^\d+$/.test(text)) {
      return null;
    }
    const value = Number(text);
    return value >= MIN_OLDER_THAN_DAYS ? value : null;
  });
  protected readonly daysInvalid = computed(() => this.days() === null);
  protected readonly enabled = computed(() => this.saved()?.enabled === true);
  /** An enabled policy whose age the admin changed: Save applies it. */
  protected readonly dirty = computed(() => {
    const saved = this.saved();
    return saved !== null && this.enabled() && this.days() !== null && this.days() !== saved.olderThanDays;
  });
  protected readonly compactedThrough = computed(
    () => this.saved()?.compactedThrough ?? this.context.project()?.compactedThrough ?? null,
  );
  protected readonly lastRun = computed(() => this.saved()?.lastRun ?? null);

  protected readonly saving = signal(false);
  protected readonly errors = signal<string[]>([]);

  protected readonly confirmation = signal<Confirmation | null>(null);
  protected readonly estimate = signal<CompactionEstimateView | null>(null);
  protected readonly estimateError = signal<string | null>(null);
  protected readonly confirmText = signal('');
  /** The confirmation needs the exact project key, as the server does. */
  protected readonly confirmMatches = computed(() => this.confirmText() === this.projectKey());

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const canRead = this.canRead();
      untracked(() => this.load(key, canRead));
    });
  }

  protected onDaysInput(event: Event): void {
    this.daysText.set((event.target as HTMLInputElement).value);
    this.errors.set([]);
  }

  /** Opens the confirmation with the estimate for the entered age. */
  protected requestEnable(): void {
    const days = this.days();
    if (days === null || !this.editable() || this.saving()) {
      return;
    }
    this.openConfirmation({ days, lowering: false });
  }

  /** Applies a changed age: raising saves at once, lowering removes more history and asks first. */
  protected saveDays(): void {
    const days = this.days();
    const saved = this.saved();
    if (days === null || saved === null || !this.dirty() || !this.editable() || this.saving()) {
      return;
    }
    if (days < (saved.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS)) {
      this.openConfirmation({ days, lowering: true });
    } else {
      this.commit({ enabled: true, olderThanDays: days }, undefined, 'Compaction age saved.');
    }
  }

  protected discardDays(): void {
    this.daysText.set(null);
    this.errors.set([]);
  }

  /** Disabling removes nothing, so it needs no confirmation. */
  protected disable(): void {
    if (!this.editable() || this.saving() || !this.enabled()) {
      return;
    }
    this.daysText.set(null);
    this.commit({ enabled: false }, undefined, 'Compaction disabled.');
  }

  protected onConfirmInput(event: Event): void {
    this.confirmText.set((event.target as HTMLInputElement).value);
  }

  protected confirm(): void {
    const confirmation = this.confirmation();
    if (confirmation === null || !this.confirmMatches() || this.saving()) {
      return;
    }
    this.commit(
      { enabled: true, olderThanDays: confirmation.days },
      this.confirmText(),
      confirmation.lowering ? 'Compaction age saved.' : 'Compaction enabled.',
    );
  }

  protected cancelConfirmation(): void {
    this.confirmation.set(null);
    this.confirmText.set('');
    this.estimate.set(null);
    this.estimateError.set(null);
  }

  private openConfirmation(confirmation: Confirmation): void {
    this.errors.set([]);
    this.confirmText.set('');
    this.estimate.set(null);
    this.estimateError.set(null);
    this.confirmation.set(confirmation);
    this.api.compactionEstimate(this.projectKey(), confirmation.days).subscribe({
      next: (estimate) => {
        if (this.confirmation() === confirmation) {
          this.estimate.set(estimate);
        }
      },
      error: (err: unknown) => {
        if (this.confirmation() === confirmation) {
          this.estimateError.set(problemOf(err, 'Could not estimate what compaction would remove.').detail);
        }
      },
    });
  }

  private commit(body: components['schemas']['CompactionPolicyRequest'], confirm: string | undefined, done: string): void {
    this.saving.set(true);
    this.errors.set([]);
    this.api.updateCompactionPolicy(this.projectKey(), body, confirm).subscribe({
      next: (policy) => {
        this.saving.set(false);
        this.saved.set(policy);
        this.daysText.set(null);
        this.cancelConfirmation();
        this.toasts.show(done, 'success');
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const problem = problemOf(err, 'Could not save the compaction setting — try again.');
        const messages = problem.errors.length > 0 ? problem.errors : [problem.detail];
        if (this.confirmation() !== null) {
          this.estimateError.set(messages.join(' '));
        } else {
          this.errors.set(messages);
        }
      },
    });
  }

  private load(projectKey: string, canRead: boolean): void {
    this.saved.set(null);
    this.daysText.set(null);
    this.errors.set([]);
    this.loadError.set(null);
    this.cancelConfirmation();
    if (!canRead) {
      return;
    }
    this.api.compactionPolicy(projectKey).subscribe({
      next: (policy) => this.saved.set(policy),
      error: () => this.loadError.set('Could not load the compaction setting — reload the page to try again.'),
    });
  }
}
