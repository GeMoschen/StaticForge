import { inject, Injectable } from '@angular/core';
import { EMPTY, type Observable, catchError, expand, map, of, reduce, shareReplay, switchMap } from 'rxjs';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ChannelsService } from '../channels/channels.service';
import { type PageUrlRegistryEntryView, type UrlRegistryEntryView, UrlRegistryService } from '../settings/url-registry.service';
import { pageUrl } from './folder-view.util';

/** A page's address as shown to people: the registered URL, or the computed one while nothing is registered yet. */
export interface PageAddress {
  url: string;
  /** `false` = the URL is computed from the folder path and UID, not yet assigned in the URL registry. */
  registered: boolean;
}

const PAGE_SIZE = 500;

/** A registry href (`products/hammer/`, `./`) as a site-root path with a leading slash (`/products/hammer/`, `/`). */
export function registryDisplayUrl(href: string): string {
  const trimmed = href.replace(/^\.\//, '').replace(/^\/+/, '');
  return `/${trimmed}`;
}

/**
 * The registered URL of each page: the GENERATED row wins over the PREVIEW row, only page 1 counts, and only the
 * project's default channel and the editing language are read. Pure.
 */
export function registeredPageUrls(entries: readonly UrlRegistryEntryView[]): ReadonlyMap<string, string> {
  const generated = new Map<string, string>();
  const preview = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.targetUuid || entry.url == null || (entry.pageNumber ?? 1) !== 1 || entry.variant) {
      continue;
    }
    const target = entry.area?.toUpperCase() === 'GENERATED' ? generated : entry.area?.toUpperCase() === 'PREVIEW' ? preview : null;
    if (target && !target.has(entry.targetUuid)) {
      target.set(entry.targetUuid, registryDisplayUrl(entry.url));
    }
  }
  return new Map([...preview, ...generated]);
}

/** The address of one page: registered when the registry has it, otherwise computed (and marked as such). */
export function pageAddress(registered: ReadonlyMap<string, string>, uuid: string, folderPath: string, uid: string): PageAddress {
  const url = registered.get(uuid);
  return url === undefined ? { url: pageUrl(folderPath, uid), registered: false } : { url, registered: true };
}

/**
 * Reads page URLs from the URL registry instead of computing them (the folder list's URL column, the page settings'
 * address). One request per call reads every registered page URL of the project's default channel — the registry has
 * no folder filter — and only when a project has more than 500 of them are further pages fetched.
 */
@Injectable({ providedIn: 'root' })
export class PageUrlService {
  private readonly registry = inject(UrlRegistryService);
  private readonly channels = inject(ChannelsService);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly defaultChannels = new Map<string, Observable<string | undefined>>();

  /** uuid → display URL of every page that has a registered URL; `targetUuid` narrows it to one page. */
  registered(projectKey: string, targetUuid?: string): Observable<ReadonlyMap<string, string>> {
    const locale = this.editingLocale.locale() ?? undefined;
    return this.defaultChannel(projectKey).pipe(
      switchMap((channelKey) => {
        const read = (page: number) => this.registry.list(projectKey, { channelKey, targetType: 'PAGE', locale, targetUuid, page, size: PAGE_SIZE, quiet: true });
        return read(0).pipe(
          expand((result) => (result.last === false ? read((result.number ?? 0) + 1) : EMPTY)),
          reduce<PageUrlRegistryEntryView, UrlRegistryEntryView[]>((all, result) => all.concat(result.content ?? []), []),
        );
      }),
      map(registeredPageUrls),
      catchError(() => of(new Map<string, string>() as ReadonlyMap<string, string>)),
    );
  }

  private defaultChannel(projectKey: string): Observable<string | undefined> {
    let known = this.defaultChannels.get(projectKey);
    if (!known) {
      known = this.channels.list(projectKey).pipe(
        map((list) => (list.find((channel) => channel.isDefault) ?? list.find((channel) => channel.enabled !== false))?.key),
        catchError(() => of(undefined)),
        shareReplay(1),
      );
      this.defaultChannels.set(projectKey, known);
    }
    return known;
  }
}
