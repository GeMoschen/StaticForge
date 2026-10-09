import type { SfDataTableQuery } from '../../../shared/components/data-table/data-table.types';
import type { UrlArea, UrlRegistryListParams, UrlTargetType } from '../../settings/url-registry.service';

/** Rows per page (the server allows up to 500). */
export const URLS_PAGE_SIZE = 20;

/** The language filter's value for the rows without a language (media and pages of a project without languages). */
export const NO_LANGUAGE = '-';

export const URL_TARGET_TYPES: readonly UrlTargetType[] = ['PAGE', 'FOLDER', 'MEDIA'];
export const URL_AREAS: readonly UrlArea[] = ['GENERATED', 'PREVIEW'];

export const TYPE_ICONS: Readonly<Record<UrlTargetType, string>> = { PAGE: 'description', MEDIA: 'image', FOLDER: 'folder' };

/** The wire's enum value as the key of its texts (`page` and `PAGE` are the same thing to the server). */
export function enumKey(value: string | null | undefined): string {
  return (value ?? '').toUpperCase();
}

/** The server query for what the table holds: its search, filters (one value each) and page. */
export function urlsQueryOf(query: SfDataTableQuery): UrlRegistryListParams {
  const one = (id: string) => query.filters[id]?.[0];
  const locale = one('lang');
  return {
    channelKey: one('channel'),
    area: one('area') as UrlArea | undefined,
    targetType: one('type') as UrlTargetType | undefined,
    ...(locale === NO_LANGUAGE ? { noLocale: true } : { locale }),
    q: query.search.trim() || undefined,
    page: query.page,
    size: URLS_PAGE_SIZE,
  };
}

/** A stored URL (`de/index.html`, `./` for the site's root) as the path the user knows. */
export function urlText(url: string | null | undefined): string {
  if (!url) {
    return '';
  }
  return url === './' ? '/' : `/${url.replace(/^\.?\//, '')}`;
}

/** Whether the typed URL is one the server could accept; the server has the last word (taken, wrong file type …). */
export function isUrlFormatValid(value: string): boolean {
  const url = value.trim();
  return url !== '' && !/[\s?#]/.test(url);
}
