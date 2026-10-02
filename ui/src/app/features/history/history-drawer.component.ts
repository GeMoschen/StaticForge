import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SfDrawerComponent } from '../../shared/components/dialog/sf-drawer.component';
import { SfAvatarComponent } from '../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfTagComponent } from '../../shared/components/display/sf-tag.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfVisualDiffComponent } from '../revisions/visual-diff/visual-diff.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { HistoryActions } from './history-actions.service';
import { HistoryDrawerStore } from './history-drawer.store';
import { HistoryAuthor, HistoryFilterMenu, historyFilterMenus } from './history-filter-menus';
import { HISTORY_KIND_ICONS, HistoryFilter, NO_HISTORY_FILTER, isFiltered } from './history-model';
import { HistoryRow, assetNamesOf, summaryOf } from './history-rows';
import { AssetDiff, HistoryService } from './history.service';
import { HistoryRangeDialogComponent } from './history-range-dialog.component';

const PAGE_SIZE = 25;

/**
 * The History drawer (M35.12, signed off in the style guide). It opens from the top bar and starts below it.
 *
 * - **In an editor** (the open item reports an asset): that item's versions, newest first — the current one on top.
 *   Each shows the time, the author's name, a human summary and the languages touched. *View* time-travels to it,
 *   *Compare with current* opens the field diff under the entry, *Restore* confirms and offers Undo (not on the
 *   current version).
 * - **Elsewhere:** the project's timeline, filterable by author, type and date; entries name the changed items. *View*
 *   time-travels to the revision, *Details* opens it on the full history page.
 * - **Open full history** (footer) leads to `/p/:key/history`.
 */
