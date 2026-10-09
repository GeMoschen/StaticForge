import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { GenerationService } from '../../generation/generation.service';
import { GenerationRunView, isActiveRun, runStatusOf } from './runs.util';

type GenerationTargetView = components['schemas']['GenerationTargetView'];

/** While a run is queued or running the list is re-read this often. */
export const RUNS_POLL_MS = 2500;

/** Where a running run is: the stage of its newest log line and the files rendered so far. */
export interface RunProgress {
  readonly stage: string;
  readonly files: number;
  /** The newest line's number: the next read asks for the lines after it. */
  readonly last: number;
}

/**
 * The state the Runs list and a run's detail share, provided per `PublishingRunsComponent`: the project's runs (all of
 * them, newest first; the server does not page), its targets, how far a running run is, and the actions on a run
 * (cancel, promote). The list is re-read on a timer while any run is queued or running, one read at a time — a read
 * asked for meanwhile runs once more after it, never dropped.
 */
@Injectable()
export class RunsStore implements OnDestroy {
  private readonly api = inject(GenerationService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private key = '';
  readonly runs = signal<readonly GenerationRunView[]>([]);
  /** The first read of the runs finished (successfully or not). */
  readonly loaded = signal(false);
  readonly failed = signal(false);
  readonly targets = signal<readonly GenerationTargetView[]>([]);
  readonly targetsLoaded = signal(false);
  /** Progress of the running runs by run id. */
  readonly progress = signal<ReadonlyMap<number, RunProgress>>(new Map());
  /** The run a link named that the project does not have. */
  readonly missing = signal<number | null>(null);

  /** Where a run without a target goes: the default target, else the first (as the server resolves it). */
  readonly defaultTarget = computed(() => {
    const targets = this.targets();
    return targets.find((t) => t.isDefault) ?? targets[0] ?? null;
  });

  private inFlight = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private requested = new Set<number>();

  /** Opens the project: forgets another project's runs and reads this one's. */
  open(projectKey: string): void {
    if (projectKey !== this.key) {
      this.key = projectKey;
      this.runs.set([]);
      this.targets.set([]);
      this.progress.set(new Map());
      this.loaded.set(false);
      this.failed.set(false);
      this.targetsLoaded.set(false);
      this.missing.set(null);
      this.requested = new Set();
      this.stopTimer();
    }
    this.load();
    this.loadTargets();
  }

  ngOnDestroy(): void {
    this.key = '';
    this.stopTimer();
  }

  /** Re-reads the runs (one read at a time). */
  load(): void {
    if (!this.key) {
      return;
    }
    if (this.inFlight) {
      this.again = true;
      return;
    }
    const key = this.key;
    this.inFlight = true;
    this.stopTimer();
    this.api.history(key).subscribe({
      next: (runs) => {
        if (this.key === key) {
          this.runs.set(runs ?? []);
          this.failed.set(false);
          this.loaded.set(true);
          this.readProgress(key);
          this.schedule(key);
        }
        this.finish();
      },
      error: () => {
        if (this.key === key) {
          this.failed.set(true);
          this.loaded.set(true);
        }
        this.finish();
      },
    });
  }

  private finish(): void {
    this.inFlight = false;
    if (this.again) {
      this.again = false;
      this.load();
    }
  }

  private schedule(key: string): void {
    this.stopTimer();
    if (this.runs().some(isActiveRun)) {
      this.timer = setTimeout(() => (this.key === key ? this.load() : undefined), RUNS_POLL_MS);
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private loadTargets(): void {
    const key = this.key;
    this.api.listTargets(key).subscribe({
      next: (targets) => {
        if (this.key === key) {
          this.targets.set(targets ?? []);
          this.targetsLoaded.set(true);
        }
      },
      error: () => {
        if (this.key === key) {
          this.targetsLoaded.set(true);
        }
      },
    });
  }

  /** The stage of each running run, from the tail of its log. */
  private readProgress(key: string): void {
    const running = this.runs().filter((run) => runStatusOf(run) === 'running' && run.id != null);
    this.progress.update((known) => new Map([...known].filter(([id]) => running.some((run) => run.id === id))));
    for (const run of running) {
      const id = run.id as number;
      const last = this.progress().get(id)?.last ?? 0;
      this.api.runLog(key, id, last).subscribe({
        next: (log) => {
          const line = log.lines?.at(-1);
          if (line && this.key === key) {
            this.progress.update(
              (known) => new Map(known).set(id, { stage: line.stage ?? '', files: line.files ?? 0, last: line.n ?? last }),
            );
          }
        },
        // The stage is a hint; a failed read keeps the last one.
        error: () => undefined,
      });
    }
  }

  /**
   * A run a link named that the list does not hold (it was started after the list was read, or never existed): asks
   * the server once, and reports it missing when it has no such run.
   */
  ensureRun(id: number): void {
    if (this.runs().some((run) => run.id === id)) {
      this.missing.set(null);
      return;
    }
    if (!this.loaded() || this.requested.has(id)) {
      return;
    }
    this.requested.add(id);
    const key = this.key;
    this.api.status(key, id, true).subscribe({
      next: (run) => {
        if (this.key === key) {
          this.missing.set(null);
          this.runs.update((list) => [run, ...list.filter((r) => r.id !== id)]);
          this.schedule(key);
        }
      },
      error: (error: unknown) => {
        if (this.key === key && error instanceof HttpErrorResponse && error.status === 404) {
          this.missing.set(id);
        }
      },
    });
  }

  run(id: number | null): GenerationRunView | null {
    return id === null ? null : (this.runs().find((run) => run.id === id) ?? null);
  }

  /** The name of the run's target; a run of a deleted target says so. */
  targetName(run: GenerationRunView): string {
    if (run.targetId == null) {
      return this.defaultTarget()?.name ?? this.t('noTarget');
    }
    return this.targets().find((t) => t.id === run.targetId)?.name ?? this.t('deletedTarget', { id: run.targetId });
  }

  async cancel(run: GenerationRunView): Promise<void> {
    const n = run.id;
    const confirmed = await this.confirms.confirm({
      title: this.t('cancelTitle', { n }),
      message: this.t(runStatusOf(run) === 'queued' ? 'cancelQueued' : 'cancelRunning'),
      confirmLabel: this.t('cancelConfirm', { n }),
      cancelLabel: this.t('cancelKeep'),
      tone: 'danger',
    });
    if (!confirmed || n == null) {
      return;
    }
    this.api.cancel(this.key, n).subscribe({
      next: () => {
        this.toasts.show(this.t('cancelled', { n }), 'info');
        this.load();
      },
      // It may have finished meanwhile: the refreshed list says so.
      error: () => this.load(),
    });
  }

  async promote(run: GenerationRunView): Promise<void> {
    const n = run.id;
    const target = this.targetName(run);
    const confirmed = await this.confirms.confirm({
      title: this.t('promoteTitle', { n, target }),
      confirmLabel: this.t('promoteConfirm'),
    });
    if (!confirmed || n == null) {
      return;
    }
    this.api.promote(this.key, n).subscribe({
      next: () => {
        this.toasts.show(this.t('promoted', { n, target }), 'success');
        this.load();
      },
    });
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.runs.${key}`, params);
  }
}
