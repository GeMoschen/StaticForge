import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { ApiClient } from '../../../core/api/api.client';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import type { MediaSummaryView } from './media-library.store';
import { isRaster } from './media-library.util';

/** `uuid|locale@revision`; without a revision, the prefix every revision of that file shares. */
function thumbKey(uuid: string, locale: string | null, revision: number | null): string {
  return `${uuid}|${locale ?? ''}${revision != null ? `@${revision}` : ''}`;
}

/** The first lines of a text file that its card shows. */
const SNIPPET_LINES = 7;
/** Text files over this size show an icon instead: reading them just for a card would cost more than it shows. */
const SNIPPET_MAX_BYTES = 32 * 1024;

/**
 * The library's previews: thumbnails of rasters, fetched through `HttpClient` (auth attached) and shown from local blob
 * URLs, and the first lines of small text files. Both are requested per file as its card or row is rendered, so a big
 * folder only costs what is on screen; a request that failed is not repeated until the file changes.
 */
@Injectable()
export class MediaThumbnailStore implements OnDestroy {
  private readonly api = inject(ApiClient);
  /** Localized media shows the editing language's file (M27.6.4). */
  private readonly editingLocale = inject(EditingLocaleStore);

  private readonly thumbUrls = signal<Record<string, string>>({});
  private readonly thumbRequested = new Set<string>();
  private readonly snippets = signal<Record<string, string>>({});
  private readonly snippetRequested = new Set<string>();

  /** Requests the preview of `item` (a raster's thumbnail, a small text file's first lines) unless it is cached. */
  request(projectKey: string, item: MediaSummaryView): void {
    if (!item.uuid) {
      return;
    }
    const locale = item.localized ? this.editingLocale.locale() : null;
    if (isRaster(item.mimeType)) {
      this.requestThumb(projectKey, item.uuid, locale, item.revision ?? null);
    } else if (item.textEditable && (item.sizeBytes ?? 0) <= SNIPPET_MAX_BYTES) {
      this.requestSnippet(projectKey, item.uuid, locale, item.revision ?? null);
    }
  }

  /** Requests the thumbnail of every raster in `items` that is not cached yet. */
  requestAll(projectKey: string, items: readonly MediaSummaryView[]): void {
    for (const item of items) {
      this.request(projectKey, item);
    }
  }

  thumb(item: MediaSummaryView): string | null {
    if (!item.uuid) {
      return null;
    }
    const locale = item.localized ? this.editingLocale.locale() : null;
    return this.thumbUrls()[thumbKey(item.uuid, locale, item.revision ?? null)] ?? null;
  }

  /** The first lines of a text file, once read; `null` before that (and for files that are not read). */
  snippet(item: MediaSummaryView): string | null {
    if (!item.uuid) {
      return null;
    }
    const locale = item.localized ? this.editingLocale.locale() : null;
    return this.snippets()[thumbKey(item.uuid, locale, item.revision ?? null)] ?? null;
  }

  ngOnDestroy(): void {
    for (const url of Object.values(this.thumbUrls())) {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * `locale` for localized media: the thumbnail of the file that language renders, cached per language. Keyed by
   * revision too, so a replaced file (or a language's new own file) is fetched again instead of served stale.
   */
  private requestThumb(projectKey: string, uuid: string, locale: string | null, revision: number | null): void {
    const key = thumbKey(uuid, locale, revision);
    if (this.thumbRequested.has(key)) {
      return;
    }
    this.thumbRequested.add(key);
    this.api.mediaThumbnailBlob(projectKey, uuid, locale).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const stale = thumbKey(uuid, locale, null);
        this.thumbUrls.update((map) => {
          const next = { ...map };
          for (const [cached, old] of Object.entries(map)) {
            if (cached !== key && cached.startsWith(stale + '@')) {
              URL.revokeObjectURL(old);
              delete next[cached];
              this.thumbRequested.delete(cached);
            }
          }
          next[key] = url;
          return next;
        });
      },
      // Stays in `thumbRequested`: a file without a thumbnail shows its icon, and is not asked for again on every render.
      error: () => undefined,
    });
  }

  private requestSnippet(projectKey: string, uuid: string, locale: string | null, revision: number | null): void {
    const key = thumbKey(uuid, locale, revision);
    if (this.snippetRequested.has(key)) {
      return;
    }
    this.snippetRequested.add(key);
    this.api.mediaText(projectKey, uuid, null, locale).subscribe({
      next: (view) => {
        const lines = (view.text ?? '').replace(/^﻿/, '').split(/\r\n|\r|\n/).slice(0, SNIPPET_LINES).join('\n');
        this.snippets.update((map) => ({ ...map, [key]: lines }));
      },
      // A card without its text shows the code icon.
      error: () => undefined,
    });
  }
}
