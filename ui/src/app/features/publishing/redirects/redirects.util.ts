import type { SfDataTableQuery } from '../../../shared/components/data-table/data-table.types';
import type { SfStatusTone } from '../../../shared/components/display/sf-status.component';
import type { RedirectKind, RedirectState, RedirectsQuery } from '../../settings/redirects.service';

/** Rows per page (the server's default; it allows up to 200). */
export const REDIRECTS_PAGE_SIZE = 50;

/** The language filter's value for the rows without a language (channels without languages, e.g. files). */
export const NO_LANGUAGE = '-';

export const REDIRECT_KINDS: readonly RedirectKind[] = ['AUTO', 'MANUAL'];
export const REDIRECT_STATES: readonly RedirectState[] = ['ACTIVE', 'SHADOWED', 'DANGLING', 'LOOP'];

export const REDIRECT_STATE_TONES: Readonly<Record<RedirectState, SfStatusTone>> = {
  ACTIVE: 'success',
  SHADOWED: 'neutral',
  DANGLING: 'warning',
  LOOP: 'danger',
};

export const REDIRECT_STATE_ICONS: Readonly<Record<RedirectState, string>> = {
  ACTIVE: 'check_circle',
  SHADOWED: 'visibility_off',
  DANGLING: 'link_off',
  LOOP: 'sync_problem',
};

/** The state a row has against the default target's build; `null` while nothing is published there. */
export function stateOf(state: string | null | undefined): RedirectState | null {
  return REDIRECT_STATES.find((s) => s === state) ?? null;
}

/** The server query for what the table holds: its search, filters (one value each) and page. */
export function redirectsQueryOf(query: SfDataTableQuery): RedirectsQuery {
  const one = (id: string) => query.filters[id]?.[0];
  const locale = one('lang');
  return {
    channel: one('channel'),
    ...(locale === NO_LANGUAGE ? { noLocale: true } : { locale }),
    kind: one('kind') as RedirectKind | undefined,
    state: one('state') as RedirectState | undefined,
    q: query.search.trim() || undefined,
    page: query.page,
    size: REDIRECTS_PAGE_SIZE,
  };
}
