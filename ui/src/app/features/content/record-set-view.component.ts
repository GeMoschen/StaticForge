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
import { forkJoin, of } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { roleRank } from '../../core/auth/auth.guard';
import { AuthStore } from '../../core/auth/auth.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { consumeQueryParam } from '../../shared/deep-link';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { INVALID_QUERY_WARNING, storeFolderPath } from './content-tree.util';
import { ContentStoreRefresh } from './content-store-refresh.service';
import { ContentService, type DatasetDetailView, type RecordSetDetailView } from './content.service';
import { RecordGridComponent, type GridFilter } from './record-grid.component';
import { RecordSetActions } from './record-set-actions.service';
import { RecordSetQueryPanelComponent } from './record-set-query-panel.component';

type AssetHistoryEntry = components['schemas']['AssetHistoryEntry'];
type UsageDto = components['schemas']['UsageDto'];

/** The set view's tabs; `?panel=` opens one directly (the tree's "History" / "Used by"). */
export type RecordSetPanel = 'records' | 'history' | 'usages';

function isPanel(value: string | undefined): value is RecordSetPanel {
  return value === 'records' || value === 'history' || value === 'usages';
}

/**
 * One record set (M25.5.1, route `content/sets/:setUuid`): its header (name, dataset, folder,
 * record count, an invalid-query warning), the **Set query** panel and the set's record grid, plus
 * the set's history and usages.
 *
 * <p>"New record" lives here and only here: a record always goes into a set, and the set fixes its
 * dataset, so the create dialog asks only for a name. Saving the query reloads the grid, which
 * dims (All records) or hides (Show as rendered) what the query leaves out.
 *
 * <p>In time travel the set is read at the selected revision and everything is read-only; the
 * grid lists the set as of that revision too (its records, their values and its query then).
 */
@Component({
  selector: 'sf-record-set-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    SfButtonComponent,
    SfCreateAssetDialogComponent,
    SfIconComponent,
    SfRelativeTimePipe,
    RecordGridComponent,
    RecordSetQueryPanelComponent,
  ],
  templateUrl: './record-set-view.component.html',
  styleUrl: './record-set-view.component.scss',
})
export class RecordSetViewComponent {
  readonly projectKey = input.required<string>();
  readonly setUuid = input.required<string>();
  /** `?panel=history|usages` opens that tab (then the parameter is cleared). */
  readonly panel = input<string | undefined>();
  /** `?newRecord=1` opens the "New record" dialog (the tree's context menu). */
  readonly newRecord = input<string | undefined>();

  private readonly content = inject(ContentService);
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly actions = inject(RecordSetActions);
  private readonly refresh = inject(ContentStoreRefresh, { optional: true });

  private readonly queryPanel = viewChild(RecordSetQueryPanelComponent);

  protected readonly timeTravelling = this.timeTravel.isTimeTravel;
  /** The revision the grid lists the set at (`null`: current). */
  protected readonly activeRevision = this.timeTravel.activeRevision;
  protected readonly loading = signal(false);
  protected readonly set = signal<RecordSetDetailView | null>(null);
  protected readonly dataset = signal<DatasetDetailView | null>(null);
  protected readonly history = signal<AssetHistoryEntry[]>([]);
  protected readonly usages = signal<UsageDto[]>([]);
  protected readonly activePanel = signal<RecordSetPanel>('records');
  protected readonly gridRefresh = signal(0);
  protected readonly newRecordOpen = signal(false);
  protected readonly creatingRecord = signal(false);

  protected readonly invalidQueryWarning = INVALID_QUERY_WARNING;

  private readonly canEditRole = computed(() => roleRank(this.auth.roleFor(this.projectKey())) >= roleRank('EDITOR'));
  protected readonly readOnly = computed(() => this.timeTravelling() || !this.canEditRole());
  protected readonly folderPath = computed(() => storeFolderPath(this.set()?.folderPath));
  protected readonly recordCountLabel = computed(() => {
    const count = this.set()?.recordCount ?? 0;
    return `${count} ${count === 1 ? 'record' : 'records'}`;
  });

  /** The snippet that renders this set in a template. */
  protected readonly snippet = computed(() => `$CMS_VALUE(recordset:${this.set()?.uid ?? 'set'})$`);

