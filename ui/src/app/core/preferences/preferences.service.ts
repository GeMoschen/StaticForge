import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { SKIP_ERROR_TOAST } from '../api/error.interceptor';
import { applyMergePatch, composePatches, isEmptyPatch, patchAt, readPath } from './merge-patch';
import {
  MIGRATION_REMOVES_LOCAL_KEYS,
  collectLegacyMigration,
  removeLegacyKeys,
} from './preferences-migration';
import {
  DEFAULT_DENSITY,
  DEFAULT_PREVIEW_VIEW,
  DEFAULT_THEME,
  DensityPreference,
  FavoriteEntry,
  MergePatch,
  PREFERENCES_SCHEMA_VERSION,
  PreferencesDocument,
  PreviewViewPreference,
  RECENTS_CAP,
  RecentEntry,
  ThemePreference,
} from './preferences.types';

const URL = '/api/v1/me/preferences';
const DEBOUNCE_MS = 500;
/** A steady stream of edits (a dragged splitter) still reaches the server at least this often. */
const MAX_WAIT_MS = 5000;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;
/** The server refuses these for good (invalid / too large): retrying the same patch can never succeed. */
const PERMANENT_STATUSES = new Set([400, 413, 422]);

/** Whether a successful migration removes the `localStorage` keys it moved (see {@link MIGRATION_REMOVES_LOCAL_KEYS}). */
export const REMOVE_LEGACY_KEYS = new InjectionToken<boolean>('REMOVE_LEGACY_KEYS', {
  providedIn: 'root',
  factory: () => MIGRATION_REMOVES_LOCAL_KEYS,
});

function emptyDocument(): PreferencesDocument {
  return { schemaVersion: PREFERENCES_SCHEMA_VERSION };
}

