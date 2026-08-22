import {
  Injectable,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import type { ConflictInfo, ResolveMode, SaveState } from './types';

type PageView = components['schemas']['PageView'];

/** Full page payload persisted on flush. */
export interface PagePayload {
  content?: unknown;
  bodies?: unknown;
  nav?: unknown;
  output?: unknown;
  meta?: unknown;
}

const DEBOUNCE_MS = 1500;

function clockLabel(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Debounced autosave for the page editor. Debounces changes, flushes on blur
 * / section switch / Ctrl+S, and — on a 409 conflict — surfaces the conflict
 * instead of silently overwriting. Provided at the page-editor component level
 * (NOT root).
 */
@Injectable()
export class PageAutosaveService implements OnDestroy {
  private readonly api = inject(ApiClient);

  readonly saveState = signal<SaveState>('idle');
  readonly lastSavedAt = signal<string | null>(null);
  readonly revision = signal<number | null>(null);
  readonly conflict = signal<ConflictInfo | null>(null);

  private projectKey = '';
  private uuid = '';
  private payloadProvider: (() => PagePayload) | null = null;
  private refetchHandler: ((page: PageView, mode: ResolveMode) => void) | null = null;

  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly onKeydownRef = (event: KeyboardEvent) => this.onKeydown(event);

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.onKeydownRef);
    }
  }

  ngOnDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.onKeydownRef);
    }
  }

  configure(projectKey: string, uuid: string, initialRevision: number | null = null): void {
    this.projectKey = projectKey;
    this.uuid = uuid;
    this.revision.set(initialRevision);
    this.saveState.set('idle');
    this.conflict.set(null);
    this.dirty = false;
  }

  setPayloadProvider(provider: () => PagePayload): void {
    this.payloadProvider = provider;
  }

  setRefetchHandler(handler: (page: PageView, mode: ResolveMode) => void): void {
    this.refetchHandler = handler;
  }

  /** Keep the local revision in sync after an external page mutation. */
  setRevision(revision: number | null): void {
    this.revision.set(revision);
  }

  markDirty(): void {
    if (this.conflict()) {
      return;
    }
    this.dirty = true;
    this.saveState.set('dirty');
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.uuid || !this.payloadProvider || this.conflict()) {
      return;
    }
    this.dirty = false;
    this.saveState.set('saving');
    const payload = this.payloadProvider();
    const revision = this.revision();
    this.api
      .updatePage(this.projectKey, this.uuid, payload, revision ?? undefined)
      .subscribe({
        next: (res) => {
          this.revision.set(res.revision ?? null);
          this.saveState.set('saved');
          this.lastSavedAt.set(clockLabel(new Date()));
        },
        error: (err: unknown) => this.onFlushError(err),
      });
  }

  /**
   * Reconcile a conflict by refetching latest. "mine" reapplies local edits
   * (host re-saves), "theirs" adopts server content (host rebuilds forms).
   */
  resolveConflict(mode: ResolveMode): void {
    this.saveState.set('saving');
    this.api.pageDetail(this.projectKey, this.uuid).subscribe({
      next: (page) => {
        this.revision.set(page.revision ?? null);
        this.conflict.set(null);
        this.dirty = false;
        this.saveState.set('idle');
        this.refetchHandler?.(page, mode);
      },
      error: () => this.saveState.set('error'),
    });
  }

  /**
   * Clear a field-level conflict after the host has merged the payloads,
   * adopting the server's current revision so the next save succeeds.
   */
  resolveFields(revision: number): void {
    this.conflict.set(null);
    this.revision.set(revision);
    this.dirty = false;
    this.saveState.set('idle');
  }

  private onFlushError(err: unknown): void {
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
    }
    this.saveState.set('error');
  }

  private numberOf(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.flush();
    }
  }
}

export type { ConflictInfo, ResolveMode, SaveState };
