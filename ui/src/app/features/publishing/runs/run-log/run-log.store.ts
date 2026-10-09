import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import type { components } from '../../../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../../../core/auth/auth.store';
import type { GenerationRunEvent } from '../../../generation/generation-sse';
import { GenerationService } from '../../../generation/generation.service';

export type LogLine = components['schemas']['Line'];

/** While the live stream is unavailable the log is polled this often (ms). */
export const LOG_POLL_MS = 2500;

/**
 * One run's log (M35.24): the stored lines of a finished run (one `GET /log`), or, for a queued or running run, the
 * live stream — it replays the lines so far, then follows — with the closing lines fetched when it ends. Replay and live
 * may overlap, so lines are de-duplicated by their number `n`. If the stream cannot be kept, the log is polled instead.
 * Provided by the log component, one per open log.
 */
@Injectable()
export class RunLogStore {
  private readonly api = inject(GenerationService);
  private readonly auth = inject(AuthStore);

  readonly lines = signal<readonly LogLine[]>([]);
  /** The log is final: nothing will be appended. */
  readonly complete = signal(false);
  readonly truncated = signal(false);
  /** Retention removed the log, or the run predates stored logs. */
  readonly pruned = signal(false);
  readonly failed = signal(false);
  /** Lines are still arriving (the stream or the polling is open). */
  readonly live = signal(false);
  /** The counters of the newest line: files written, errors and warnings so far. */
  readonly counters = computed(() => {
    const last = this.lines().at(-1);
    return { files: last?.files ?? 0, errors: last?.errors ?? 0, warnings: last?.warnings ?? 0 };
  });

  private projectKey = '';
  private runId = 0;
  private lastN = 0;
  private generation = 0;
  private stream: Subscription | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private request: Subscription | null = null;
  private onFinished: (() => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Starts reading `runId`'s log; `active` runs follow live and call `finished` once their log is final. */
  open(projectKey: string, runId: number, active: boolean, finished: () => void): void {
    this.stop();
    this.generation++;
    this.projectKey = projectKey;
    this.runId = runId;
    this.lastN = 0;
    this.onFinished = finished;
    this.lines.set([]);
    this.complete.set(false);
    this.truncated.set(false);
    this.pruned.set(false);
    this.failed.set(false);
    if (active) {
      this.live.set(true);
      this.follow();
    } else {
      this.live.set(false);
      this.fetch(false);
    }
  }

  /** The run ended while the log was live: take what the stream did not deliver and finish. */
  settle(): void {
    if (this.live()) {
      this.stopStreaming();
      this.fetch(true);
    }
  }

  /** Reads the log again after a failure. */
  retry(): void {
    this.failed.set(false);
    this.fetch(this.live());
  }

  private follow(): void {
    const token = this.auth.accessToken();
    if (!token) {
      this.poll();
      return;
    }
    const generation = this.generation;
    this.stream = this.api.connectEvents(this.projectKey, this.runId, token).subscribe({
      next: (event) => this.onEvent(event),
      error: () => {
        if (generation === this.generation) {
          this.poll();
        }
      },
      complete: () => {
        if (generation === this.generation) {
          this.stopStreaming();
          this.fetch(true);
        }
      },
    });
  }

  private onEvent(event: GenerationRunEvent): void {
    // STATUS events carry no line number: they are not log lines.
    if (event.n === undefined || event.n <= this.lastN) {
      return;
    }
    this.append([
      {
        n: event.n,
        time: event.time,
        stage: event.stage,
        level: event.level ?? 'info',
        text: event.message,
        files: event.filesWritten,
        errors: event.errors,
        warnings: event.warnings,
      },
    ]);
  }

  private poll(): void {
    this.stopStreaming();
    const generation = this.generation;
    this.request = this.api.runLog(this.projectKey, this.runId, this.lastN).subscribe({
      next: (view) => {
        if (generation !== this.generation) {
          return;
        }
        this.apply(view);
        if (view.complete) {
          this.finish();
        } else {
          this.pollTimer = setTimeout(() => this.poll(), LOG_POLL_MS);
        }
      },
      error: () => {
        if (generation === this.generation) {
          this.pollTimer = setTimeout(() => this.poll(), LOG_POLL_MS);
        }
      },
    });
  }

  /** One read of the lines after the last one seen; `wasLive` runs end here. */
  private fetch(wasLive: boolean): void {
    const generation = this.generation;
    this.request?.unsubscribe();
    this.request = this.api.runLog(this.projectKey, this.runId, this.lastN).subscribe({
      next: (view) => {
        if (generation !== this.generation) {
          return;
        }
        this.apply(view);
        if (wasLive) {
          this.finish();
        } else {
          this.complete.set(true);
        }
      },
      error: () => {
        if (generation === this.generation) {
          this.failed.set(true);
          this.live.set(false);
        }
      },
    });
  }

  private apply(view: components['schemas']['RunLogView']): void {
    this.append(view.lines ?? []);
    this.truncated.set(!!view.truncated);
    this.pruned.set(!!view.pruned);
  }

  private append(incoming: readonly LogLine[]): void {
    const fresh = incoming.filter((line) => (line.n ?? 0) > this.lastN);
    if (fresh.length === 0) {
      return;
    }
    this.lastN = fresh[fresh.length - 1].n ?? this.lastN;
    this.lines.update((lines) => [...lines, ...fresh]);
  }

  private finish(): void {
    this.stopStreaming();
    this.live.set(false);
    this.complete.set(true);
    this.onFinished?.();
  }

  private stopStreaming(): void {
    this.stream?.unsubscribe();
    this.stream = null;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private stop(): void {
    this.stopStreaming();
    this.request?.unsubscribe();
    this.request = null;
  }
}