/**
 * The signed-in user's preferences (M35.3): one JSON document on the server, read once after login and edited through
 * typed accessors.
 *
 * - Edits apply locally at once (optimistic) and are sent as a debounced RFC 7386 merge patch.
 * - Pending edits are coalesced into one patch and never dropped. One request is in flight at a time; edits made
 *   meanwhile go out in a follow-up request (see "A throttle must defer, not drop" in `tasks/lessons.md`).
 * - A failed patch keeps its keys and is retried with backoff, merged under any newer edits.
 * - Without a loaded document (offline, load failed) the accessors return their defaults and edits still queue.
 *
 * Loading and resetting follow the session: see `providePreferencesSync`.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly http = inject(HttpClient);
  private readonly removeLegacy = inject(REMOVE_LEGACY_KEYS);

  private readonly document = signal<PreferencesDocument>(emptyDocument());
  private readonly _loaded = signal(false);
  private readonly _loadFailed = signal(false);

  /** Whether the server document has been read for this session. */
  readonly loaded = this._loaded.asReadonly();
  /** True after a failed read: the defaults are in use until the next {@link load}. */
  readonly loadFailed = this._loadFailed.asReadonly();

  // Sync state: plain fields, nothing renders from them.
  private pending: MergePatch = {};
  private sending: MergePatch = {};
  private pendingRemoval: string[] = [];
  private sendingRemoval: string[] = [];
  private inFlight = false;
  private loading = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingSince = 0;
  /** Bumped by {@link reset} so that responses belonging to a previous session are ignored. */
  private epoch = 0;

  // Typed instance-wide accessors.
  readonly theme = computed<ThemePreference>(() => this.document().theme ?? DEFAULT_THEME);
  readonly density = computed<DensityPreference>(() => this.document().density ?? DEFAULT_DENSITY);
  readonly developerMode = computed(() => this.document().developerMode ?? false);
  readonly railCollapsed = computed(() => this.document().railCollapsed ?? false);
  readonly paneSizes = computed<Record<string, number>>(() => this.document().paneSizes ?? {});
  readonly previewView = computed<PreviewViewPreference>(() => this.document().previewView ?? DEFAULT_PREVIEW_VIEW);
  readonly issueScopes = computed<string[]>(() => this.document().issueScopes ?? []);

  setTheme(value: ThemePreference): void {
    this.set(['theme'], value);
  }
  setDensity(value: DensityPreference): void {
    this.set(['density'], value);
  }
  setDeveloperMode(value: boolean): void {
    this.set(['developerMode'], value);
  }
  setRailCollapsed(value: boolean): void {
    this.set(['railCollapsed'], value);
  }
  setPreviewView(value: PreviewViewPreference): void {
    this.set(['previewView'], value);
  }
  setIssueScopes(value: string[]): void {
    this.set(['issueScopes'], value);
  }
  paneSize(paneId: string): number | undefined {
    return this.paneSizes()[paneId];
  }
  setPaneSize(paneId: string, size: number): void {
    this.set(['paneSizes', paneId], size);
  }

  // Typed per-project accessors (read inside computed/templates: they track the document).
  treeExpansion(projectKey: string, treeId: string): string[] {
    return this.document().projects?.[projectKey]?.treeExpansion?.[treeId] ?? [];
  }
  setTreeExpansion(projectKey: string, treeId: string, expanded: string[]): void {
    this.set(['projects', projectKey, 'treeExpansion', treeId], expanded);
  }
  recents(projectKey: string): RecentEntry[] {
    return this.document().projects?.[projectKey]?.recents ?? [];
  }
  /** Puts an entry first in the project's recents, dropping an earlier visit of the same record and capping the list. */
  addRecent(projectKey: string, entry: RecentEntry): void {
    const rest = this.recents(projectKey).filter((r) => !(r.kind === entry.kind && r.uuid === entry.uuid));
    this.set(['projects', projectKey, 'recents'], [entry, ...rest].slice(0, RECENTS_CAP));
  }
  favorites(projectKey: string): FavoriteEntry[] {
    return this.document().projects?.[projectKey]?.favorites ?? [];
  }
  setFavorites(projectKey: string, favorites: FavoriteEntry[]): void {
    this.set(['projects', projectKey, 'favorites'], favorites);
  }
  editingLocale(projectKey: string): string | null {
    return this.document().projects?.[projectKey]?.editingLocale ?? null;
  }
  setEditingLocale(projectKey: string, locale: string | null): void {
    this.set(['projects', projectKey, 'editingLocale'], locale);
  }
  /** Hidden record-grid columns of one dataset. */
  gridColumns(projectKey: string, datasetUuid: string): string[] {
    return this.document().projects?.[projectKey]?.gridColumns?.[datasetUuid] ?? [];
  }
  setGridColumns(projectKey: string, datasetUuid: string, hidden: string[]): void {
    this.set(['projects', projectKey, 'gridColumns', datasetUuid], hidden);
  }

  /** Reads the value at a path of the document (tracks the document when called reactively). */
  get<T = unknown>(path: readonly string[]): T | undefined {
    return readPath(this.document(), path) as T | undefined;
  }

  /**
   * Sets (or, for `null`/`undefined`, removes) the value at a path: applied locally at once, sent with the next patch.
   * Leaf values only: an object value would be merged into the server's, not replace it.
   */
  set(path: readonly string[], value: unknown): void {
    this.apply(patchAt(path, value));
    this.schedule();
  }

  /**
   * Reads the server document. Whatever was edited locally and not yet acknowledged stays on top of it; then the legacy
   * `localStorage` keys are migrated (once, and only values the server lacks). A failure keeps the defaults.
   */
  load(): void {
    if (this.loading) {
      return;
    }
    this.loading = true;
    const epoch = this.epoch;
    this.http.get<PreferencesDocument>(URL, { context: new HttpContext().set(SKIP_ERROR_TOAST, true) }).subscribe({
      next: (server) => {
        if (epoch !== this.epoch) {
          return;
        }
        this.loading = false;
        this._loaded.set(true);
        this._loadFailed.set(false);
        const unacknowledged = composePatches(this.sending, this.pending);
        this.document.set(applyMergePatch(server, unacknowledged) as PreferencesDocument);
        this.migrateLegacy();
      },
      error: () => {
        if (epoch !== this.epoch) {
          return;
        }
        this.loading = false;
        this._loadFailed.set(true);
      },
    });
  }

  /** Forgets everything of the previous session (logout, user switch); its unsent edits are discarded. */
  reset(): void {
    this.epoch++;
    this.clearTimer();
    this.pending = {};
    this.sending = {};
    this.pendingRemoval = [];
    this.sendingRemoval = [];
    this.inFlight = false;
    this.loading = false;
    this.failures = 0;
    this.document.set(emptyDocument());
    this._loaded.set(false);
    this._loadFailed.set(false);
  }

  private apply(patch: MergePatch): void {
    this.document.update((doc) => applyMergePatch(doc, patch) as PreferencesDocument);
    if (isEmptyPatch(this.pending)) {
      this.pendingSince = Date.now();
    }
    this.pending = composePatches(this.pending, patch);
  }

  private migrateLegacy(): void {
    const { patch, keys } = collectLegacyMigration(this.document());
    if (keys.length === 0) {
      return;
    }
    if (isEmptyPatch(patch)) {
      // The server already holds everything these keys say.
      if (this.removeLegacy) {
        removeLegacyKeys(keys);
      }
      return;
    }
    this.apply(patch);
    this.pendingRemoval.push(...keys);
    this.flush();
  }

  /** (Re)starts the debounce, unless a request or retry backoff is running or the oldest pending edit waited long enough. */
  private schedule(): void {
    if (this.inFlight || this.failures > 0) {
      return; // completion (or the retry timer) sends what is pending
    }
    if (this.timer !== null && Date.now() - this.pendingSince >= MAX_WAIT_MS) {
      return;
    }
    this.clearTimer();
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private flush(): void {
    this.clearTimer();
    if (this.inFlight || isEmptyPatch(this.pending)) {
      return;
    }
    const epoch = this.epoch;
    this.sending = this.pending;
    this.sendingRemoval = this.pendingRemoval;
    this.pending = {};
    this.pendingRemoval = [];
    this.inFlight = true;
    this.http
      .patch<PreferencesDocument>(URL, this.sending, {
        headers: { 'Content-Type': 'application/merge-patch+json' },
        context: new HttpContext().set(SKIP_ERROR_TOAST, true),
      })
      .subscribe({
        next: (merged) => {
          if (epoch !== this.epoch) {
            return;
          }
          this.inFlight = false;
          this.failures = 0;
          this.sending = {};
          if (this.removeLegacy) {
            removeLegacyKeys(this.sendingRemoval);
          }
          this.sendingRemoval = [];
          // The server's merged document, with the edits made during the request still on top.
          this.document.set(applyMergePatch(merged, this.pending) as PreferencesDocument);
          this.flush();
        },
        error: (err: unknown) => {
          if (epoch !== this.epoch) {
            return;
          }
          this.inFlight = false;
          if (err instanceof HttpErrorResponse && PERMANENT_STATUSES.has(err.status)) {
            // Retrying can never succeed; drop this patch so it cannot block newer edits.
            console.warn('Preferences patch rejected by the server and dropped', err.status);
            this.sending = {};
            this.sendingRemoval = [];
            this.flush();
            return;
          }
          this.pending = composePatches(this.sending, this.pending);
          this.pendingRemoval = [...this.sendingRemoval, ...this.pendingRemoval];
          this.sending = {};
          this.sendingRemoval = [];
          this.failures++;
          const delay = Math.min(RETRY_BASE_MS * 2 ** (this.failures - 1), RETRY_MAX_MS);
          this.timer = setTimeout(() => this.flush(), delay);
        },
      });
  }
}
