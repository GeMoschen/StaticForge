import { Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { GlobalsService } from '../../globals/globals.service';
import { MediaDrawerStore } from './media-drawer.store';

/** At most this many global sets are read for their values (one request each). */
const MAX_GLOBAL_SETS = 40;
/** At most this many names are offered. */
const MAX_NAMES = 2000;

/** The dotted paths of the scalar values in `node` (`brand.accentColor`); lists are not followed. */
export function valuePaths(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return prefix && node !== undefined && !Array.isArray(node) ? [prefix] : [];
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    valuePaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

/**
 * The project's names the Source tab's completion offers inside an instruction (decision 102): the global values
 * (`CMS_GLOBAL.<set>.<path>`), the media UIDs (`media:<uid>`, from the library's project-wide list) and the pages
 * (`page:<uid>`). Read once, when the Source tab is first opened; a failed read just offers fewer names.
 */
@Injectable()
export class MediaDrawerNamesStore {
  private readonly core = inject(MediaDrawerStore);
  private readonly globalsApi = inject(GlobalsService);

  private readonly globals = signal<readonly string[]>([]);
  private readonly pages = signal<readonly string[]>([]);
  private loaded = false;

  readonly names = computed<readonly string[]>(() => {
    const media = this.core.mediaUids().map((uid) => `media:${uid}`);
    return [...new Set([...this.globals(), ...media, ...this.pages()])].slice(0, MAX_NAMES);
  });

  load(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const key = this.core.projectKey();
    this.core.api
      .listPages(key)
      .pipe(catchError(() => of([])))
      .subscribe((pages) => this.pages.set(pages.map((page) => (page.uid ? `page:${page.uid}` : '')).filter((name) => name)));
    this.globalsApi
      .list(key)
      .pipe(catchError(() => of([])))
      .subscribe((sets) => {
        const wanted = sets.filter((set) => set.uuid && set.uid).slice(0, MAX_GLOBAL_SETS);
        if (wanted.length === 0) {
          return;
        }
        forkJoin(
          wanted.map((set) =>
            this.globalsApi.get(key, set.uuid!).pipe(
              catchError(() => of(null)),
            ),
          ),
        ).subscribe((details) =>
          this.globals.set(
            details.flatMap((detail, index) =>
              detail ? valuePaths(detail.content).map((path) => `CMS_GLOBAL.${wanted[index].uid}.${path}`) : [],
            ),
          ),
        );
      });
  }
}
