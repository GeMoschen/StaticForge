import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../core/api/api.client';
import { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfAvatarComponent } from '../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfTagComponent } from '../../shared/components/display/sf-tag.component';
import { SfSearchInputComponent } from '../../shared/components/forms/sf-search-input.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSplitterComponent } from '../../shared/components/splitter/sf-splitter.component';
import { HistoryAuthor, historyFilterMenus } from './history-filter-menus';
import {
  HISTORY_KIND_ICONS,
  HistoryFilter,
  NO_HISTORY_FILTER,
  filterFromQuery,
  filterToQuery,
  isFiltered,
} from './history-model';
import { HistoryRow, assetNamesOf, summaryOf } from './history-rows';
import { HistoryRangeDialogComponent } from './history-range-dialog.component';
import { HistoryRevisionComponent } from './history-revision.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { HistoryService } from './history.service';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The full History page (`/p/:key/history`, M35.12, signed off in the style guide): a header with the count, a filter
 * bar (search, author, type, date — all in the URL) and an `sf-data-table` timeline: revision, human summary, type,
 * changed items by name, author and time. A row opens the revision's detail in an `sf-splitter` pane
 * (`/history/:revisionId`): the changed items with their field diffs, *View this state* and *Roll back project*.
 */
@Component({
  selector: 'sf-history-page',
  standalone: true,
  imports: [
    HistoryRangeDialogComponent,
    HistoryRevisionComponent,
    NgTemplateOutlet,
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSearchInputComponent,
    SfSplitterComponent,
    SfTagComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './history-page.component.html',
  styleUrl: './history-page.component.scss',
})
export class HistoryPageComponent {
  readonly projectKey = input.required<string>();
  /** `/history/:revisionId`: the revision open in the detail pane. */
  readonly revisionId = input<string | undefined>();

  private readonly service = inject(HistoryService);
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  /** A restore or roll-back (or a release) adds revisions: the timeline re-reads. */
  private readonly events = inject(ReleaseEventsStore);

  protected readonly kindIcons = HISTORY_KIND_ICONS;
  protected readonly filter = signal<HistoryFilter>(
    filterFromQuery((name) => this.route.snapshot.queryParamMap.get(name)),
  );
  protected readonly rows = signal<readonly HistoryRow[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly authors = signal<readonly HistoryAuthor[]>([]);
  protected readonly rangeDialog = signal(false);
  /** The revision of the detail pane, loaded on its own: it need not be among the loaded rows. */
  protected readonly selected = signal<HistoryRow | null>(null);

  private page = 0;
  private requested = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly filtered = computed(() => isFiltered(this.filter()));
  protected readonly openId = computed(() => {
    const id = Number(this.revisionId());
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  protected readonly currentKey = computed(() => (this.openId() === null ? null : String(this.openId())));

  protected readonly menus = computed(() => {
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

  protected readonly columns = computed<SfDataTableColumn<HistoryRow>[]>(() => {
    const header = (id: string) => this.t(`columns.${id}`);
    return [
      { id: 'rev', header: header('rev'), value: (r) => r.id, width: 96, hideable: false },
      { id: 'summary', header: header('summary'), value: (r) => this.summaryOf(r), width: 340, hideable: false },
      { id: 'kind', header: header('kind'), value: (r) => r.kind, width: 130 },
      { id: 'changed', header: header('changed'), value: (r) => r.assets.length, width: 240 },
      { id: 'by', header: header('by'), value: (r) => r.byName, width: 220 },
    ];
  });

  protected readonly rowKey = (row: HistoryRow) => String(row.id);
  protected readonly rowLabel = (row: HistoryRow) => this.t('page.revision', { n: row.id });

  constructor() {
    effect(
      () => {
        const key = this.projectKey();
        this.filter();
        this.events.version();
        untracked(() => this.reload(key));
      },
      { allowSignalWrites: true },
    );
    // The filter lives in the URL (replacing the history entry).
    effect(() => {
      const query = filterToQuery(this.filter());
      untracked(() =>
        void this.router.navigate([], { relativeTo: this.route, queryParams: query, queryParamsHandling: 'merge', replaceUrl: true }),
      );
    });
    effect(
      () => {
        const key = this.projectKey();
        const id = this.openId();
        untracked(() => this.loadSelected(key, id));
      },
      { allowSignalWrites: true },
    );
    effect(() => {
      const key = this.projectKey();
      untracked(() =>
        this.api.listMembers(key).subscribe({
          next: (members) =>
            this.authors.set(members.map((m) => ({ id: String(m.userId), name: m.displayName || m.username || String(m.userId) }))),
        }),
      );
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) {
        clearTimeout(this.searchTimer);
      }
    });
  }

  protected setSearch(q: string): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => this.filter.update((f) => ({ ...f, q })), SEARCH_DEBOUNCE_MS);
  }

  protected clear(): void {
    this.filter.set(NO_HISTORY_FILTER);
  }

  protected applyRange(range: { from: string | null; to: string | null }): void {
    this.filter.update((f) => ({ ...f, date: { range: 'custom', from: range.from, to: range.to } }));
    this.rangeDialog.set(false);
  }

  protected openRevision(row: HistoryRow): void {
    void this.router.navigate(['/p', this.projectKey(), 'history', row.id], { queryParamsHandling: 'preserve' });
  }

  protected closeDetail(): void {
    void this.router.navigate(['/p', this.projectKey(), 'history'], { queryParamsHandling: 'preserve' });
  }

  protected loadMore(): void {
    if (this.rows().length < this.total() && !this.loading()) {
      this.fetch(this.projectKey(), this.page + 1);
    }
  }

  protected summaryOf(row: HistoryRow): string {
    return summaryOf(row, (key, params) => this.t(key, params));
  }

  protected names(row: HistoryRow): { names: string; more: number } {
    return assetNamesOf(row);
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`history.${key}`, params);
  }

  private reload(key: string): void {
    this.rows.set([]);
    this.total.set(0);
    this.fetch(key, 0);
  }

  private fetch(key: string, page: number): void {
    const ticket = ++this.requested;
    this.loading.set(true);
    this.failed.set(false);
    this.service.list(key, { filter: this.filter(), page, size: PAGE_SIZE }).subscribe({
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

  private loadSelected(key: string, id: number | null): void {
    if (id === null) {
      this.selected.set(null);
      return;
    }
    const known = this.rows().find((r) => r.id === id);
    if (known) {
      this.selected.set(known);
    }
    this.service.revision(key, id).subscribe({
      next: (row) => {
        if (this.openId() === id) {
          this.selected.set(row);
        }
      },
      error: () => {
        if (this.openId() === id && !known) {
          this.selected.set(null);
        }
      },
    });
  }
}
