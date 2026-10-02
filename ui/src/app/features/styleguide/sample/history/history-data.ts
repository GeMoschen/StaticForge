/**
 * Fake data of the sample's History (M35.9 review round 2, M35.12): the project's revisions of the coffee-roaster site,
 * each with its author, a human summary, the assets it touched (by name, with the languages and the field changes) and
 * the kind of change. Content, not UI text — the labels live in `en.json` under `styleguide.sample.history.*`. Times
 * are minutes before "now". Nothing is saved.
 */
import { CHANGE_PEOPLE, CHANGE_TYPE_ICONS, ChangeLang, ChangePerson, ChangeType } from '../changes/changes-data';

export { CHANGE_PEOPLE as HISTORY_PEOPLE, CHANGE_TYPE_ICONS as HISTORY_TYPE_ICONS };
export type { ChangeLang as HistoryLang, ChangeType as HistoryAssetType };

/** What a revision was: the change type of the API. */
export type HistoryKind = 'edit' | 'release' | 'restore' | 'create' | 'delete' | 'import';
export const HISTORY_KINDS: readonly HistoryKind[] = ['edit', 'release', 'restore', 'create', 'delete', 'import'];
export const HISTORY_KIND_ICONS: Readonly<Record<HistoryKind, string>> = {
  edit: 'edit_note',
  release: 'publish',
  restore: 'restore',
  create: 'add_circle',
  delete: 'delete',
  import: 'upload',
};

export type HistoryAction = 'created' | 'changed' | 'deleted' | 'released' | 'restored';

/** One field of an asset in a revision: the value before, the value the revision wrote, and the value now. */
export interface HistoryField {
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly current: string | null;
}

export interface HistoryAsset {
  /** The asset's id (what the editor's History drawer filters on). */
  readonly asset: string;
  readonly name: string;
  readonly type: ChangeType;
  readonly action: HistoryAction;
  /** The languages the revision touched; empty = the asset as a whole (a delete, a move). */
  readonly langs: readonly ChangeLang[];
  readonly fields: readonly HistoryField[];
}

export interface HistoryRevision {
  readonly id: number;
  readonly minutes: number;
  readonly by: ChangePerson;
  readonly kind: HistoryKind;
  /** The human summary: what the revision did, in one line. */
  readonly summary: string;
  readonly assets: readonly HistoryAsset[];
}

export const PAGE_ASSET = 'spring_harvest';
export const RECORD_ASSET = 'yirgacheffe';
/** The revision `hrev=1` and the time-travel banner open. */
export const FIXED_REVISION = 86;

const HOUR = 60;
const DAY = 24 * HOUR;
const [anna, jonas, mira, lukas, sofia] = CHANGE_PEOPLE;

const f = (label: string, before: string | null, after: string | null, current: string | null = after): HistoryField => ({
  label,
  before,
  after,
  current,
});

const page = (action: HistoryAction, langs: readonly ChangeLang[], fields: readonly HistoryField[]): HistoryAsset => ({
  asset: PAGE_ASSET,
  name: 'Spring harvest arrives',
  type: 'page',
  action,
  langs,
  fields,
});

const record = (action: HistoryAction, langs: readonly ChangeLang[], fields: readonly HistoryField[]): HistoryAsset => ({
  asset: RECORD_ASSET,
  name: 'Yirgacheffe Konga 250 g',
  type: 'record',
  action,
  langs,
  fields,
});

