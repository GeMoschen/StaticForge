import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { ApiClient } from '../../../core/api/api.client';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import type { MediaView } from './media-library.store';

/** `uuid|locale@revision`; without a revision, the prefix every revision of that file shares. */
function thumbKey(uuid: string, locale: string | null, revision: number | null): string {
  return `${uuid}|${locale ?? ''}${revision != null ? `@${revision}` : ''}`;
}

/** The grid's thumbnails: fetched through `HttpClient` (auth attached) and shown from local blob URLs. */
@Injectable()
export class MediaThumbnailStore implements OnDestroy {
  private readonly api = inject(ApiClient);
  /** Localized media shows the editing language's file (M27.6.4). */
  private readonly editingLocale = inject(EditingLocaleStore);

  private readonly thumbUrls = signal<Record<string, string>>({});
  private readonly thumbRequested = new Set<string>();

  /** Requests the thumbnail of every image in `items` that is not cached yet. */
  requestAll(projectKey: string, items: MediaView[]): void {
    const locale = this.editingLocale.locale();
    for (const item of items) {
      if (item.uuid && (item.mimeType ?? '').startsWith('image/')) {
        this.requestThumb(projectKey, item.uuid, item.localized ? locale : null, item.revision ?? null);
      }
    }
  }

  thumb(item: MediaView): string | null {
    if (!item.uuid) {
      return null;
    }
    const locale = item.localized ? this.editingLocale.locale() : null;
    return this.thumbUrls()[thumbKey(item.uuid, locale, item.revision ?? null)] ?? null;
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
      error: () => this.thumbRequested.delete(key),
    });
  }
}
