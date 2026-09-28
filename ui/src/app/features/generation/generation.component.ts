import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription, map } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import { GenerationService } from './generation.service';
import { GenerationDialogComponent } from './generation-dialog.component';
import {
  DiagnosticGroup,
  HELD_BACK_CODE,
  parseDiagnostics,
  parseHeldBack,
  type HeldBackPage,
} from './generation-diagnostics';
import { GenerationRunEvent } from './generation-sse';
import {
  planSummaryLine,
  redirectsLine,
  rootKindRows,
  type EntryPage,
  type PlanEntryQuery,
} from './insight/insight.util';
import { SfPlanEntriesTableComponent } from './insight/sf-plan-entries-table.component';
import {
  FINDINGS_TAB,
  FINDING_PARAM_NAMES,
  findingCountsLabel,
  paramsFromFindingFilter,
  NO_FINDING_FILTER,
  type FindingFilter,
} from './findings/findings.util';
import { SfFindingCountsComponent } from './findings/sf-finding-counts.component';
import { SfRunFindingsComponent } from './findings/sf-run-findings.component';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';

type GenerationRunView = components['schemas']['GenerationRunView'];
type GenerationTargetView = components['schemas']['GenerationTargetView'];

interface LogLine {
  id: number;
  stage: string;
  message: string;
}

const TERMINAL_STATUSES = new Set(['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED']);

/** The tabs of a run's details, in order. */
type DetailsTab = 'summary' | 'pages' | 'findings';

interface LiveSummary {
  filesWritten: number;
  errors: number;
  warnings: number;
}

@Component({
  selector: 'sf-generation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfSpinnerComponent,
    SfRelativeTimePipe,
    GenerationDialogComponent,
    SfPlanEntriesTableComponent,
    SfFindingCountsComponent,
    SfRunFindingsComponent,
  ],
  templateUrl: './generation.component.html',
  styleUrl: './generation.component.scss',
})
export class GenerationComponent implements OnDestroy {
  readonly projectKey = input.required<string>();
  /** A run to open on arrival — the Schedules history links here with `?run=` (M27.6.5). */
  readonly openRun = input<number | null>(null);
  /** The details tab to open {@link openRun} on: `findings` for a shared findings view (M30.6.2, `?tab=`). */
  readonly openTab = input<string | null>(null);

  private readonly api = inject(GenerationService);
  /**
   * The route whose query holds the open findings view (`?run=&tab=findings&fSeverity=…`); absent where the component
   * is rendered outside a route, and then the findings view isn't kept in the URL.
   */
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = this.route ? inject(Router) : null;
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  /** No new runs or promotes in time travel or in an archived project (M26); running ones may still be cancelled. */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;
  /** Who may start, cancel and promote (M28.3.3): the project's publish policy for editors, developers always. */
  protected readonly permissions = inject(ProjectPermissionsStore);

  readonly runs = signal<GenerationRunView[]>([]);
  readonly loading = signal(false);
  readonly dialogOpen = signal(false);
  readonly targets = signal<GenerationTargetView[]>([]);
  /** Where a run without a target goes: the default target, else the first (as the server resolves it). */
  readonly defaultTargetId = computed(() => {
    const targets = this.targets();
    return (targets.find((t) => t.isDefault) ?? targets[0])?.id ?? null;
  });

  readonly liveRunId = signal<number | null>(null);
  readonly liveActive = signal(false);
  readonly liveLines = signal<LogLine[]>([]);
  readonly liveSummary = signal<LiveSummary>({
    filesWritten: 0,
    errors: 0,
    warnings: 0,
  });
  /** Final run status once the stream has ended; the log stays open until the user closes it. */
  readonly liveStatus = signal<string | null>(null);
  readonly liveDiagnostics = signal<DiagnosticGroup[]>([]);

