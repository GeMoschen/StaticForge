import { SITE, SampleEntry } from '../sample-data';

/**
 * Fake data of the sample's Navigation area (M35.9 decision 24): the menu of the coffee-roaster website, in navigation
 * order, pointing at pages of the sample's Pages tree. Content, not UI text — the area's labels live in `en.json` under
 * `styleguide.sample.navigation.*`. Nothing is saved.
 */

/** A menu folder or menu item (a page reference). */
export interface SampleNavEntry {
  readonly id: string;
  readonly kind: 'folder' | 'item';
  readonly label: string;
  /** The developer-mode identifier (decision 19). */
  readonly uid: string;
  /** Whether the entry appears in the website's menu. */
  readonly visible: boolean;
  /** An item's target page (a Pages entry id); `null` while none is chosen. */
  readonly targetId: string | null;
  /** A folder's entry page: one of its items, opened when the folder itself is clicked in the menu. */
  readonly entryId: string | null;
}

/** The menu's sibling order per parent (`null` = the top level). */
export type SampleNavOrder = ReadonlyMap<string | null, readonly string[]>;

function item(id: string, label: string, targetId: string, visible = true): SampleNavEntry {
  return { id, kind: 'item', label, uid: id.replace(/^n-/, 'nav_').replace(/-/g, '_'), visible, targetId, entryId: null };
}

function folder(id: string, label: string, entryId: string): SampleNavEntry {
  return { id, kind: 'folder', label, uid: id.replace(/^n-/, 'nav_').replace(/-/g, '_'), visible: true, targetId: null, entryId };
}

const ENTRIES: readonly SampleNavEntry[] = [
  item('n-home', 'Home', 'p-home'),
  folder('n-coffee', 'Coffee', 'n-single-origins'),
  item('n-single-origins', 'Single origins', 'p-single-origins'),
  item('n-blends', 'Blends', 'p-espresso'),
  item('n-equipment', 'Equipment', 'p-brewing-gear'),
  folder('n-roastery', 'Roastery', 'n-company'),
  item('n-company', 'Company', 'p-our-story'),
  item('n-team', 'Our team', 'p-team'),
  item('n-visit', 'Visit us', 'p-hamburg'),
  item('n-news', 'News', 'p-news-overview'),
  item('n-contact', 'Contact', 'p-contact'),
  item('n-imprint', 'Imprint', 'p-imprint', false),
];

const ORDER: readonly (readonly [string | null, readonly string[]])[] = [
  [null, ['n-home', 'n-coffee', 'n-roastery', 'n-news', 'n-contact', 'n-imprint']],
  ['n-coffee', ['n-single-origins', 'n-blends', 'n-equipment']],
  ['n-roastery', ['n-company', 'n-team', 'n-visit']],
];

/** A fresh copy of the menu (each area instance edits its own). */
export function initialNavEntries(): ReadonlyMap<string, SampleNavEntry> {
  return new Map(ENTRIES.map((entry) => [entry.id, entry]));
}

export function initialNavOrder(): SampleNavOrder {
  return new Map(ORDER);
}

/** The scripted selections of the `nav` query parameter in the screenshots. */
export const FIXED_NAV_FOLDER = 'n-coffee';
export const FIXED_NAV_ITEM = 'n-company';

// ── Pages (the picker's targets) ─────────────────────────────────────────────

const PAGES = new Map<string, SampleEntry>();
const PAGE_PARENTS = new Map<string, string | null>();
(function index(entries: readonly SampleEntry[], parent: string | null): void {
  for (const entry of entries) {
    PAGES.set(entry.id, entry);
    PAGE_PARENTS.set(entry.id, parent);
    index(entry.children ?? [], entry.id);
  }
})(SITE, null);

export function pageById(id: string | null | undefined): SampleEntry | null {
  return id ? (PAGES.get(id) ?? null) : null;
}

/** The pages and folders of the Pages tree below `parentId` (`null` = the top level). */
export function pageChildren(parentId: string | null): readonly SampleEntry[] {
  return parentId === null ? SITE : (PAGES.get(parentId)?.children ?? []);
}

/** Root-to-page ids, the page included. */
export function pagePath(id: string): string[] {
  const path: string[] = [];
  for (let current: string | null = id; current !== null && PAGES.has(current); current = PAGE_PARENTS.get(current) ?? null) {
    path.unshift(current);
  }
  return path;
}

/** A page's stable fake UUID (developer mode only, decision 19). */
export function pageUuid(id: string): string {
  let hash = 0x811c9dc5;
  const hex: string[] = [];
  for (let round = 0; round < 4; round++) {
    for (const char of `${round}:${id}`) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    }
    hex.push(hash.toString(16).padStart(8, '0'));
  }
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
