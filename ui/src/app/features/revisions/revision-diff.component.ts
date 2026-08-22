import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { DialogService } from '../../core/ui/dialog.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfDiffComponent } from '../../shared/components/sf-diff.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import type { components } from '../../core/api/generated/schema.d.ts';

type RevisionDiff = components['schemas']['RevisionDiff'];
type AssetDiff = components['schemas']['AssetDiff'];

@Component({
  selector: 'sf-revision-diff',
  standalone: true,
  imports: [SfButtonComponent, SfDiffComponent, SfEmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './revision-diff.component.html',
  styleUrl: './revision-diff.component.scss',
})
export class RevisionDiffComponent implements OnInit {
  private readonly api = inject(ApiClient);
  protected readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  readonly projectKey = input.required<string>();
  readonly revisionId = input.required<string>();

  protected readonly ROLLBACK_TOKEN = 'ROLLBACK';

  protected readonly diff = signal<RevisionDiff | null>(null);
  protected readonly assets = computed<AssetDiff[]>(() => this.diff()?.assets ?? []);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly restoring = signal(false);
  protected readonly confirmText = signal('');

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .revisionDiff(this.projectKey(), Number(this.revisionId()))
      .subscribe({
        next: (d) => {
          this.diff.set(d);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.error.set('Failed to load diff');
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
          this.toast.show('Failed to restore asset', 'error');
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
          this.toast.show('Failed to roll back project', 'error');
        },
      });
  }
}
