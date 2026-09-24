import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';

type AffectedTemplate = components['schemas']['AffectedTemplate'];

interface UidWarning {
  oldUid: string;
  affected: AffectedTemplate[];
}

@Component({
  selector: 'sf-uid-rename',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-uid-rename.component.html',
  styleUrl: './sf-uid-rename.component.scss',
})
export class SfUidRenameComponent {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();
  readonly uid = input.required<string>();

  readonly uidChanged = output<string>();

  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  private readonly access = inject(ProjectAccessStore);

  /** Shared UID-rename affordance used from every editor surface (pages, templates,
   * navigation, media) — gating it here once covers all of them without threading a
   * `readOnly` input through each parent. Time travel or an archived project (M26). */
  protected readonly readOnly = this.access.readOnly;
  protected readonly readOnlyReason = computed(() =>
    this.access.archived()
      ? 'This project is archived and read-only.'
      : this.readOnly()
        ? 'Viewing a past revision — exit time travel to make changes'
        : '',
  );

  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly draft = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly warning = signal<UidWarning | null>(null);

  private static readonly UID_PATTERN = /^[a-z0-9_]+$/;

  protected startEdit(): void {
    if (this.readOnly()) {
      return;
    }
    this.draft.set(this.uid());
    this.error.set(null);
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
    this.draft.set('');
    this.error.set(null);
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected submit(): void {
    if (this.saving() || this.readOnly()) {
      return;
    }
    const next = this.draft().trim();
    if (!SfUidRenameComponent.UID_PATTERN.test(next)) {
      this.error.set('Use lowercase letters, numbers, and underscores only');
      return;
    }
    if (next === this.uid()) {
      this.cancelEdit();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api
      .changeUid(this.projectKey(), this.uuid(), { uid: next })
      .subscribe({
        next: (result) => {
          const affected = result.affectedTemplates ?? [];
          this.toasts.show('UID changed', 'success');
          this.editing.set(false);
          this.saving.set(false);
          this.draft.set('');
          this.uidChanged.emit(result.newUid ?? next);
          if (affected.length > 0) {
            this.warning.set({
              oldUid: result.oldUid ?? this.uid(),
              affected,
            });
          }
        },
        error: () => {
          this.saving.set(false);
          this.toasts.show('Could not change UID — it may already be used by another asset.', 'error');
        },
      });
  }
}
