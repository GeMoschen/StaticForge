import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { SfDataTableColumn, SfDataTableFilter, SfDataTableQuery } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { GenerationService } from '../../generation/generation.service';
import { fallbackLabel, reasonBadge, rootKindLabel, rootKindRows, type PlanEntryView } from '../../generation/insight/insight.util';
import { becauseOf, entryKey, entryName, rebuiltView, viaGroups } from './run-rebuilt.util';
import { RunsStore } from './runs.store';
import { GenerationRunView, runModeOf } from './runs.util';

/** The changes listed before "+ N more". */
const TOP_CHANGES = 5;
const PAGE_SIZE = 50;

/**
 * A run's Rebuilt tab (gate decision 194): a plan line, the largest changes behind the rebuild, a breakdown by kind and
 * the rebuilt files with the reason and the change each was rebuilt because of; or one of four empty states (the plan
 * is not made yet, none was stored, retention removed it, nothing needed rebuilding). The files are read a page at a
 * time from the run's stored plan.
 */
@Component({
  selector: 'sf-run-rebuilt',
  standalone: true,
  imports: [SfBadgeComponent, SfDataTableComponent, SfEmptyStateComponent, SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './run-rebuilt.component.html',
  styleUrl: './run-rebuilt.component.scss',
})
export class RunRebuiltComponent {
  readonly projectKey = input.required<string>();
  readonly run = input.required<GenerationRunView>();

  private readonly api = inject(GenerationService);
  private readonly store = inject(RunsStore);
  private readonly transloco = inject(TranslocoService);
  protected readonly developerMode = inject(DeveloperModeService).enabled;

  protected readonly view = computed(() => rebuiltView(this.run()));
  private readonly summary = computed(() => this.run().planSummary);

  protected readonly planLine = computed(() =>
    this.t('run.plan.line', {
      pages: this.summary()?.pageCount ?? 0,
      changes: this.summary()?.changedAssetCount ?? 0,
      mode: this.t(`runs.mode.${runModeOf(this.run())}`),
    }),
  );
  protected readonly fallback = computed(() => {
    const cause = this.summary()?.fallbackCause;
    return cause ? this.t('run.plan.fallback', { cause: fallbackLabel(cause, this.store.targetName(this.run())) }) : null;
  });
  private readonly groups = computed(() => viaGroups(this.summary()));
  protected readonly topChanges = computed(() => this.groups().slice(0, TOP_CHANGES));
  /** Changes beyond the groups the server names (`via` is capped) and the ones shown. */
  protected readonly moreChanges = computed(() =>
    Math.max(this.groups().length - TOP_CHANGES, (this.summary()?.changedAssetCount ?? 0) - TOP_CHANGES, 0),
  );
  protected readonly kinds = computed(() => rootKindRows(this.summary()));

  protected readonly filters = computed<SfDataTableFilter<PlanEntryView>[]>(() => {
    const filters: SfDataTableFilter<PlanEntryView>[] = [];
    const kinds = this.kinds();
    if (kinds.length > 1) {
      filters.push({
        id: 'kind',
        label: this.t('run.rebuiltColumns.reason'),
        single: true,
        options: kinds.map((kind) => ({ value: kind.key, label: rootKindLabel(kind.key) })),
      });
    }
    const channels = this.summary()?.channels ?? [];
    if (channels.length > 1) {
      filters.push({
        id: 'channel',
        label: this.t('run.rebuiltColumns.channel'),
        single: true,
        options: channels.map((channel) => ({ value: channel, label: channel })),
      });
    }
    return filters;
  });

  protected readonly columns = computed<SfDataTableColumn<PlanEntryView>[]>(() => {
    const header = (id: string) => this.t(`run.rebuiltColumns.${id}`);
    const columns: SfDataTableColumn<PlanEntryView>[] = [
      { id: 'name', header: header('page'), value: entryName, hideable: false, width: 240 },
      { id: 'lang', header: header('lang'), value: (entry) => entry.locale?.toUpperCase() ?? '', width: 100 },
      { id: 'reason', header: header('reason'), value: (entry) => reasonBadge(entry.reason), width: 160 },
      { id: 'via', header: header('via'), value: (entry) => becauseOf(entry.reason), width: 280 },
    ];
    if (this.developerMode()) {
      columns.push({ id: 'path', header: header('path'), value: (entry) => entry.outputPath ?? '', width: 280 });
    }
    return columns;
  });

  protected readonly rows = signal<readonly PlanEntryView[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly pageSize = PAGE_SIZE;
  protected readonly rowKey = entryKey;
  protected readonly rowLabel = entryName;

  private request: Subscription | null = null;
  private lastQuery: SfDataTableQuery | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  /** The table asked for a page, a search or a filter: reads that page of the stored plan. */
  protected onQuery(query: SfDataTableQuery): void {
    this.lastQuery = query;
    const runId = this.run().id;
    if (runId == null) {
      return;
    }
    this.request?.unsubscribe();
    this.loading.set(true);
    this.failed.set(false);
    this.request = this.api
      .getRunPlan(this.projectKey(), runId, {
        page: query.page,
        size: PAGE_SIZE,
        q: query.search || undefined,
        rootKind: query.filters['kind']?.[0],
        channel: query.filters['channel']?.[0],
      })
      .subscribe({
        next: (plan) => {
          this.rows.set(plan.entries?.content ?? []);
          this.total.set(plan.entries?.page?.totalElements ?? 0);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.failed.set(true);
        },
      });
  }

  protected retry(): void {
    if (this.lastQuery) {
      this.onQuery(this.lastQuery);
    }
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.${key}`, params);
  }
}
