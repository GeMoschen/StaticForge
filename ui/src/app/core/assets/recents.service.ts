import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { Observable, catchError, from, map, mergeMap, of, toArray } from 'rxjs';
import { SKIP_ERROR_TOAST } from '../api/error.interceptor';
import { FrameContextStore } from '../frame/frame-context.store';
import { PreferencesService } from '../preferences/preferences.service';
import type { FavoriteEntry, RecentEntry } from '../preferences/preferences.types';
import type { AssetRef } from './asset-ref';

const BASE = '/api/v1';
/** How many assets are resolved at once when a list is checked. */
const VERIFY_CONCURRENCY = 4;
/** A project's lists are checked again after this long (ms). */
const VERIFY_EVERY_MS = 30_000;

/** What resolving one asset came to: it exists (with its current name and place), it is gone, or we could not tell. */
type Resolved = { readonly state: 'found'; readonly ref: AssetRef } | { readonly state: 'gone' } | { readonly state: 'unknown' };

/**
 * The assets a person opened last, per project (M35.15), kept in the preferences (cap and dedupe live there).
 *
 * - {@link visit} records an asset that was opened; the same asset moves to the front.
 * - {@link verify} resolves the recents *and* the favorites of a project through the API: an asset that no longer
 *   exists (404, or deleted) is dropped from both lists, and a renamed or moved one gets its current name and place.
 *   Other failures (offline, a server error) leave the lists as they are. It runs when a list is about to be shown and
 *   at most every {@link VERIFY_EVERY_MS} per project.
 */
@Injectable({ providedIn: 'root' })
export class RecentsService {
  private readonly http = inject(HttpClient);
  private readonly preferences = inject(PreferencesService);
  private readonly frame = inject(FrameContextStore);

  private readonly verifiedAt = new Map<string, number>();

  /** The open project's recents, newest first. */
  readonly list = computed<readonly RecentEntry[]>(() => {
    const key = this.frame.projectKey();
    return key === null ? [] : this.preferences.recents(key);
  });

  /** Records that `asset` was opened in the project. */
  visit(projectKey: string, asset: AssetRef): void {
    this.preferences.addRecent(projectKey, {
      kind: asset.type,
      uuid: asset.uuid,
      title: asset.displayName,
      folderPath: asset.folderPath,
      at: new Date().toISOString(),
    });
  }

  /** Resolves the asset, then records it; an asset that no longer exists leaves the lists instead. */
  visitByUuid(projectKey: string, uuid: string): void {
    this.resolve(projectKey, uuid).subscribe((resolved) => {
      if (resolved.state === 'found') {
        this.visit(projectKey, resolved.ref);
      } else if (resolved.state === 'gone') {
        this.drop(projectKey, uuid);
      }
    });
  }

  /** Takes an asset out of both lists. */
  drop(projectKey: string, uuid: string): void {
    this.preferences.removeRecent(projectKey, uuid);
    this.preferences.setFavorites(
      projectKey,
      this.preferences.favorites(projectKey).filter((f) => f.uuid !== uuid),
    );
  }

  /**
   * Checks the project's recents and favorites against the server (see the class). Completes when done; `force` skips
   * the "checked recently" shortcut.
   */
  verify(projectKey: string, force = false): Observable<void> {
    const last = this.verifiedAt.get(projectKey) ?? 0;
    if (!force && Date.now() - last < VERIFY_EVERY_MS) {
      return of(undefined);
    }
    this.verifiedAt.set(projectKey, Date.now());
    const uuids = [...new Set([...this.preferences.recents(projectKey), ...this.preferences.favorites(projectKey)].map((e) => e.uuid))];
    if (uuids.length === 0) {
      return of(undefined);
    }
    return from(uuids).pipe(
      mergeMap((uuid) => this.resolve(projectKey, uuid).pipe(map((resolved) => ({ uuid, resolved }))), VERIFY_CONCURRENCY),
      toArray(),
      map((results) => {
        this.apply(projectKey, new Map(results.map((r) => [r.uuid, r.resolved])));
      }),
    );
  }

  /** Writes what the server said back: gone assets out, new names and places in. */
  private apply(projectKey: string, resolved: ReadonlyMap<string, Resolved>): void {
    const refresh = <E extends RecentEntry | FavoriteEntry>(entries: readonly E[]): E[] =>
      entries.flatMap((entry) => {
        const result = resolved.get(entry.uuid);
        if (result?.state === 'gone') {
          return [];
        }
        return [result?.state === 'found' ? { ...entry, title: result.ref.displayName, folderPath: result.ref.folderPath } : entry];
      });
    const recents = this.preferences.recents(projectKey);
    const favorites = this.preferences.favorites(projectKey);
    const nextRecents = refresh(recents);
    const nextFavorites = refresh(favorites);
    if (JSON.stringify(nextRecents) !== JSON.stringify(recents)) {
      this.preferences.setRecents(projectKey, nextRecents);
    }
    if (JSON.stringify(nextFavorites) !== JSON.stringify(favorites)) {
      this.preferences.setFavorites(projectKey, nextFavorites);
    }
  }

  private resolve(projectKey: string, uuid: string): Observable<Resolved> {
    return this.http
      .get<{ uuid?: string; type?: string; displayName?: string; folderPath?: string; deleted?: boolean }>(
        `${BASE}/projects/${projectKey}/assets/${uuid}`,
        { withCredentials: true, context: new HttpContext().set(SKIP_ERROR_TOAST, true) },
      )
      .pipe(
        map((detail): Resolved =>
          detail.deleted || !detail.type
            ? { state: 'gone' }
            : { state: 'found', ref: { type: detail.type, uuid, displayName: detail.displayName ?? uuid, folderPath: detail.folderPath } },
        ),
        catchError((error: unknown) => {
          const status = error instanceof HttpErrorResponse ? error.status : 0;
          return of<Resolved>(status === 404 || status === 410 ? { state: 'gone' } : { state: 'unknown' });
        }),
      );
  }
}
