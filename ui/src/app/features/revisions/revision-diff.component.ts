import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { DialogService } from '../../core/ui/dialog.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfVisualDiffComponent } from './visual-diff/visual-diff.component';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectAccessStore } from '../../core/project/project-access.store';

type RevisionDiff = components['schemas']['RevisionDiff'];
type AssetDiff = components['schemas']['AssetDiff'];

@Component({
  selector: 'sf-revision-diff',
  standalone: true,
  imports: [SfButtonComponent, SfEmptyStateComponent, SfSpinnerComponent, SfVisualDiffComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './revision-diff.component.html',
  styleUrl: './revision-diff.component.scss',
})
export class RevisionDiffComponent {
  private readonly api = inject(ApiClient);
  protected readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  /** Restoring writes a revision: not in an archived project (M26). */
  protected readonly archived = inject(ProjectAccessStore).archived;

  readonly projectKey = input.required<string>();
  readonly revisionId = input.required<string>();

  protected readonly ROLLBACK_TOKEN = 'ROLLBACK';

  protected readonly diff = signal<RevisionDiff | null>(null);
  protected readonly assets = computed<AssetDiff[]>(() => this.diff()?.assets ?? []);
  protected readonly revisionNumber = computed<number>(() => Number(this.revisionId()));
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly restoring = signal(false);
  protected readonly confirmText = signal('');

  constructor() {
    effect(
      () => {
        const key = this.projectKey();
        const revisionId = this.revisionId();
        if (!key || !revisionId) {
          return;
        }
        this.load(key, revisionId);
      },
      { allowSignalWrites: true },
    );
  }

  private load(key: string, revisionId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .revisionDiff(key, Number(revisionId))
      .subscribe({
        next: (d) => {
          this.diff.set(d);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Could not load diff — check your connection and try again.');
        },
      });
  }

  protected restoreAsset(asset: AssetDiff): void {
    if (!asset.uuid || this.restoring()) {
      return;
    }
    this.restoring.set(true);
    this.api
      .restoreAsset(this.projectKey(), asset.uuid, {
        fromRevision: Number(this.revisionId()),
      })
      .subscribe({
        next: () => {
          this.restoring.set(false);
          this.toast.show('A new revision was created', 'success');
        },
        error: () => {
          this.restoring.set(false);
          this.toast.show('Could not restore asset — someone may have edited it since, try reloading.', 'error');
        },
      });
  }

  protected requestRollback(): void {
    this.confirmText.set('');
    this.dialog.open({
      title: `Roll back to revision ${this.revisionId()}`,
      message: 'Rolling back appends a new revision restoring the project state at this revision. Existing history is never rewritten. Type ROLLBACK to confirm.',
      confirmLabel: 'Roll back',
      cancelLabel: 'Cancel',
      kind: 'danger',
    });
  }

  protected cancelRollback(): void {
    this.dialog.close();
    this.confirmText.set('');
  }

  protected onConfirmInput(event: Event): void {
    this.confirmText.set((event.target as HTMLInputElement).value);
  }

  protected confirmRollback(): void {
    if (this.confirmText().trim() !== this.ROLLBACK_TOKEN || this.restoring()) {
      return;
    }
    this.restoring.set(true);
    this.api
      .restoreProject(this.projectKey(), { toRevision: Number(this.revisionId()) })
      .subscribe({
        next: () => {
          this.restoring.set(false);
          this.dialog.close();
          this.confirmText.set('');
          this.toast.show('A new revision was created', 'success');
        },
        error: () => {
          this.restoring.set(false);
          this.toast.show('Could not roll back project — try again in a moment.', 'error');
        },
      });
  }
}
