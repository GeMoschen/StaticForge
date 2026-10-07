import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { catchError, firstValueFrom, forkJoin, of, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { createShortcut } from '../../core/ui/documented-shortcuts';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfDrawerComponent } from '../../shared/components/dialog/sf-drawer.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { SfDevOnlyDirective } from '../../shared/directives/sf-dev-only.directive';
import { consumeQueryParam } from '../../shared/deep-link';
import { assetRoute } from '../../shared/asset-route.util';
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import { HistoryDrawerStore } from '../history/history-drawer.store';
import { ReleaseActionsComponent } from '../release/release-actions.component';
import type { ReleaseMode } from '../release/release-choice.util';
import { TimeTravelStore } from '../revisions/time-travel.store';
import {
  folderChain,
  folderMoveTargets,
  folderTrail,
  type MoveTarget,
} from './content-tree.util';
import { ContentStoreRefresh } from './content-store-refresh.service';
import { ContentService, etagFor, type DatasetDetailView, type RecordSetDetailView } from './content.service';
import { MoveTargetDialogComponent } from './move-target-dialog.component';
import { RecordGridComponent, type GridFilter, type RecordGridMode } from './record-grid.component';
import { RecordSetActions } from './record-set-actions.service';
import { RecordSetQueryPanelComponent } from './record-set-query-panel.component';

type UsageDto = components['schemas']['UsageDto'];
type FolderView = components['schemas']['FolderView'];

/** The asset types `enum.assetType` has a name for. */
const ASSET_TYPES: ReadonlySet<string> = new Set([
  'PAGE',
  'MEDIA',
  'SECTION_TEMPLATE',
  'PAGE_TEMPLATE',
  'FOLDER',
  'PAGE_REFERENCE',
  'GLOBAL_SET',
  'DATASET',
  'RECORD',
  'RECORD_SET',
]);

/**
 * One record set (M25.5.1, route `content/sets/:setUuid`; the page header, query panel and table of M35.20): a header
 * with the set's name and ☆, the dataset it holds, the record count, *Release…* (the shared release group) and *New
 * record*, and a ⋮ menu with History, Used by, Rename…, Move… and Delete…; the **Filter** panel (collapsed, with a
 * summary); and the set's records as a table with selection and bulk actions.
 *
 * <p>"New record" lives here and only here: a record always goes into a set, and the set fixes its dataset, so the
 * create call needs no more than the set. Saving the filter reloads the table, which hides (Shown by the filter) or marks
 * (All records) what the filter leaves out. `?show=all` is the second view, `?panel=history|usages` opens the History
 * drawer or the *Used by* list, `?newRecord=1` creates a record (the tree's context menu).
 *
 * <p>In time travel the set is read at the selected revision and everything is read-only; the table lists the set as of
 * that revision too (its records, their values and its query then).
 */
@Component({
  selector: 'sf-record-set-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MoveTargetDialogComponent,
    RecordGridComponent,
    RecordSetQueryPanelComponent,
    ReleaseActionsComponent,
    RouterLink,
    SfAssetFavoriteComponent,
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfDevOnlyDirective,
    SfDrawerComponent,
    SfEmptyStateComponent,
    SfPageHeaderComponent,
    SfRenameAssetDialogComponent,
    SfSkeletonComponent,
    TranslocoPipe,
  ],
  templateUrl: './record-set-view.component.html',
  styleUrl: './record-set-view.component.scss',
})
export class RecordSetViewComponent {
  readonly projectKey = input.required<string>();
  readonly setUuid = input.required<string>();
  /** `?panel=history|usages` opens the History drawer or the *Used by* list (then the parameter is cleared). */
  readonly panel = input<string | undefined>();
  /** `?newRecord=1` creates a record (the tree's context menu). */
  readonly newRecord = input<string | undefined>();
  /** `?show=all` lists every record of the set, not just what its filter selects. */
  readonly show = input<string | undefined>();

