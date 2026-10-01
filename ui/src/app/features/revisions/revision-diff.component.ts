import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfVisualDiffComponent } from './visual-diff/visual-diff.component';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { COMPACTED_ASSET_RESTORE_NOTICE, COMPACTED_RESTORE_NOTICE } from './compaction.util';

type RevisionDiff = components['schemas']['RevisionDiff'];
type AssetDiff = components['schemas']['AssetDiff'];

/** What the user types to confirm a project rollback. */
const ROLLBACK_TOKEN = 'ROLLBACK';

@Component({
  selector: 'sf-revision-diff',
  standalone: true,
  imports: [SfButtonComponent, SfEmptyStateComponent, SfIconComponent, SfSpinnerComponent, SfVisualDiffComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './revision-diff.component.html',
  styleUrl: './revision-diff.component.scss',
})
export class RevisionDiffComponent {
  private readonly api = inject(ApiClient);
  private readonly confirms = inject(ConfirmService);
  private readonly injector = inject(Injector);
  private readonly toast = inject(ToastService);
  /** Restoring writes a revision: not in an archived project (M26). */
  protected readonly archived = inject(ProjectAccessStore).archived;

  readonly projectKey = input.required<string>();
  readonly revisionId = input.required<string>();


  protected readonly diff = signal<RevisionDiff | null>(null);
  protected readonly assets = computed<AssetDiff[]>(() => this.diff()?.assets ?? []);
  protected readonly revisionNumber = computed<number>(() => Number(this.revisionId()));
  /** The server's message for a compacted revision (M29.4.3), shown instead of an empty field diff. */
  protected readonly compactedMessage = computed(
    () => this.diff()?.message ?? 'Exact changes of this revision were compacted; the state at the end of the day is kept',
  );
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly restoring = signal(false);
  /** The compacted asset whose restore waits for confirmation. */
  protected readonly assetToConfirm = signal<AssetDiff | null>(null);
  protected readonly compactedAssetRestoreNotice = COMPACTED_ASSET_RESTORE_NOTICE;

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

  /**
   * Restores one asset. An asset whose change at this revision was compacted (`AssetDiff.compacted`) restores its
   * surviving end-of-day version, so that asks first; an exact one restores with one click.
   */
  protected restoreAsset(asset: AssetDiff): void {
    if (!asset.uuid || this.restoring()) {
      return;
    }
    if (asset.compacted) {
      this.assetToConfirm.set(asset);
      return;
    }
    this.doRestoreAsset(asset);
  }

  protected confirmAssetRestore(): void {
    const asset = this.assetToConfirm();
    this.assetToConfirm.set(null);
    if (asset) {
      this.doRestoreAsset(asset);
    }
  }

  protected cancelAssetRestore(): void {
    this.assetToConfirm.set(null);
  }

  private doRestoreAsset(asset: AssetDiff): void {
    if (!asset.uuid || this.restoring()) {
      return;
    }
    this.restoring.set(true);
    this.api
      .restoreAsset(this.projectKey(), asset.uuid, {
        fromRevision: Number(this.revisionId()),
      })
      .subscribe({
        next: (restored) => {
          this.restoring.set(false);
          // `compacted`: the exact version was compacted away, the surviving end-of-day version was restored.
          this.toast.show(
            restored?.compacted
              ? 'A new revision was created — the state at the end of that day was restored'
              : 'A new revision was created',
            'success',
          );
        },
        error: () => {
          this.restoring.set(false);
          this.toast.show('Could not restore asset — someone may have edited it since, try reloading.', 'error');
        },
      });
  }

  protected async requestRollback(): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: `Roll back to revision ${this.revisionId()}`,
      message:
        'Rolling back appends a new revision restoring the project state at this revision. Existing history is never rewritten.' +
        (this.diff()?.compacted ? ' ' + COMPACTED_RESTORE_NOTICE : ''),
      confirmLabel: 'Roll back',
      tone: 'danger',
      typeToConfirm: ROLLBACK_TOKEN,
      injector: this.injector,
    });
    if (confirmed) {
      this.rollBack();
    }
  }

  private rollBack(): void {
    if (this.restoring()) {
      return;
    }
    this.restoring.set(true);
    this.api
      .restoreProject(this.projectKey(), { toRevision: Number(this.revisionId()) })
      .subscribe({
        next: () => {
          this.restoring.set(false);
          this.toast.show('A new revision was created', 'success');
        },
        error: () => {
          this.restoring.set(false);
          this.toast.show('Could not roll back project — try again in a moment.', 'error');
        },
      });
  }
}