  constructor() {
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

    effect(
      () => {
        const requested = this.panel();
        if (!isPanel(requested)) {
          return;
        }
        untracked(() => {
          this.activePanel.set(requested);
          consumeQueryParam(this.router, this.route, 'panel');
        });
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        if (!this.newRecord()) {
          return;
        }
        untracked(() => {
          this.openNewRecord();
          consumeQueryParam(this.router, this.route, 'newRecord');
        });
      },
      { allowSignalWrites: true },
    );
  }

  protected showPanel(panel: RecordSetPanel): void {
    this.activePanel.set(panel);
  }

  protected openRecord(uuid: string): void {
    void this.router.navigate(['/p', this.projectKey(), 'content', 'records', uuid]);
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

  protected openNewRecord(): void {
    if (!this.readOnly()) {
      this.newRecordOpen.set(true);
    }
  }

  protected closeNewRecord(): void {
    this.newRecordOpen.set(false);
  }

  protected submitNewRecord(value: CreateAssetFormValue): void {
    const set = this.set();
    const datasetUuid = set?.dataset?.uuid;
    if (!set?.uuid || !datasetUuid || this.readOnly()) {
      return;
    }
    this.creatingRecord.set(true);
    this.content
      .createRecord(this.projectKey(), datasetUuid, {
        recordSetUuid: set.uuid,
        displayName: value.displayName,
        content: {},
      })
      .subscribe({
        next: (created) => {
          this.creatingRecord.set(false);
          this.newRecordOpen.set(false);
          this.toasts.show('Record created', 'success');
          this.refresh?.notify();
          if (created.uuid) {
            this.openRecord(created.uuid);
          }
        },
        error: () => {
          this.creatingRecord.set(false);
          this.toasts.show('Could not create the record — you may need the editor role.', 'error');
        },
      });
  }

  protected deleteSet(): void {
    const set = this.set();
    if (!set?.uuid || this.readOnly()) {
      return;
    }
    this.actions
      .delete(this.projectKey(), { uuid: set.uuid, name: set.displayName ?? set.uid ?? '', recordCount: set.recordCount ?? 0 })
      .subscribe((deleted) => {
        if (deleted) {
          this.refresh?.notify();
          void this.router.navigate(['/p', this.projectKey(), 'content']);
        }
      });
  }

  protected restoreSet(): void {
    const set = this.set();
    const lastLive = this.history().find((entry) => !entry.deleted);
    if (!set?.uuid || lastLive?.revision == null || this.timeTravelling()) {
      return;
    }
    this.api.restoreAsset(this.projectKey(), set.uuid, { fromRevision: lastLive.revision }).subscribe({
      next: () => {
        this.toasts.show('Record set restored', 'success');
        this.refresh?.notify();
        this.load(this.projectKey(), set.uuid!, null);
      },
      error: () => this.toasts.show('Could not restore the record set — try again in a moment.', 'error'),
    });
  }

  protected viewRevision(revision: number | undefined): void {
    if (revision != null) {
      this.timeTravel.enter(revision);
    }
  }

  protected leaveTimeTravel(): void {
    this.timeTravel.exit();
  }

  private load(projectKey: string, uuid: string, revision: number | null): void {
    if (!projectKey || !uuid) {
      return;
    }
    this.loading.set(true);
    this.content.getRecordSet(projectKey, uuid, revision).subscribe({
      next: (set) => {
        const datasetUuid = set.dataset?.uuid;
        forkJoin({
          dataset: datasetUuid ? this.content.getDataset(projectKey, datasetUuid, revision) : of(null),
          history: this.api.assetHistory(projectKey, uuid),
          usages: this.api.assetUsages(projectKey, uuid),
        }).subscribe({
          next: ({ dataset, history, usages }) => {
            this.loading.set(false);
            this.dataset.set(dataset);
            this.history.set(history ?? []);
            this.usages.set(usages ?? []);
            this.set.set(set);
          },
          error: () => {
            this.loading.set(false);
            this.dataset.set(null);
            this.set.set(set);
            this.toasts.show("Could not load the set's dataset — try again in a moment.", 'error');
          },
        });
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.set.set(null);
        const notThen = err instanceof HttpErrorResponse && err.status === 404 && revision != null;
        this.toasts.show(
          notThen
            ? 'This record set did not exist at that revision.'
            : 'Could not load the record set — try again in a moment.',
          'error',
        );
      },
    });
  }
}
