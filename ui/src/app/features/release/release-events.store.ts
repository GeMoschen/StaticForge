import { Injectable, signal } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import type { ReleaseBlock } from './release-status.util';

type ScheduledRefView = components['schemas']['ScheduledRefView'];

/** The release state of one asset as the server last reported it to a release bar. */
export interface ObservedRelease {
  uuid: string;
  release: ReleaseBlock;
  scheduled: ScheduledRefView[] | undefined;
}

/** A row of a list or tree that shows a release badge. */
interface ReleaseRow {
  uuid?: string;
  release?: ReleaseBlock;
  scheduled?: ScheduledRefView[];
}

/**
 * Tells every screen that shows release state that it changed (M27.6): a release, unpublish, discard or schedule
 * action bumps {@link version}, and the trees, lists, release bars and the nav-rail count re-read what they show.
 * No polling — the server stays the one source of statuses.
 *
 * <p>{@link observed} is the finer signal: an editor's release bar re-reads its asset after every save, and lists
 * holding that asset patch their row with what the server said ({@link withObservedRelease}) — so a tree shows
 * "Changed" as soon as the editor saved, without reloading the whole list.
 */
@Injectable({ providedIn: 'root' })
export class ReleaseEventsStore {
  readonly version = signal(0);
  readonly observed = signal<ObservedRelease | null>(null);

  changed(): void {
    this.version.update((value) => value + 1);
  }

  observe(observed: ObservedRelease): void {
    this.observed.set(observed);
  }
}

/**
 * `rows` with the observed asset's release state applied, or `null` when no row is that asset or it already shows
 * that state (so callers only write their signal when something changed).
 */
export function withObservedRelease<T extends ReleaseRow>(rows: readonly T[], observed: ObservedRelease | null): T[] | null {
  if (!observed) {
    return null;
  }
  const index = rows.findIndex((row) => row.uuid === observed.uuid);
  if (index < 0) {
    return null;
  }
  const row = rows[index];
  if (
    JSON.stringify(row.release ?? null) === JSON.stringify(observed.release ?? null) &&
    JSON.stringify(row.scheduled ?? []) === JSON.stringify(observed.scheduled ?? [])
  ) {
    return null;
  }
  const next = [...rows];
  next[index] = { ...row, release: observed.release ?? undefined, scheduled: observed.scheduled };
  return next;
}