@Component({
  selector: 'sf-history-drawer',
  standalone: true,
  imports: [
    HistoryRangeDialogComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDrawerComponent,
    SfIconComponent,
    SfMenuComponent,
    SfRelativeTimeComponent,
    SfSpinnerComponent,
    SfTagComponent,
    SfVisualDiffComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './history-drawer.component.html',
  styleUrl: './history-drawer.component.scss',
})
export class HistoryDrawerComponent {
  private readonly store = inject(HistoryDrawerStore);
  private readonly frame = inject(FrameContextStore);
  private readonly service = inject(HistoryService);
  private readonly actions = inject(HistoryActions);
  private readonly router = inject(Router);
  private readonly api = inject(ApiClient);
  private readonly transloco = inject(TranslocoService);
  private readonly auth = inject(AuthStore);
  /** A restore or roll-back (or a release) adds revisions: the list re-reads. */
  private readonly events = inject(ReleaseEventsStore);
  private readonly permissions = inject(ProjectPermissionsStore);

  protected readonly kindIcons = HISTORY_KIND_ICONS;
  protected readonly projectKey = this.frame.projectKey;
  /** The item whose versions are listed; `null`: the project's timeline. */
  protected readonly assetUuid = computed(() => this.frame.item()?.asset?.uuid ?? null);
  protected readonly itemName = computed(() => this.frame.item()?.label ?? '');
  protected readonly isProject = computed(() => this.assetUuid() === null);

  protected readonly filter = signal<HistoryFilter>(NO_HISTORY_FILTER);
  protected readonly rows = signal<readonly HistoryRow[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly authors = signal<readonly HistoryAuthor[]>([]);
  protected readonly rangeDialog = signal(false);
  /** The entry whose comparison with the current state is open, with its diff. */
  protected readonly comparing = signal<number | null>(null);
  protected readonly compareDiff = signal<AssetDiff | null>(null);
  protected readonly compareLoading = signal(false);

  private page = 0;
  private requested = 0;

  protected readonly filtered = computed(() => isFiltered(this.filter()));
  protected readonly canLoadMore = computed(() => this.rows().length < this.total());
  /** The newest version of the item is its current state. */
  protected readonly currentId = computed(() => (this.isProject() || this.filtered() ? null : (this.rows()[0]?.id ?? null)));
  // A restore is exempt from the time-travel write block, so this follows the role (lowered to viewer when archived).
  protected readonly canRestoreItem = this.permissions.isEditor;

  protected readonly title = computed(() => {
    return this.isProject() ? this.t('page.projectTitle') : this.t('page.itemTitle', { name: this.itemName() });
  });

  protected readonly menus = computed<HistoryFilterMenu[]>(() => {
    const f = this.filter();
    return historyFilterMenus(
      (key, params) => this.t(key, params),
      this.authors(),
      { by: f.by === null ? null : String(f.by), kind: f.kind, date: f.date },
      {
        by: (by) => this.filter.update((s) => ({ ...s, by: by === null ? null : Number(by) })),
        kind: (kind) => this.filter.update((s) => ({ ...s, kind })),
        date: (date) => this.filter.update((s) => ({ ...s, date })),
        custom: () => this.rangeDialog.set(true),
      },
    );
  });

  constructor() {
    effect(
      () => {
        const key = this.projectKey();
        this.assetUuid();
        this.filter();
        this.events.version();
        if (key) {
          untracked(() => this.reload(key));
        }
      },
      { allowSignalWrites: true },
    );
    effect(() => {
      const key = this.projectKey();
      if (key) {
        untracked(() =>
          this.api.listMembers(key).subscribe({
            next: (members) =>
              this.authors.set(members.map((m) => ({ id: String(m.userId), name: m.displayName || m.username || String(m.userId) }))),
          }),
        );
      }
    });
  }

  protected close(): void {
    this.store.close();
  }

  protected openFull(revision: number | null): void {
    const key = this.projectKey();
    this.store.close();
    void this.router.navigate(['/p', key ?? '', 'history'], { queryParams: revision === null ? {} : { rev: revision } });
  }

  protected clear(): void {
    this.filter.set(NO_HISTORY_FILTER);
  }

  protected applyRange(range: { from: string | null; to: string | null }): void {
    this.filter.update((f) => ({ ...f, date: { range: 'custom', from: range.from, to: range.to } }));
    this.rangeDialog.set(false);
  }

  protected loadMore(): void {
    const key = this.projectKey();
    if (key) {
      this.fetch(key, this.page + 1);
    }
  }

  protected view(row: HistoryRow): void {
    this.actions.view(row);
  }

  protected restore(row: HistoryRow): void {
    const asset = row.assets.find((a) => a.uuid === this.assetUuid());
    if (asset) {
      void this.actions.restoreAsset(row, asset, this.currentId() ?? undefined);
    }
  }

  protected toggleCompare(row: HistoryRow): void {
    const key = this.projectKey();
    const uuid = this.assetUuid();
    if (this.comparing() === row.id || !key || !uuid) {
      this.comparing.set(null);
      this.compareDiff.set(null);
      return;
    }
    this.comparing.set(row.id);
    this.compareDiff.set(null);
    this.compareLoading.set(true);
    this.service.assetDiff(key, uuid, row.id).subscribe({
      next: (diff) => {
        this.compareDiff.set(diff);
        this.compareLoading.set(false);
      },
      error: () => {
        this.compareLoading.set(false);
        this.comparing.set(null);
      },
    });
  }

  protected summary(row: HistoryRow): string {
    return summaryOf(row, (key, params) => this.t(key, params));
  }

  protected names(row: HistoryRow): { names: string; more: number } {
    return assetNamesOf(row);
  }

  protected isOwn(row: HistoryRow): boolean {
    return row.byId !== null && row.byId === this.auth.userId();
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`history.${key}`, params);
  }

  private reload(key: string): void {
    this.rows.set([]);
    this.total.set(0);
    this.comparing.set(null);
    this.compareDiff.set(null);
    this.fetch(key, 0);
  }

  private fetch(key: string, page: number): void {
    const ticket = ++this.requested;
    this.loading.set(true);
    this.failed.set(false);
    this.service
      .list(key, { filter: this.filter(), assetUuid: this.assetUuid() ?? undefined, page, size: PAGE_SIZE })
      .subscribe({
        next: (result) => {
          if (ticket !== this.requested) {
            return;
          }
          this.page = page;
          this.rows.update((rows) => (page === 0 ? result.rows : [...rows, ...result.rows]));
          this.total.set(result.total);
          this.loading.set(false);
        },
        error: () => {
          if (ticket === this.requested) {
            this.loading.set(false);
            this.failed.set(true);
          }
        },
      });
  }
}
