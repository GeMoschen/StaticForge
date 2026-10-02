import { Injectable, OnDestroy, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { ConflictInfo, ResolveMode, SaveState } from '../../features/pages/types';

const DEFAULT_DEBOUNCE_MS = 500;

/** A finding of a save the rule gate rejected (`ContentIssue` on the wire). */
export interface RejectedFinding {
  path?: string;
  code?: string;
  severity?: string;
  message?: string;
  kind?: string;
  rule?: string;
  locale?: string;
}

/**
 * Whether a failed save is the rule gate's refusal (M33.4): a `422` whose `issues` hold a completeness error — a
 * structural rejection (a malformed value) only carries structural issues and stays an ordinary error.
 */
export function rejectedByRules(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse) || err.status !== 422) {
    return false;
  }
  const issues = (err.error as { issues?: unknown } | null)?.issues;
  return (
    Array.isArray(issues) &&
    issues.some((issue: RejectedFinding) => issue?.kind === 'COMPLETENESS' && issue?.severity === 'ERROR')
  );
}

function clockLabel(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Debounced autosave for one revisioned asset: debounces changes, flushes on demand (blur, Ctrl+S through the
 * active editor, navigation), sends the concurrency token as `If-Match`, and on a `409` surfaces the conflict
 * (with the server's `base`/`theirs` payloads for a field merge) instead of silently overwriting.
 *
 * <p>Shared by the page editor and the record editor (M19.4.2); a subclass says how its asset is
 * persisted and re-read. Provide subclasses at the editor component level, never in root: the state
 * belongs to one open asset.
 *
 * @typeParam P the payload a flush sends
 * @typeParam V the asset view a save or refetch returns (it carries the new `revision`)
 */
@Injectable()
export abstract class AutosaveService<P, V extends { revision?: number | null }> implements OnDestroy {
  readonly saveState = signal<SaveState>('idle');
  readonly lastSavedAt = signal<string | null>(null);
  readonly revision = signal<number | null>(null);
  readonly conflict = signal<ConflictInfo | null>(null);
  /**
   * The findings of the last save the rule gate rejected (M33.8): a save-scope error refused it with `422` and every
   * finding under `issues`. Empty after a successful save.
   */
  readonly rejected = signal<RejectedFinding[]>([]);

  protected projectKey = '';
  protected uuid = '';
  private payloadProvider: (() => P) | null = null;
  private refetchHandler: ((view: V, mode: ResolveMode) => void) | null = null;
  private savedHandler: ((view: V) => void) | null = null;
  private errorHandler: ((err: unknown) => void) | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Whether an edit is waiting to be written: {@link flush} sends nothing without one (an open asset is not an edit). */
  private pending = false;
  private debounceMs = DEFAULT_DEBOUNCE_MS;

  /** Writes the payload with `revision` as the expected revision. */
  protected abstract persist(payload: P, revision: number | undefined): Observable<V>;

  /** Re-reads the current version of the asset. */
  protected abstract reload(): Observable<V>;

  ngOnDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  configure(
    projectKey: string,
    uuid: string,
    initialRevision: number | null = null,
    debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ): void {
    this.projectKey = projectKey;
    this.uuid = uuid;
    this.revision.set(initialRevision);
    this.saveState.set('idle');
    this.conflict.set(null);
    this.pending = false;
    this.debounceMs = debounceMs;
  }

  setPayloadProvider(provider: () => P): void {
    this.payloadProvider = provider;
  }

  setRefetchHandler(handler: (view: V, mode: ResolveMode) => void): void {
    this.refetchHandler = handler;
  }

  /** Called with every successful save's response, e.g. to show non-blocking validation findings. */
  setSavedHandler(handler: (view: V) => void): void {
    this.savedHandler = handler;
  }

  /** Called with every failed save's error that is not a conflict, e.g. to show field-level issues. */
  setErrorHandler(handler: (err: unknown) => void): void {
    this.errorHandler = handler;
  }

  /** Keep the local revision in sync after an external mutation. */
  setRevision(revision: number | null): void {
    this.revision.set(revision);
  }

  /** Whether an edit is waiting to be written (typed, or refused by the last save): leaving must not lose it. */
  get hasPending(): boolean {
    return this.pending;
  }

  /**
   * Gives the waiting edit up (the host re-reads the server's version): no write is sent, a conflict is dropped, and
   * the state is back to idle.
   */
  discardPending(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = false;
    this.conflict.set(null);
    this.rejected.set([]);
    this.saveState.set('idle');
  }

  markDirty(): void {
    if (this.conflict()) {
      return;
    }
    this.pending = true;
    this.saveState.set('dirty');
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  /**
   * Writes the pending edit now (blur, Ctrl+S, leaving the asset). Without a pending edit it does nothing: opening an
   * asset and leaving it again must not append a revision. Resolves `true` when nothing is left unwritten — nothing was
   * pending, or the write succeeded — and `false` when the write failed, conflicted or was refused by the rules.
   */
  flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending || !this.uuid || !this.payloadProvider) {
      return Promise.resolve(true);
    }
    if (this.conflict()) {
      return Promise.resolve(false);
    }
    this.pending = false;
    this.saveState.set('saving');
    const payload = this.payloadProvider();
    const revision = this.revision();
    return new Promise<boolean>((resolve) => {
      this.persist(payload, revision ?? undefined).subscribe({
        next: (res) => {
          this.revision.set(res.revision ?? null);
          this.rejected.set([]);
          this.saveState.set('saved');
          this.lastSavedAt.set(clockLabel(new Date()));
          this.savedHandler?.(res);
          resolve(true);
        },
        error: (err: unknown) => {
          this.onFlushError(err);
          resolve(false);
        },
      });
    });
  }

  /**
   * Reconcile a conflict by refetching latest. "mine" reapplies local edits (host re-saves),
   * "theirs" adopts server content (host rebuilds forms).
   */
  resolveConflict(mode: ResolveMode): void {
    this.saveState.set('saving');
    this.reload().subscribe({
      next: (view) => {
        this.revision.set(view.revision ?? null);
        this.conflict.set(null);
        this.saveState.set('idle');
        if (mode === 'theirs') {
          // The local edits were dropped for the server's content: nothing is left to write.
          this.pending = false;
        }
        this.refetchHandler?.(view, mode);
      },
      error: () => this.saveState.set('error'),
    });
  }

  /**
   * Clear a field-level conflict after the host has merged the payloads, adopting the server's
   * current revision so the next save succeeds.
   */
  resolveFields(revision: number): void {
    this.conflict.set(null);
    this.revision.set(revision);
    this.saveState.set('idle');
  }

  private onFlushError(err: unknown): void {
    // The edit is still unsaved: a retry (Ctrl+S, the next change, leaving) has to send it.
    this.pending = true;
    if (err instanceof HttpErrorResponse && err.status === 409) {
      const body = (err.error ?? {}) as Record<string, unknown>;
      this.conflict.set({
        expectedRevision: this.numberOf(body['expectedRevision'], this.revision() ?? 0),
        currentRevision: this.numberOf(body['currentRevision'], 0),
        detail: typeof body['detail'] === 'string' ? body['detail'] : undefined,
        changedBy: typeof body['changedBy'] === 'number' ? body['changedBy'] : undefined,
        changedAt: typeof body['changedAt'] === 'string' ? body['changedAt'] : undefined,
        base: body['base'],
        theirs: body['theirs'],
      });
    } else if (rejectedByRules(err)) {
      this.rejected.set(((err as HttpErrorResponse).error as { issues: RejectedFinding[] }).issues);
      this.saveState.set('rejected');
      return;
    } else {
      this.errorHandler?.(err);
    }
    this.saveState.set('error');
  }

  private numberOf(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }
}
