import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { BuildNowService } from '../generation/build-now.service';
import { GenerationService } from '../generation/generation.service';
import type { GenerationRunView } from '../publishing/runs/runs.util';
import { ReleaseEventsStore } from '../release/release-events.store';
import { RECENT_BUILDS, buildStateOf } from './build-status.util';

/** While a build runs its state is re-read this often. */
const POLL_MS = 2500;

/**
 * The open project's last builds for the top bar (M35.10). It is re-read when the project changes, after navigation and
 * release actions (one read at a time; a request made meanwhile runs once more after it, never dropped) and, only while
 * a build is running, on a short timer.
 */
@Injectable({ providedIn: 'root' })
export class BuildStatusStore {
  private readonly api = inject(GenerationService);
  private readonly frame = inject(FrameContextStore);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly buildNow = inject(BuildNowService);

  /** The newest builds of the open project, newest first. */
  readonly runs = signal<readonly GenerationRunView[]>([]);
  /** The project the runs belong to. */
  private owner: string | null = null;
  private inFlight = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly state = computed(() => buildStateOf(this.runs()));
  readonly latest = computed(() => this.runs()[0] ?? null);

  private readonly navigations = toSignal(
    inject(Router).events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => (event as NavigationEnd).id),
    ),
    { initialValue: 0 },
  );

  constructor() {
    effect(() => {
      const key = this.frame.projectKey();
      this.navigations();
      this.releaseEvents.version();
      untracked(() => this.refresh(key));
    });
    // A build started from the top bar or a release toast shows up at once (the run is the newest, running).
    const started = this.buildNow.started.subscribe(() => this.refresh(this.owner));
    inject(DestroyRef).onDestroy(() => {
      started.unsubscribe();
      this.stopTimer();
    });
  }

  /** Re-reads the builds of `projectKey` (`null` forgets them). */
  refresh(projectKey: string | null): void {
    if (projectKey === null) {
      this.owner = null;
      this.runs.set([]);
      this.stopTimer();
      return;
    }
    if (projectKey !== this.owner) {
      this.owner = projectKey;
      this.runs.set([]);
    }
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    this.stopTimer();
    this.api.history(projectKey).subscribe({
      next: (runs) => {
        if (this.owner === projectKey) {
          this.runs.set((runs ?? []).slice(0, RECENT_BUILDS));
          this.pollWhileRunning(projectKey);
        }
        // Last: a read asked for meanwhile starts now and must land on top of this answer, not under it.
        this.finish();
      },
      // The status is a hint: a failed read keeps the last one.
      error: () => this.finish(),
    });
  }

  private finish(): void {
    this.inFlight = false;
    if (this.again) {
      this.again = false;
      this.refresh(this.owner);
    }
  }

  private pollWhileRunning(projectKey: string): void {
    this.stopTimer();
    if (this.state() === 'running') {
      this.timer = setTimeout(() => this.refresh(projectKey), POLL_MS);
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
