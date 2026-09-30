import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ToastService } from '../../core/ui/toast.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfRelativeTimePipe } from '../../shared/pipes/sf-relative-time.pipe';
import { GenerationService } from './generation.service';
import { GenerationDialogComponent } from './generation-dialog.component';
import { parseDiagnostics } from './generation-diagnostics';
import { GenerationLiveLogComponent } from './generation-live-log.component';
import { statusColor } from './generation-run.util';
import { GenerationRunDetailsComponent } from './generation-run-details.component';
import { type GenerationRunView, GenerationStore } from './generation.store';
import { FINDINGS_TAB } from './findings/findings.util';
import { planSummaryLine } from './insight/insight.util';
import { SfFindingCountsComponent } from './findings/sf-finding-counts.component';

/**
 * The generation history with the "New generation" dialog, per-run details and the live log. This component owns the
 * router-fed inputs, the effects that react to them and the run actions; the state the parts share lives in the
 * feature-scoped {@link GenerationStore}.
 */
@Component({
  selector: 'sf-generation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfEmptyStateComponent,
    SfSpinnerComponent,
    SfRelativeTimePipe,
    GenerationDialogComponent,
    SfFindingCountsComponent,
    GenerationRunDetailsComponent,
    GenerationLiveLogComponent,
  ],
  providers: [GenerationStore],
  templateUrl: './generation.component.html',
  styleUrl: './generation.component.scss',
})
export class GenerationComponent {
  readonly projectKey = input.required<string>();
  /** A run to open on arrival — the Schedules history links here with `?run=` (M27.6.5). */
  readonly openRun = input<number | null>(null);
  /** The details tab to open {@link openRun} on: `findings` for a shared findings view (M30.6.2, `?tab=`). */
  readonly openTab = input<string | null>(null);

  private readonly api = inject(GenerationService);
  private readonly toasts = inject(ToastService);
  protected readonly store = inject(GenerationStore);
  /** No new runs or promotes in time travel or in an archived project (M26); running ones may still be cancelled. */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;
  /** Who may start, cancel and promote (M28.3.3): the project's publish policy for editors, developers always. */
  protected readonly permissions = inject(ProjectPermissionsStore);

  readonly dialogOpen = signal(false);

  /** The expanded run, when its diagnostics name pages (the id is what the effect below follows). */
  private readonly expandedRunNamingPages = computed<number | null>(() => {
    const id = this.store.expandedRunId();
    const run = id === null ? undefined : this.store.runs().find((r) => r.id === id);
    return run && parseDiagnostics(run.diagnostics).some((group) => (group.pages?.length ?? 0) > 0) ? id : null;
  });

  constructor() {
    this.store.connect(this.projectKey, this.openRun, this.openTab);
    effect(() => {
      this.projectKey();
      untracked(() => {
        this.store.load();
        this.store.loadTargets();
      });
    });
  }

  private readonly pagesEffect = effect(() => {
    if (this.expandedRunNamingPages() === null) {
      return;
    }
    untracked(() => this.store.loadLivePages());
  });

  /** Whether the history holds {@link openRun}: a refreshed history doesn't reopen details the user closed. */
  private readonly openRunListed = computed(() => {
    const id = this.openRun();
    return id != null && this.store.runs().some((run) => run.id === id);
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
          this.store.expandedRunId.set(id);
          if (findings) {
            this.store.detailsTab.set('findings');
          }
          const run = this.store.runs().find((r) => r.id === id);
          if (run && (run.status === 'QUEUED' || run.status === 'RUNNING') && this.store.liveRunId() !== id) {
            this.store.watchLive(run);
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
    this.store.load();
  }

  watchLive(run: GenerationRunView): void {
    this.store.watchLive(run);
  }

  toggleDetails(run: GenerationRunView): void {
    this.store.toggleDetails(run);
  }

  openDialog(): void {
    this.dialogOpen.set(true);
    this.store.loadTargets();
  }

  planLine(run: GenerationRunView): string {
    return planSummaryLine(run.planSummary);
  }

  statusColor = statusColor;

  onStarted(run: GenerationRunView): void {
    this.dialogOpen.set(false);
    this.store.addRun(run);
    this.toasts.show('Generation started', 'success');
    this.store.watchLive(run);
  }

  onDialogCancelled(): void {
    this.dialogOpen.set(false);
  }

  promote(run: GenerationRunView): void {
    const id = run.id ?? 0;
    this.api.promote(this.store.projectKey(), id).subscribe({
      next: () => this.toasts.show('Generation promoted', 'success'),
      error: () => this.toasts.show('Could not promote generation — try again in a moment.', 'error'),
    });
  }

  cancel(run: GenerationRunView): void {
    const id = run.id ?? 0;
    this.api.cancel(this.store.projectKey(), id).subscribe({
      next: () => {
        this.toasts.show('Generation cancelled', 'info');
        this.store.refreshRun(id);
      },
      error: () => this.toasts.show('Could not cancel generation — it may have already finished.', 'error'),
    });
  }
}