  private readonly content = inject(ContentService);
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly transloco = inject(TranslocoService);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly history = inject(HistoryDrawerStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly actions = inject(RecordSetActions);
  private readonly refresh = inject(ContentStoreRefresh, { optional: true });

  private readonly queryPanel = viewChild(RecordSetQueryPanelComponent);

  protected readonly timeTravelling = this.timeTravel.isTimeTravel;
  /** The revision the table lists the set at (`null`: current). */
  protected readonly activeRevision = this.timeTravel.activeRevision;
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly set = signal<RecordSetDetailView | null>(null);
  protected readonly dataset = signal<DatasetDetailView | null>(null);
  private readonly folders = signal<readonly FolderView[]>([]);
  protected readonly usages = signal<UsageDto[] | null>(null);
  protected readonly usagesOpen = signal(false);
  protected readonly usagesFailed = signal(false);
  protected readonly gridRefresh = signal(0);
  protected readonly creatingRecord = signal(false);
  protected readonly renaming = signal(false);
  protected readonly renameBusy = signal(false);
  protected readonly moveTargets = signal<MoveTarget[] | null>(null);
  protected readonly moveBusy = signal(false);

  protected readonly mode = computed<RecordGridMode>(() => (this.show() === 'all' ? 'all' : 'rendered'));

  private readonly canEditContent = inject(ProjectPermissionsStore).canEditContent;
  protected readonly readOnly = computed(() => this.timeTravelling() || !this.canEditContent());
  protected readonly title = computed(() => this.set()?.displayName ?? this.set()?.uid ?? '');

  /** The folders above the set, as the frame's breadcrumb links them. */
  private readonly trail = computed(() => {
    const folderUuid = this.set()?.folderUuid;
    const tree = this.folders();
    const chain = folderUuid ? folderChain(tree, folderUuid) : [];
    return folderTrail(chain, this.projectKey(), tree[0]?.uuid ?? null);
  });

  /** What uses the set, each with where it opens. */
  protected readonly usageRows = computed(() =>
    (this.usages() ?? []).map((usage) => {
      const target = assetRoute(this.projectKey(), { type: usage.fromType, uuid: usage.fromUuid });
      const type = usage.fromType ?? '';
      return {
        usage,
        commands: target.commands,
        queryParams: target.queryParams,
        kind: ASSET_TYPES.has(type) ? this.transloco.translate(`enum.assetType.${type}`) : type.toLowerCase().replace(/_/g, ' '),
      };
    }),
  );

  /** The snippet that renders this set in a template. */
  protected readonly snippet = computed(() => `$CMS_VALUE(recordset:${this.set()?.uid ?? 'set'})$`);

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const t = (key: string) => this.transloco.translate(`content.recordSet.menu.${key}`);
    const locked = this.readOnly() || this.set()?.deleted === true;
    return [
      { id: 'history', label: t('history'), icon: 'history' },
      { id: 'usedBy', label: t('usedBy'), icon: 'link' },
      { id: 'rename', label: t('rename'), icon: 'edit', disabled: locked },
      { id: 'move', label: t('move'), icon: 'drive_file_move', disabled: locked },
      { id: 'delete', label: t('delete'), icon: 'delete', danger: true, separatorBefore: true, disabled: locked },
    ];
  });

  constructor() {
    // The frame's breadcrumb ends with the set, with its folders above it as links; the History drawer shows its versions.
    useFrameItem(() => {
      const set = this.set();
      return set ? { label: this.title(), trail: this.trail(), asset: set.uuid ? { uuid: set.uuid } : undefined } : null;
    });

    effect(() => {
      const key = this.projectKey();
      const uuid = this.setUuid();
      const revision = this.timeTravel.activeRevision();
      untracked(() => this.load(key, uuid, revision));
    });

    // The store reloads after writes elsewhere (a rename or move in the tree): follow along.
    const refresh = this.refresh;
    if (refresh) {
      let seen = refresh.tick();
      effect(() => {
        const tick = refresh.tick();
        if (tick !== seen) {
          seen = tick;
          untracked(() => this.load(this.projectKey(), this.setUuid(), this.timeTravel.activeRevision()));
        }
      });
    }

    effect(() => {
      const requested = this.panel();
      if (requested !== 'history' && requested !== 'usages') {
        return;
      }
      untracked(() => {
        if (requested === 'history') {
          this.history.open();
        } else {
          this.openUsages();
        }
        consumeQueryParam(this.router, this.route, 'panel');
      });
    });

    effect(() => {
      if (!this.newRecord()) {
        return;
      }
      untracked(() => {
        this.createRecord();
        consumeQueryParam(this.router, this.route, 'newRecord');
      });
    });

    // `n` adds a record here (M35.14); it passes on when the set can't take one.
    inject(ShortcutService).use([
      createShortcut({
        handler: () => (this.canCreate() ? this.createRecord() : false),
        palette: { label: 'content.recordSet.newRecordShortcut', context: () => this.title() || null },
      }),
    ]);
  }

  protected canCreate(): boolean {
    const set = this.set();
    return !!set?.uuid && !!set.dataset?.uuid && !this.readOnly() && !set.deleted && !this.creatingRecord();
  }

  protected openRecord(uuid: string): void {
    void this.router.navigate(['/p', this.projectKey(), 'content', 'records', uuid]);
  }

  protected setMode(mode: RecordGridMode): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { show: mode === 'all' ? 'all' : null },
      queryParamsHandling: 'merge',
    });
  }

  protected onQuerySaved(view: RecordSetDetailView): void {
    this.set.set(view);
    this.gridRefresh.update((n) => n + 1);
    this.refresh?.notify();
  }

  protected onQueryStale(): void {
    this.load(this.projectKey(), this.setUuid(), null);
  }

  protected onUseAsSetQuery(filter: GridFilter): void {
    this.queryPanel()?.adopt(filter.where, filter.sort);
  }

  /** Records were deleted or moved from the table (or that was undone): the set's count and the tree are stale. */
  protected onRecordsChanged(): void {
    this.refresh?.notify();
  }

  /**
   * Adds an empty record to the set and opens it. There is nothing to ask first: a record's uid comes
   * from its uuid and its name from its title field (else the uuid), both set by the server (M25).
   */
  protected createRecord(): void {
    const set = this.set();
    const datasetUuid = set?.dataset?.uuid;
    if (!set?.uuid || !datasetUuid || this.readOnly() || this.creatingRecord()) {
      return;
    }
    this.creatingRecord.set(true);
    this.content
      .createRecord(this.projectKey(), datasetUuid, { recordSetUuid: set.uuid, content: {} })
      .subscribe({
        next: (created) => {
          this.creatingRecord.set(false);
          this.toasts.show(this.transloco.translate('content.recordSet.recordCreated'), 'success');
          this.refresh?.notify();
          if (created.uuid) {
            this.openRecord(created.uuid);
          }
        },
        error: () => {
          this.creatingRecord.set(false);
          this.toasts.show(this.transloco.translate('content.recordSet.recordFailed'), 'error');
        },
      });
  }

  // ── The ⋮ menu ─────────────────────────────────────────────────────────────

  protected onMenu(item: SfMenuItem): void {
    switch (item.id) {
      case 'history':
        this.history.open();
        break;
      case 'usedBy':
        this.openUsages();
        break;
      case 'rename':
        this.renaming.set(true);
        break;
      case 'move':
        this.openMove();
        break;
      case 'delete':
        this.deleteSet();
        break;
    }
  }

  protected openUsages(): void {
    const uuid = this.set()?.uuid ?? this.setUuid();
    this.usagesOpen.set(true);
    this.usagesFailed.set(false);
    this.usages.set(null);
    this.api.assetUsages(this.projectKey(), uuid).subscribe({
      next: (usages) => this.usages.set(usages ?? []),
      error: () => this.usagesFailed.set(true),
    });
  }

  protected renameSet(displayName: string): void {
    const set = this.set();
    if (!set?.uuid) {
      return;
    }
    this.renameBusy.set(true);
    this.content.updateRecordSet(this.projectKey(), set.uuid, { displayName }, etagFor(set.revision ?? 0)).subscribe({
      next: (view) => {
        this.renameBusy.set(false);
        this.renaming.set(false);
        this.set.set(view);
        this.refresh?.notify();
        this.toasts.show(this.transloco.translate('content.recordSet.renamed', { name: view.displayName ?? view.uid }), 'success');
      },
      error: (err: unknown) => {
        this.renameBusy.set(false);
        this.toasts.show(
          this.transloco.translate(err instanceof HttpErrorResponse && err.status === 409 ? 'content.recordSet.renameConflict' : 'content.recordSet.renameFailed'),
          'error',
        );
        if (err instanceof HttpErrorResponse && err.status === 409) {
          this.load(this.projectKey(), this.setUuid(), null);
        }
      },
    });
  }

  protected onUidChanged(): void {
    this.refresh?.notify();
    this.load(this.projectKey(), this.setUuid(), null);
  }

  private openMove(): void {
    const root = this.folders()[0] ?? null;
    const targets = folderMoveTargets(root, this.set()?.folderUuid);
    if (targets.length === 0) {
      this.toasts.show(this.transloco.translate('content.recordSet.moveFailed'), 'error');
      return;
    }
    this.moveTargets.set(targets);
  }

  protected moveSet(folderUuid: string | null): void {
    const set = this.set();
    const targets = this.moveTargets();
    if (!set?.uuid || !targets) {
      return;
    }
    const key = this.projectKey();
    const uuid = set.uuid;
    const back = set.folderUuid && set.folderUuid !== this.folders()[0]?.uuid ? set.folderUuid : undefined;
    const target = targets.find((t) => t.uuid === folderUuid)?.label ?? '';
    this.moveBusy.set(true);
    this.content.moveAsset(key, uuid, folderUuid ?? undefined).subscribe({
      next: () => {
        this.moveBusy.set(false);
        this.moveTargets.set(null);
        this.undo.offer(this.transloco.translate('content.recordSet.moved', { name: this.title(), target }), () =>
          this.content.moveAsset(key, uuid, back).pipe(
            tap(() => {
              this.refresh?.notify();
              this.load(key, uuid, null);
            }),
          ),
        );
        this.refresh?.notify();
        this.load(key, uuid, null);
      },
      error: () => {
        this.moveBusy.set(false);
        this.toasts.show(this.transloco.translate('content.recordSet.moveFailed'), 'error');
      },
    });
  }

  protected deleteSet(): void {
    const set = this.set();
    if (!set?.uuid || this.readOnly()) {
      return;
    }
    this.actions
      .delete(this.projectKey(), {
        uuid: set.uuid,
        name: this.title(),
        recordCount: set.recordCount ?? 0,
        release: set.release,
        afterUndo: () => this.refresh?.notify(),
      })
      .subscribe((deleted) => {
        if (deleted) {
          this.refresh?.notify();
          void this.router.navigate(['/p', this.projectKey(), 'content']);
        }
      });
  }

  protected restoreSet(): void {
    const set = this.set();
    if (!set?.uuid || this.timeTravelling()) {
      return;
    }
    const uuid = set.uuid;
    firstValueFrom(restoreDeletedAsset(this.api, this.projectKey(), uuid)).then(
      () => {
        this.toasts.show(this.transloco.translate('content.recordSet.restored'), 'success');
        this.refresh?.notify();
        this.load(this.projectKey(), uuid, null);
      },
      () => this.toasts.show(this.transloco.translate('content.recordSet.restoreFailed'), 'error'),
    );
  }

  /** A discard wrote the released version back as the set's draft: reload it (M27.6.1). */
  protected onReleaseChanged(mode: ReleaseMode): void {
    const uuid = this.set()?.uuid;
    this.refresh?.notify();
    if (mode === 'discard' && uuid && !this.timeTravelling()) {
      this.load(this.projectKey(), uuid, null);
    }
  }

  protected leaveTimeTravel(): void {
    this.timeTravel.exit();
  }

  protected retry(): void {
    this.load(this.projectKey(), this.setUuid(), this.timeTravel.activeRevision());
  }

  private load(projectKey: string, uuid: string, revision: number | null): void {
    if (!projectKey || !uuid) {
      return;
    }
    this.loading.set(true);
    this.failed.set(false);
    this.content.getRecordSet(projectKey, uuid, revision).subscribe({
      next: (set) => {
        const datasetUuid = set.dataset?.uuid;
        forkJoin({
          dataset: datasetUuid ? this.content.getDataset(projectKey, datasetUuid, revision) : of(null),
          folders: this.content.folders(projectKey).pipe(catchError(() => of<FolderView[]>([]))),
        }).subscribe({
          next: ({ dataset, folders }) => {
            this.loading.set(false);
            this.dataset.set(dataset);
            this.folders.set(folders ?? []);
            this.set.set(set);
          },
          error: () => {
            this.loading.set(false);
            this.dataset.set(null);
            this.set.set(set);
            this.toasts.show(this.transloco.translate('content.recordSet.datasetFailed'), 'error');
          },
        });
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.set.set(null);
        this.failed.set(true);
        const notThen = err instanceof HttpErrorResponse && err.status === 404 && revision != null;
        this.toasts.show(this.transloco.translate(notThen ? 'content.recordSet.notThen' : 'content.recordSet.loadFailed'), 'error');
      },
    });
  }
}