  readonly expandedRunId = signal<number | null>(null);
  /** The open tab of a run's details (M22.3.2). */
  readonly detailsTab = signal<DetailsTab>('summary');
  protected readonly heldBackCode = HELD_BACK_CODE;
  private readonly runPlanFetches = new Map<number, (query: PlanEntryQuery) => Observable<EntryPage | undefined>>();

  private liveSub: Subscription | null = null;

  constructor() {
    effect(() => {
      this.projectKey();
      untracked(() => {
        this.load();
        this.loadTargets();
      });
    });
  }

  /** Whether the history holds {@link openRun}: a refreshed history doesn't reopen details the user closed. */
  private readonly openRunListed = computed(() => {
    const id = this.openRun();
    return id != null && this.runs().some((run) => run.id === id);
  });

  /**
   * Opens {@link openRun}'s details (on {@link openTab}) once the history holds it, and follows it in the live log while
   * it is still queued or running — "Show progress" after "Build now" lands here, and the row would otherwise keep the
   * status it had when the history was read.
   */
  private readonly openRunEffect = effect(
    () => {
      const id = this.openRun();
      const findings = this.openTab() === FINDINGS_TAB;
      if (this.openRunListed()) {
        untracked(() => {
          this.expandedRunId.set(id);
          if (findings) {
            this.detailsTab.set('findings');
          }
          const run = this.runs().find((r) => r.id === id);
          if (run && (run.status === 'QUEUED' || run.status === 'RUNNING') && this.liveRunId() !== id) {
            this.watchLive(run);
          }
        });
      }
    },
    { allowSignalWrites: true },
  );

  trackRun(index: number, run: GenerationRunView): number {
    return run.id ?? index;
  }

