import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SfAvatarComponent } from '../../shared/components/display/sf-avatar.component';
import { SfStatusComponent, SfStatusTone } from '../../shared/components/display/sf-status.component';
import { SfTagComponent } from '../../shared/components/display/sf-tag.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfVisualDiffComponent } from '../revisions/visual-diff/visual-diff.component';
import { HistoryActions } from './history-actions.service';
import { HISTORY_KIND_ICONS } from './history-model';
import { HistoryAssetRef, HistoryRow, formatRevisionTime, summaryOf } from './history-rows';
import { HistoryService } from './history.service';
import type { components } from '../../core/api/generated/schema.d.ts';

type RevisionDiff = components['schemas']['RevisionDiff'];
type AssetDiff = components['schemas']['AssetDiff'];

const ACTION_TONES: Readonly<Record<string, SfStatusTone>> = {
  create: 'info',
  created: 'info',
  update: 'warning',
  changed: 'warning',
  delete: 'danger',
  deleted: 'danger',
  release: 'success',
  released: 'success',
  restore: 'neutral',
  restored: 'neutral',
};
const ACTION_ICONS: Readonly<Record<string, string>> = {
  create: 'fiber_new',
  created: 'fiber_new',
  update: 'edit_note',
  changed: 'edit_note',
  delete: 'delete_forever',
  deleted: 'delete_forever',
  release: 'publish',
  released: 'publish',
  restore: 'restore',
  restored: 'restore',
};
const TYPE_ICONS: Readonly<Record<string, string>> = {
  PAGE: 'description',
  RECORD: 'table_rows',
  MEDIA: 'image',
  GLOBAL_SET: 'tune',
  NAVIGATION: 'link',
  PAGE_TEMPLATE: 'code_blocks',
  SECTION_TEMPLATE: 'code_blocks',
  DATASET: 'dataset',
  FOLDER: 'folder',
};

/**
 * The detail pane of the History page (M35.12, signed off in the style guide): the revision's number (the pane's h2),
 * its time, author and kind, then **the items it changed, by name** — each with its type, what happened, the languages
 * and the field changes as a diff (old −, new +). Actions: **View this state** (time travel), **Restore this item**
 * per item (confirm, then Undo) and **Roll back project…** (danger, typed project key, project admins only).
 */
@Component({
  selector: 'sf-history-revision',
  standalone: true,
  imports: [
    SfAvatarComponent,
    SfButtonComponent,
    SfIconComponent,
    SfSpinnerComponent,
    SfStatusComponent,
    SfTagComponent,
    SfVisualDiffComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './history-revision.component.html',
  styleUrl: './history-revision.component.scss',
  host: { role: 'region', 'aria-labelledby': 'history-rev-title' },
})
export class HistoryRevisionComponent {
  readonly projectKey = input.required<string>();
  readonly revision = input.required<HistoryRow>();
  readonly closed = output<void>();

  private readonly service = inject(HistoryService);
  private readonly actions = inject(HistoryActions);
  private readonly transloco = inject(TranslocoService);
  private readonly permissions = inject(ProjectPermissionsStore);
  protected readonly archived = inject(ProjectAccessStore).archived;

  protected readonly kindIcons = HISTORY_KIND_ICONS;
  protected readonly diff = signal<RevisionDiff | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

  protected readonly when = computed(() => formatRevisionTime(this.revision().at));
  protected readonly summary = computed(() => summaryOf(this.revision(), (key, params) => this.t(key, params)));
  // Restores are exempt from the time-travel write block, so these follow the role, not `canEditContent` / `canAdminProject`.
  protected readonly canRollBack = this.permissions.isProjectAdmin;
  protected readonly canRestore = this.permissions.isEditor;

  /** The diff's items with the name people know them by (from the revision's summary). */
  protected readonly items = computed(() => {
    const byUuid = new Map(this.revision().assets.map((a) => [a.uuid, a]));
    return (this.diff()?.assets ?? []).map((asset) => ({ asset, ref: byUuid.get(asset.uuid ?? null) ?? null }));
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const id = this.revision().id;
      untracked(() => this.load(key, id));
    }, { allowSignalWrites: true });
  }

  protected tone(action: string | undefined): SfStatusTone {
    return ACTION_TONES[(action ?? '').toLowerCase()] ?? 'neutral';
  }

  protected actionIcon(action: string | undefined): string {
    return ACTION_ICONS[(action ?? '').toLowerCase()] ?? 'edit_note';
  }

  protected typeIcon(type: string | undefined): string {
    return TYPE_ICONS[(type ?? '').toUpperCase()] ?? 'description';
  }

  protected actionLabel(action: string | undefined): string {
    const known = ['created', 'changed', 'deleted', 'released', 'restored'];
    const a = (action ?? '').toLowerCase();
    const mapped = a === 'create' ? 'created' : a === 'update' ? 'changed' : a === 'delete' ? 'deleted' : a === 'release' ? 'released' : a === 'restore' ? 'restored' : a;
    return this.t(`actions.${known.includes(mapped) ? mapped : 'changed'}`);
  }

  protected nameOf(item: { asset: AssetDiff; ref: HistoryAssetRef | null }): string {
    return item.ref?.name ?? item.asset.uid ?? item.asset.uuid?.slice(0, 8) ?? '';
  }

  protected view(): void {
    this.actions.view(this.revision());
  }

  protected rollBack(): void {
    void this.actions.rollBack(this.revision());
  }

  protected restore(item: { asset: AssetDiff; ref: HistoryAssetRef | null }): void {
    const ref: HistoryAssetRef = item.ref ?? {
      uuid: item.asset.uuid ?? null,
      uid: item.asset.uid ?? null,
      name: this.nameOf(item),
      type: item.asset.type ?? '',
      action: (item.asset.action ?? '').toLowerCase(),
      locales: [],
    };
    void this.actions.restoreAsset(this.revision(), ref);
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`history.${key}`, params);
  }

  private load(key: string, id: number): void {
    this.diff.set(null);
    this.failed.set(false);
    this.loading.set(true);
    this.service.revisionDiff(key, id).subscribe({
      next: (diff) => {
        if (this.revision().id === id) {
          this.diff.set(diff);
          this.loading.set(false);
        }
      },
      error: () => {
        if (this.revision().id === id) {
          this.loading.set(false);
          this.failed.set(true);
        }
      },
    });
  }
}
