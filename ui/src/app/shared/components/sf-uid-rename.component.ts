import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { tap } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';

type AffectedTemplate = components['schemas']['AffectedTemplate'];

interface UidWarning {
  oldUid: string;
  affected: AffectedTemplate[];
}

@Component({
  selector: 'sf-uid-rename',
  standalone: true,
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-uid-rename.component.html',
  styleUrl: './sf-uid-rename.component.scss',
})
export class SfUidRenameComponent {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();
  readonly uid = input.required<string>();

  /**
   * Offers Undo after a change instead of the plain "UID changed" toast (M35.13). Undo changes the UID back and emits
   * `uidChanged` with the old one, so a caller that reloads on `uidChanged` reloads for the undo too. Off by default:
   * callers that don't opt in see no difference.
   */
  readonly undoable = input(false);

  /**
   * Called with the old UID when Undo changed it back, also after this component is gone (a dialog that closed) — when
   * `uidChanged` can no longer be emitted. A caller that keeps showing the UID elsewhere refreshes from here.
   */
  readonly onUndone = input<((uid: string) => void) | null>(null);

  readonly uidChanged = output<string>();

  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly undo = inject(UndoService);
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  private readonly access = inject(ProjectAccessStore);

  /** Shared UID-rename affordance used from every editor surface (pages, templates,
   * navigation, media) — gating it here once covers all of them without threading a
   * `readOnly` input through each parent. Time travel or an archived project (M26). */
  protected readonly readOnly = this.access.readOnly;
  protected readonly readOnlyReason = computed(() =>
    this.access.archived()
      ? this.transloco.translate('shared.uidRename.archived')
      : this.readOnly()
        ? this.transloco.translate('shared.uidRename.timeTravel')
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
      this.error.set(this.transloco.translate('shared.uidRename.invalid'));
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
          const oldUid = result.oldUid ?? this.uid();
          const newUid = result.newUid ?? next;
          if (this.undoable()) {
            const key = this.projectKey();
            const uuid = this.uuid();
            this.undo.offer(this.transloco.translate('shared.uidRename.changedFrom', { old: oldUid, new: newUid }), () =>
              this.api.changeUid(key, uuid, { uid: oldUid }).pipe(
                // The component may be gone by then (its dialog closed): an emit on a destroyed output throws.
                tap(() => {
                  this.onUndone()?.(oldUid);
                  if (!this.destroyed) {
                    this.uidChanged.emit(oldUid);
                  }
                }),
              ),
            );
          } else {
            this.toasts.show(this.transloco.translate('shared.uidRename.changed'), 'success');
          }
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
          this.toasts.show(this.transloco.translate('shared.uidRename.changeFailed'), 'error');
        },
      });
  }
}