  load(): void {
    this.loading.set(true);
    this.api.history(this.projectKey()).subscribe({
      next: (runs) => {
        this.runs.set(runs ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toasts.show('Could not load generation history — check your connection and try again.', 'error');
      },
    });
  }

  openDialog(): void {
    this.dialogOpen.set(true);
    this.loadTargets();
  }

  private loadTargets(): void {
    this.api.listTargets(this.projectKey()).subscribe({
      next: (targets) => this.targets.set(targets ?? []),
      error: () => this.targets.set([]),
    });
  }

  planLine(run: GenerationRunView): string {
    return planSummaryLine(run.planSummary);
  }

  rootKindsOf(run: GenerationRunView): string[] {
    return rootKindRows(run.planSummary).map((row) => row.key);
  }

  /** One stable loader per run, so the entries table doesn't reload on every change detection. */
  runPlanFetch(run: GenerationRunView): (query: PlanEntryQuery) => Observable<EntryPage | undefined> {
    const id = run.id ?? 0;
    let fetch = this.runPlanFetches.get(id);
    if (!fetch) {
      fetch = (query) => this.api.getRunPlan(this.projectKey(), id, query).pipe(map((plan) => plan.entries ?? undefined));
      this.runPlanFetches.set(id, fetch);
    }
    return fetch;
  }

  toggleDetails(run: GenerationRunView): void {
    const id = run.id ?? null;
    this.expandedRunId.update((current) => (current === id ? null : id));
    this.syncFindingsUrl();
  }

  /** The details tabs `run` has: findings only once its checks have run (M30.6.2). */
  detailsTabsOf(run: GenerationRunView): DetailsTab[] {
    return run.findingCounts ? ['summary', 'pages', 'findings'] : ['summary', 'pages'];
  }

  selectTab(run: GenerationRunView, tab: DetailsTab): void {
    if (!this.detailsTabsOf(run).includes(tab)) {
      return;
    }
    this.detailsTab.set(tab);
    this.syncFindingsUrl();
  }

  /** Arrow keys move between the tabs (WAI-ARIA tabs pattern), wrapping around. */
  stepTab(run: GenerationRunView, step: 1 | -1): void {
    const tabs = this.detailsTabsOf(run);
    const index = tabs.indexOf(this.visibleTab(run));
    this.selectTab(run, tabs[(index + step + tabs.length) % tabs.length]);
  }

  /** The tab shown for `run`: findings fall back to the summary for a run without check results. */
  visibleTab(run: GenerationRunView): DetailsTab {
    const tab = this.detailsTab();
    return this.detailsTabsOf(run).includes(tab) ? tab : 'summary';
  }

  /** The run list's findings summary: "3 errors · 41 warnings". */
  findingsLine(run: GenerationRunView): string {
    return findingCountsLabel(run.findingCounts);
  }

  redirectsOf(run: GenerationRunView): string {
    return redirectsLine(run.planSummary);
  }

  /** Opens `run`'s findings narrowed by `filter`, in the URL so the view can be shared. */
  showFindings(run: GenerationRunView, filter: Partial<FindingFilter> = {}): void {
    const id = run.id ?? null;
    if (id === null || !run.findingCounts) {
      return;
    }
    this.expandedRunId.set(id);
    this.detailsTab.set('findings');
    this.navigateFindings({
      run: id,
      tab: FINDINGS_TAB,
      ...paramsFromFindingFilter({ ...NO_FINDING_FILTER, ...filter }),
    });
  }

  /**
   * The pages `run`'s `SF-GEN-0125` messages are about, by message index (the server lists `heldBack` in the order of
   * those messages). Empty — no links — for a run without findings or from before `heldBack`, or when the two
   * disagree.
   */
  heldBackOf(run: GenerationRunView, groups: DiagnosticGroup[]): HeldBackPage[] {
    const pages = run.findingCounts ? parseHeldBack(run.diagnostics) : [];
    const messages = groups.find((group) => group.code === HELD_BACK_CODE)?.messages.length ?? 0;
    return pages.length === messages ? pages : [];
  }

  /** Opens the findings of a page the quality checks held back: that page, channel and language. */
  showHeldBack(run: GenerationRunView, page: HeldBackPage): void {
    this.showFindings(run, { asset: page.asset, channel: page.channel, locale: page.locale });
  }

  /**
   * Keeps the URL on the open findings view: `?run=&tab=findings` while a run's findings are shown (a view of another
   * run starts unfiltered), and none of the findings parameters once they are closed.
   */
  private syncFindingsUrl(): void {
    const id = this.expandedRunId();
    const run = id === null ? undefined : this.runs().find((r) => r.id === id);
    const shown = run && this.visibleTab(run) === 'findings' ? id : null;
    const urlShows = this.openTab() === FINDINGS_TAB ? this.openRun() : null;
    if (shown === urlShows) {
      return;
    }
    const cleared = Object.fromEntries(FINDING_PARAM_NAMES.map((name) => [name, null]));
    this.navigateFindings(
      shown === null ? { run: null, tab: null, ...cleared } : { run: shown, tab: FINDINGS_TAB, ...cleared },
    );
  }

  private navigateFindings(queryParams: Record<string, unknown>): void {
    if (this.router && this.route) {
      void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
    }
  }

  diagnosticsOf(run: GenerationRunView): DiagnosticGroup[] {
    return parseDiagnostics(run.diagnostics);
  }

  targetLabel(run: GenerationRunView): string {
    if (run.targetId == null) {
      return 'Default target';
    }
    const target = this.targets().find((t) => t.id === run.targetId);
    return target ? `${target.name} (${target.outputPath})` : `Target #${run.targetId} (deleted)`;
  }

  onStarted(run: GenerationRunView): void {
    this.dialogOpen.set(false);
    this.runs.update((list) => {
      const rest = list.filter((r) => r.id !== run.id);
      return [run, ...rest];
    });
    this.toasts.show('Generation started', 'success');
    this.watchLive(run);
  }

  onDialogCancelled(): void {
    this.dialogOpen.set(false);
  }

  statusColor(status?: string): string {
    switch (status) {
      case 'SUCCESS':
        return 'var(--sf-jade)';
      case 'PARTIAL':
        return 'var(--sf-amber)';
      case 'FAILED':
        return 'var(--sf-rust)';
      case 'RUNNING':
      case 'QUEUED':
        return 'var(--sf-signal)';
      case 'CANCELLED':
        return 'var(--sf-slate)';
      default:
        return 'var(--sf-slate)';
    }
  }

  promote(run: GenerationRunView): void {
    const id = run.id ?? 0;
    this.api.promote(this.projectKey(), id).subscribe({
      next: () => this.toasts.show('Generation promoted', 'success'),
      error: () => this.toasts.show('Could not promote generation — try again in a moment.', 'error'),
    });
  }

  cancel(run: GenerationRunView): void {
    const id = run.id ?? 0;
    this.api.cancel(this.projectKey(), id).subscribe({
      next: () => {
        this.toasts.show('Generation cancelled', 'info');
        this.refreshRun(id);
      },
      error: () => this.toasts.show('Could not cancel generation — it may have already finished.', 'error'),
    });
  }

  watchLive(run: GenerationRunView): void {
    const token = this.auth.accessToken();
    if (!token) {
      this.toasts.show('Not authenticated', 'error');
      return;
    }
    const id = run.id ?? 0;
    this.closeLive();
    this.liveRunId.set(id);
    this.liveLines.set([]);
    this.liveSummary.set({ filesWritten: 0, errors: 0, warnings: 0 });
    this.liveStatus.set(null);
    this.liveDiagnostics.set([]);
    this.liveActive.set(true);
    this.liveSub = this.api.connectEvents(this.projectKey(), id, token).subscribe({
      next: (event) => this.onLiveEvent(event),
      error: () => {
        this.appendLiveLine('LOG', 'Lost connection to the live log.');
        this.liveDone();
      },
      complete: () => this.liveDone(),
    });
  }

  closeLive(): void {
    if (this.liveSub) {
      this.liveSub.unsubscribe();
      this.liveSub = null;
    }
    this.liveActive.set(false);
    this.liveRunId.set(null);
  }

  private onLiveEvent(event: GenerationRunEvent): void {
    this.appendLiveLine(event.stage, event.message);
    this.liveSummary.set({
      filesWritten: event.filesWritten,
      errors: event.errors,
      warnings: event.warnings,
    });
    if (event.diagnostics) {
      this.liveDiagnostics.set(parseDiagnostics(event.diagnostics));
    }
    if (TERMINAL_STATUSES.has(event.message) && (event.stage === 'REPORT' || event.stage === 'STATUS')) {
      this.liveStatus.set(event.message);
    }
  }

  private appendLiveLine(stage: string, message: string): void {
    this.liveLines.update((list) => [...list, { id: list.length, stage, message }]);
  }

  /** Stream ended: keep the log open and settle its final status/diagnostics from the stored run. */
  private liveDone(): void {
    this.liveSub = null;
    const id = this.liveRunId();
    if (id !== null) {
      this.refreshRun(id, (fresh) => {
        if (this.liveRunId() !== id) {
          return;
        }
        this.liveStatus.set(fresh.status ?? null);
        this.liveDiagnostics.set(parseDiagnostics(fresh.diagnostics));
        this.liveSummary.set({
          filesWritten: fresh.filesWritten ?? 0,
          errors: fresh.errorCount ?? 0,
          warnings: fresh.warningCount ?? 0,
        });
      });
    }
  }

  private refreshRun(id: number, then?: (fresh: GenerationRunView) => void): void {
    this.api.status(this.projectKey(), id).subscribe({
      next: (fresh) => {
        this.runs.update((list) =>
          list.map((r) => (r.id === id ? fresh : r)),
        );
        then?.(fresh);
      },
      error: () => {
        /* leave existing row as-is */
      },
    });
  }

  ngOnDestroy(): void {
    this.closeLive();
  }
}