export const HISTORY: readonly HistoryRevision[] = [
  {
    id: 90,
    minutes: 25,
    by: anna,
    kind: 'edit',
    summary: 'Changed the title and teaser of Spring harvest arrives',
    assets: [
      page('changed', ['de'], [
        f('Title', 'Die Frühlingsernte ist da', 'Die Frühlingsernte ist angekommen'),
        f('Teaser', 'Frische Bohnen aus Äthiopien und Kolumbien.', 'Frische Bohnen aus Äthiopien, Kolumbien und erstmals aus Ruanda.'),
      ]),
    ],
  },
  {
    id: 89,
    minutes: 50,
    by: anna,
    kind: 'edit',
    summary: 'Added the section Product teaser',
    assets: [
      page('changed', ['de', 'en'], [f('Sections', 'Hero, Text, Quote', 'Hero, Text, Product teaser, Quote')]),
      record('changed', ['en'], [f('Price', '€12.90', '€13.50')]),
    ],
  },
  {
    id: 88,
    minutes: 2 * HOUR + 10,
    by: mira,
    kind: 'edit',
    summary: 'Changed the Quote',
    assets: [page('changed', ['en'], [f('Quote', '“The best beans we have roasted.”', '“The best beans we have roasted this year.”')])],
  },
  {
    id: 87,
    minutes: 3 * HOUR,
    by: jonas,
    kind: 'import',
    summary: 'Imported 12 products from the shop export',
    assets: [
      { asset: 'products_import', name: 'Products', type: 'record', action: 'created', langs: ['de', 'en'], fields: [f('Records', null, '12 records')] },
    ],
  },
  {
    id: 86,
    minutes: 5 * HOUR,
    by: jonas,
    kind: 'release',
    summary: 'Released Spring harvest arrives and Single origins',
    assets: [
      page('released', ['de', 'en'], [f('Status', 'Changed', 'Published')]),
      { asset: 'single_origins', name: 'Single origins', type: 'page', action: 'released', langs: ['de', 'en'], fields: [f('Status', 'Changed', 'Published')] },
    ],
  },
  {
    id: 85,
    minutes: 8 * HOUR,
    by: sofia,
    kind: 'edit',
    summary: 'Changed the opening hours in the Globals',
    assets: [
      {
        asset: 'site_settings',
        name: 'Site settings',
        type: 'global',
        action: 'changed',
        langs: ['de'],
        fields: [f('Opening hours', 'Mo–Fr 8–18 Uhr', 'Mo–Fr 8–19 Uhr, Sa 9–16 Uhr')],
      },
    ],
  },
  {
    id: 84,
    minutes: DAY + 2 * HOUR,
    by: lukas,
    kind: 'delete',
    summary: 'Deleted the page Old roasting guide',
    assets: [{ asset: 'old_guide', name: 'Old roasting guide', type: 'page', action: 'deleted', langs: [], fields: [] }],
  },
  {
    id: 83,
    minutes: DAY + 6 * HOUR,
    by: mira,
    kind: 'edit',
    summary: 'Changed the hero headline of Spring harvest arrives',
    assets: [page('changed', ['en'], [f('Hero headline', 'Roasted in Hamburg', 'Roasted in Hamburg since 2009')])],
  },
  {
    id: 82,
    minutes: 2 * DAY,
    by: anna,
    kind: 'restore',
    summary: 'Restored Yirgacheffe Konga 250 g to revision 71',
    assets: [record('restored', ['de', 'en'], [f('Price', '€14.90', '€12.90', '€13.50')])],
  },
  {
    id: 81,
    minutes: 3 * DAY,
    by: jonas,
    kind: 'release',
    summary: 'Released the main navigation',
    assets: [
      { asset: 'main_nav', name: 'Main navigation', type: 'navigation', action: 'released', langs: ['de', 'en'], fields: [f('Status', 'Changed', 'Published')] },
    ],
  },
  {
    id: 80,
    minutes: 3 * DAY + 4 * HOUR,
    by: anna,
    kind: 'create',
    summary: 'Created the page Spring harvest arrives',
    assets: [
      page('created', ['de', 'en'], [
        f('Title', null, 'Die Frühlingsernte ist da', 'Die Frühlingsernte ist angekommen'),
        f('Teaser', null, 'Frische Bohnen aus Äthiopien und Kolumbien.', 'Frische Bohnen aus Äthiopien, Kolumbien und erstmals aus Ruanda.'),
      ]),
    ],
  },
  {
    id: 79,
    minutes: 6 * DAY,
    by: sofia,
    kind: 'edit',
    summary: 'Changed the price of Yirgacheffe Konga 250 g',
    assets: [record('changed', ['de', 'en'], [f('Price', '€12.90', '€14.90', '€13.50')])],
  },
  {
    id: 78,
    minutes: 12 * DAY,
    by: lukas,
    kind: 'create',
    summary: 'Created the record Yirgacheffe Konga 250 g',
    assets: [record('created', ['de', 'en'], [f('Price', null, '€12.90', '€13.50'), f('Origin', null, 'Äthiopien')])],
  },
  {
    id: 77,
    minutes: 40 * DAY,
    by: jonas,
    kind: 'import',
    summary: 'Imported the project from the old site',
    assets: [{ asset: 'import_pages', name: '48 pages', type: 'page', action: 'created', langs: ['de'], fields: [f('Pages', null, '48 pages')] }],
  },
];

export function revisionById(id: number): HistoryRevision | null {
  return HISTORY.find((rev) => rev.id === id) ?? null;
}

/** The versions of one asset: the revisions that touched it, newest first, reduced to that asset. */
export function versionsOf(asset: string): readonly HistoryRevision[] {
  return HISTORY.flatMap((rev) => {
    const mine = rev.assets.filter((a) => a.asset === asset);
    return mine.length ? [{ ...rev, assets: mine }] : [];
  });
}

/** The date filter: a preset, or **custom** — an own from–to range (inclusive, `yyyy-MM-dd`; either end may be open). */
export const HISTORY_RANGES = ['any', 'today', 'week', 'month', 'custom'] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];
export interface HistoryDateFilter {
  readonly range: HistoryRange;
  readonly from: string | null;
  readonly to: string | null;
}
export const NO_DATE_FILTER: HistoryDateFilter = { range: 'any', from: null, to: null };
const RANGE_MINUTES: Readonly<Record<'any' | 'today' | 'week' | 'month', number>> = { any: Infinity, today: DAY, week: 7 * DAY, month: 30 * DAY };

const isoDay = (date: Date): string =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Whether a revision from `minutes` ago passes the date filter. */
export function inRange(minutes: number, { range, from, to }: HistoryDateFilter, now = Date.now()): boolean {
  if (range !== 'custom') {
    return minutes <= RANGE_MINUTES[range];
  }
  const day = isoDay(new Date(now - minutes * 60_000));
  return (!from || day >= from) && (!to || day <= to);
}
