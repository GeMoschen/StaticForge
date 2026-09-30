import { Injectable, OnDestroy, Signal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ToastService } from '../../core/ui/toast.service';
import { DiagnosticGroup, parseDiagnostics } from './generation-diagnostics';
import { GenerationRunEvent } from './generation-sse';
import { GenerationService } from './generation.service';
import {
  FINDINGS_TAB,
  FINDING_PARAM_NAMES,
  NO_FINDING_FILTER,
  paramsFromFindingFilter,
  type FindingFilter,
} from './findings/findings.util';

export type GenerationRunView = components['schemas']['GenerationRunView'];
type GenerationTargetView = components['schemas']['GenerationTargetView'];

export interface LogLine {
  id: number;
  stage: string;
  message: string;
}

const TERMINAL_STATUSES = new Set(['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED']);

/** The tabs of a run's details, in order. */
export type DetailsTab = 'summary' | 'pages' | 'findings';

export interface LiveSummary {
  filesWritten: number;
  errors: number;
  warnings: number;
}

/**
 * The state the parts of the Generation view share (history, targets, open details, live log), provided per
 * {@link GenerationComponent}. The component binds its router-fed inputs with {@link connect}.
 */
@Injectable()
export class GenerationStore implements OnDestroy {
  private readonly api = inject(GenerationService);
  private readonly pagesApi = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  /**
   * The route whose query holds the open findings view (`?run=&tab=findings&fSeverity=…`); absent where the component
   * is rendered outside a route, and then the findings view isn't kept in the URL.
   */
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = this.route ? inject(Router) : null;

  projectKey!: Signal<string>;
  private openRun!: Signal<number | null>;
  private openTab!: Signal<string | null>;

  readonly runs = signal<GenerationRunView[]>([]);
  readonly loading = signal(false);
  readonly targets = signal<GenerationTargetView[]>([]);
  /** Whether the targets have been read: "no targets" is only news after that. */
  readonly targetsLoaded = signal(false);
  /** Where a run without a target goes: the default target, else the first (as the server resolves it). */
  readonly defaultTargetId = computed(() => {
    const targets = this.targets();
    return (targets.find((t) => t.isDefault) ?? targets[0])?.id ?? null;
  });

  readonly liveRunId = signal<number | null>(null);
  readonly liveActive = signal(false);
  readonly liveLines = signal<LogLine[]>([]);
  readonly liveSummary = signal<LiveSummary>({ filesWritten: 0, errors: 0, warnings: 0 });
  /** Final run status once the stream has ended; the log stays open until the user closes it. */
  readonly liveStatus = signal<string | null>(null);
  readonly liveDiagnostics = signal<DiagnosticGroup[]>([]);

  readonly expandedRunId = signal<number | null>(null);
  /** The open tab of a run's details (M22.3.2). */
  readonly detailsTab = signal<DetailsTab>('summary');
  /**
   * The uuids of the project's pages, read while the details of a run whose diagnostics name pages are open: a page
   * deleted since the build is listed as text instead of a link. `null` until read (and if the read fails).
   */
  private readonly livePages = signal<ReadonlySet<string> | null>(null);

  private liveSub: Subscription | null = null;

  connect(projectKey: Signal<string>, openRun: Signal<number | null>, openTab: Signal<string | null>): void {
    this.projectKey = projectKey;
    this.openRun = openRun;
    this.openTab = openTab;
  }

  ngOnDestroy(): void {
    this.closeLive();
  }

  // ── History and targets ────────────────────────────────────────────────

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

  loadTargets(): void {
    this.api.listTargets(this.projectKey()).subscribe({
      next: (targets) => {
        this.targets.set(targets ?? []);
        this.targetsLoaded.set(true);
      },
      error: () => {
        this.targets.set([]);
        this.targetsLoaded.set(true);
      },
    });
  }

  targetLabel(run: GenerationRunView): string {
    if (run.targetId == null) {
      return 'Default target';
    }
    const target = this.targets().find((t) => t.id === run.targetId);
    return target ? `${target.name} (${target.outputPath})` : `Target #${run.targetId} (deleted)`;
  }

  /** Puts a just-started run first in the history. */
  addRun(run: GenerationRunView): void {
    this.runs.update((list) => [run, ...list.filter((r) => r.id !== run.id)]);
  }

  refreshRun(id: number, then?: (fresh: GenerationRunView) => void): void {
    this.api.status(this.projectKey(), id).subscribe({
      next: (fresh) => {
        this.runs.update((list) => list.map((r) => (r.id === id ? fresh : r)));
        then?.(fresh);
      },
      error: () => {
        /* leave existing row as-is */
      },
    });
  }

  // ── Details tabs and the findings URL ──────────────────────────────────

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

  // ── Pages named by diagnostics ─────────────────────────────────────────

  loadLivePages(): void {
    const key = this.projectKey();
    this.livePages.set(null);
    this.pagesApi.listPages(key).subscribe({
      next: (pages) => {
        if (this.projectKey() === key) {
          this.livePages.set(new Set((pages ?? []).map((page) => page.uuid ?? '')));
        }
      },
      error: () => {
        /* no links: the pages stay plain text */
      },
    });
  }

  /** Whether the page a diagnostic names still exists — only then it is a link. */
  pageExists(uuid: string): boolean {
    return this.livePages()?.has(uuid) ?? false;
  }

  // ── Live log ───────────────────────────────────────────────────────────

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
}
