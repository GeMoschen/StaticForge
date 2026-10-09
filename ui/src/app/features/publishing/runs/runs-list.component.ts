import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { SfDataTableColumn, SfDataTableFilter } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfMenuComponent } from '../../../shared/components/menu/sf-menu.component';
import type { SfMenuItem } from '../../../shared/components/menu/sf-menu-item';
import type { ContextMenuItem } from '../../../shared/services/context-menu.service';
import { RunsStore } from './runs.store';
import {
  GenerationRunView,
  RUN_MODES,
  RUN_STATUSES,
  RUN_STATUS_ICONS,
  RUN_STATUS_TONES,
  RUN_TRIGGERS,
  durationSeconds,
  findingTotals,
  formatDuration,
  isActiveRun,
  isPromotable,
  runModeOf,
  runStatusOf,
  runTriggerOf,
} from './runs.util';

/**
 * Publishing › Runs (M35.24, gate decisions 27 and 186-191): the project's builds in an `sf-data-table`, one line per
 * cell, with the search and the Status, Mode, Target and Trigger filters (all client-side: the server sends every run).
 * Every row has a ⋮ menu, also opened by a right click: *Open*, *Live log* (queued or running), *Promote* (a finished
 * run with output; developers) and *Cancel* (queued or running; developers any run, editors the ones they started).
 * Promote and Cancel ask first. A running run shows the stage it is in.
 */
@Component({
  selector: 'sf-runs-list',
  standalone: true,
  imports: [SfDataTableCellDirective, SfDataTableComponent, SfMenuComponent, SfRelativeTimeComponent, SfStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './runs-list.component.html',
  styleUrl: './runs-list.component.scss',
})
export class RunsListComponent {
  protected readonly store = inject(RunsStore);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);

  protected readonly tones = RUN_STATUS_TONES;
  protected readonly icons = RUN_STATUS_ICONS;
  protected readonly statusOf = runStatusOf;

  protected readonly rowKey = (row: GenerationRunView) => String(row.id);
  protected readonly rowLabel = (row: GenerationRunView) => this.t('number', { n: row.id });

  protected readonly filters = computed<SfDataTableFilter<GenerationRunView>[]>(() => [
    {
      id: 'status',
      label: this.t('columns.status'),
      options: RUN_STATUSES.map((value) => ({ value, label: this.t(`status.${value}`) })),
      match: (run, values) => values.includes(runStatusOf(run)),
    },
    {
      id: 'mode',
      label: this.t('columns.mode'),
      options: RUN_MODES.map((value) => ({ value, label: this.t(`mode.${value}`) })),
      match: (run, values) => values.includes(runModeOf(run)),
    },
    {
      id: 'target',
      label: this.t('columns.target'),
      options: this.store.targets().map((target) => ({ value: String(target.id), label: target.name ?? '' })),
      match: (run, values) => values.includes(String(run.targetId ?? this.store.defaultTarget()?.id)),
    },
    {
      id: 'trigger',
      label: this.t('columns.trigger'),
      options: RUN_TRIGGERS.map((value) => ({ value, label: this.t(`trigger.${value}`) })),
      match: (run, values) => values.includes(runTriggerOf(run)),
    },
  ]);

  protected readonly columns = computed<SfDataTableColumn<GenerationRunView>[]>(() => {
    const header = (id: string) => this.t(`columns.${id}`);
    return [
      {
        id: 'status',
        header: header('status'),
        value: (run) => `#${run.id} ${this.t(`status.${runStatusOf(run)}`)}`,
        compare: (a, b) => (a.id ?? 0) - (b.id ?? 0),
        sortable: true,
        width: 230,
        hideable: false,
      },
      { id: 'mode', header: header('mode'), value: (run) => this.t(`mode.${runModeOf(run)}`), width: 130 },
      { id: 'target', header: header('target'), value: (run) => this.store.targetName(run), width: 150 },
      { id: 'trigger', header: header('trigger'), value: (run) => this.t(`trigger.${runTriggerOf(run)}`), width: 140 },
      { id: 'started', header: header('started'), value: (run) => Date.parse(run.startedAt ?? '') || 0, sortable: true, width: 130 },
      { id: 'duration', header: header('duration'), value: (run) => durationSeconds(run) ?? -1, sortable: true, width: 110, align: 'end' },
      { id: 'pages', header: header('pages'), value: (run) => run.planSummary?.pageCount ?? -1, sortable: true, width: 80, align: 'end' },
      { id: 'findings', header: header('findings'), value: (run) => this.findingsText(run), width: 190 },
      { id: 'actions', header: header('actions'), hideable: false, searchable: false, width: 64, align: 'end' },
    ];
  });

  /** The ⋮ menu of a row: what the viewer may do with the run. */
  protected rowActions(run: GenerationRunView): SfMenuItem[] {
    const items: SfMenuItem[] = [{ id: 'open', label: this.t('actions.open'), icon: 'open_in_new', action: () => this.open(run) }];
    if (isActiveRun(run)) {
      items.push({ id: 'log', label: this.t('actions.log'), icon: 'terminal', action: () => this.open(run, 'log') });
    }
    if (isPromotable(run) && this.permissions.canPromote()) {
      items.push({ id: 'promote', label: this.t('actions.promote'), icon: 'publish', action: () => void this.store.promote(run) });
    }
    if (isActiveRun(run) && this.permissions.canCancelRun(run)) {
      items.push({
        id: 'cancel',
        label: this.t('actions.cancel'),
        icon: 'block',
        danger: true,
        separatorBefore: true,
        action: () => void this.store.cancel(run),
      });
    }
    return items;
  }

  /** A right click on a row: the same entries as its ⋮ menu. */
  protected readonly rowMenu = (rows: GenerationRunView[]): ContextMenuItem[] =>
    rows.length === 1
      ? this.rowActions(rows[0]).flatMap((item) => [
          ...(item.separatorBefore ? [{ label: '', separator: true }] : []),
          { label: item.label, icon: item.icon, danger: item.danger, action: item.action },
        ])
      : [];

  protected actionsLabel(run: GenerationRunView): string {
    return this.t('actions.label', { n: run.id });
  }

  protected open(run: GenerationRunView, tab: string | null = null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { run: run.id, rtab: tab },
      queryParamsHandling: 'merge',
    });
  }

  /** What a running run is doing: its newest stage, else just "Running". */
  protected stageLabel(run: GenerationRunView): string {
    const stage = this.store.progress().get(run.id ?? -1)?.stage;
    return stage ? this.t(`stage.${stage}`) : this.t('status.running');
  }

  protected duration(run: GenerationRunView): string | null {
    const seconds = durationSeconds(run);
    return seconds === null ? null : formatDuration(seconds);
  }

  protected findingsText(run: GenerationRunView): string {
    const totals = isActiveRun(run) ? null : findingTotals(run);
    if (!totals) {
      return '—';
    }
    return totals.errors + totals.warnings === 0
      ? this.t('noFindings')
      : this.t('findings', { errors: totals.errors, warnings: totals.warnings });
  }

  protected hasErrors(run: GenerationRunView): boolean {
    return (findingTotals(run)?.errors ?? 0) > 0;
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.runs.${key}`, params);
  }
}
