import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfTab, SfTabsComponent } from '../../../shared/components/sf-tabs.component';
import { FINDING_QUERY_PARAMS } from './findings/run-findings.util';
import { RunFindingsComponent } from './findings/run-findings.component';
import { RunLogComponent } from './run-log/run-log.component';
import { RunRebuiltComponent } from './run-rebuilt.component';
import { RunSummaryComponent } from './run-summary.component';
import { RunsStore } from './runs.store';
import {
  GenerationRunView,
  RUN_STATUS_ICONS,
  RUN_STATUS_TONES,
  durationSeconds,
  findingTotals,
  formatDuration,
  isActiveRun,
  isPromotable,
  runModeOf,
  runStatusOf,
} from './runs.util';

export type RunTab = 'summary' | 'rebuilt' | 'findings' | 'log';
const RUN_TABS: readonly RunTab[] = ['summary', 'rebuilt', 'findings', 'log'];

/**
 * A run's detail (M35.24, gate decisions 186-195): a header (status, Cancel for a queued or running run, Promote for a
 * finished one, a strip of counts) and `sf-tabs` Summary | Rebuilt | Findings | Log. A queued or running run opens on
 * its Log. The tab is in the URL (`rtab`; the Schedules history's older `tab=findings` still opens the findings), and
 * so are the findings filters (`fsev`, `fcat`, `frule`, `flang`, `fpath`).
 */
@Component({
  selector: 'sf-run-detail',
  standalone: true,
  imports: [
    RunFindingsComponent,
    RunLogComponent,
    RunRebuiltComponent,
    RunSummaryComponent,
    SfButtonComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    SfTabsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './run-detail.component.html',
  styleUrl: './run-detail.component.scss',
})
export class RunDetailComponent {
  readonly projectKey = input.required<string>();
  readonly run = input.required<GenerationRunView>();

  protected readonly store = inject(RunsStore);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  protected readonly tones = RUN_STATUS_TONES;
  protected readonly icons = RUN_STATUS_ICONS;

  protected readonly status = computed(() => runStatusOf(this.run()));
  protected readonly active = computed(() => isActiveRun(this.run()));
  protected readonly canCancel = computed(() => this.active() && this.permissions.canCancelRun(this.run()));
  protected readonly canPromote = computed(() => isPromotable(this.run()) && this.permissions.canPromote());
  protected readonly counts = computed(() => findingTotals(this.run()) ?? { errors: 0, warnings: 0 });
  protected readonly mode = computed(() => runModeOf(this.run()));
  protected readonly target = computed(() => this.store.targetName(this.run()));
  protected readonly duration = computed(() => {
    const seconds = durationSeconds(this.run());
    return seconds === null ? this.t(this.status() === 'queued' ? 'runs.waiting' : 'runs.inProgress') : formatDuration(seconds);
  });
  protected readonly stage = computed(() => {
    const stage = this.store.progress().get(this.run().id ?? -1)?.stage;
    return stage ? this.t(`runs.stage.${stage}`) : this.t('runs.status.running');
  });

  /** The tab the URL asks for; a queued or running run opens on its Log, any other on its Summary. */
  protected readonly tab = computed<RunTab>(() => {
    const asked = this.query().get('rtab') ?? (this.query().get('tab') === 'findings' ? 'findings' : null);
    return (RUN_TABS as readonly string[]).includes(asked ?? '') ? (asked as RunTab) : this.active() ? 'log' : 'summary';
  });

  protected readonly tabs = computed<SfTab[]>(() => [
    { id: 'summary', label: this.t('run.tabs.summary') },
    { id: 'rebuilt', label: this.t('run.tabs.rebuilt') },
    { id: 'findings', label: this.t('run.tabs.findings'), errors: this.counts().errors || undefined },
    { id: 'log', label: this.t('run.tabs.log') },
  ]);

  protected selectTab(id: string): void {
    this.update({ rtab: id, tab: null }, true);
  }

  /** "Show findings" in the Summary: the Findings tab, optionally only the errors. */
  protected showFindings(errorsOnly = false): void {
    this.update({ rtab: 'findings', tab: null, fsev: errorsOnly ? 'error' : null }, true);
  }

  /** Back to the list; the tab and the findings filters stay with the run. */
  protected back(): void {
    this.update({ run: null, rtab: null, tab: null, ...Object.fromEntries(FINDING_QUERY_PARAMS.map((name) => [name, null])) });
  }

  protected cancel(): void {
    void this.store.cancel(this.run());
  }

  protected promote(): void {
    void this.store.promote(this.run());
  }

  private update(params: Params, replace = false): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge', replaceUrl: replace });
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.${key}`, params);
  }
}
