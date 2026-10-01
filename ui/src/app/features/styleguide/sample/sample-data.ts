/**
 * Fake data of the sample screen (M35.9): a small coffee-roaster website with folders, pages, people, projects, build
 * runs and one article to edit. Everything here is content, not UI text — the screen's own labels live in `en.json`
 * under `styleguide.sample.*`. Nothing is ever saved.
 */

export type SampleLang = 'de' | 'en';
export const SAMPLE_LANGS: readonly SampleLang[] = ['de', 'en'];
export const LANGUAGE_NAMES: Readonly<Record<SampleLang, string>> = { de: 'Deutsch', en: 'English' };

export type SampleStatus = 'released' | 'changed' | 'draft' | 'scheduled';

export interface SamplePerson {
  readonly name: string;
  readonly email: string;
}

const anna: SamplePerson = { name: 'Anna Berger', email: 'anna.berger@example.com' };
const jonas: SamplePerson = { name: 'Jonas Weber', email: 'jonas.weber@example.com' };
const mira: SamplePerson = { name: 'Mira Okafor', email: 'mira.okafor@example.com' };
const lukas: SamplePerson = { name: 'Lukas Brandt', email: 'lukas.brandt@example.com' };
const sofia: SamplePerson = { name: 'Sofia Marquez', email: 'sofia.marquez@example.com' };

/** The signed-in user of the prototype. */
export const CURRENT_USER = anna;
/** The project's people (the content area's fake data uses them too). */
export const PEOPLE = { anna, jonas, mira, lukas, sofia } as const;

/** A folder or page of the Pages tree. Times are minutes before "now". */
export interface SampleEntry {
  readonly id: string;
  readonly kind: 'folder' | 'page';
  readonly name: string;
  /** The developer-mode identifier (decision 19). */
  readonly uid: string;
  readonly template: string | null;
  readonly status: Readonly<Record<SampleLang, SampleStatus>>;
  readonly modifiedMinutes: number;
  readonly modifiedBy: SamplePerson;
  readonly releasedMinutes: number | null;
  /** The public path (developer mode only). */
  readonly url: string;
  readonly startPage?: boolean;
  readonly children?: readonly SampleEntry[];
}

type StatusPair = `${SampleStatus}/${SampleStatus}`;

function statusOf(pair: StatusPair): Record<SampleLang, SampleStatus> {
  const [de, en] = pair.split('/') as [SampleStatus, SampleStatus];
  return { de, en };
}

function page(
  id: string,
  name: string,
  template: string,
  status: StatusPair,
  modifiedMinutes: number,
  modifiedBy: SamplePerson,
  releasedMinutes: number | null,
  url: string,
  startPage = false,
): SampleEntry {
  const uid = id.replace(/^p-/, '').replace(/-/g, '_');
  return { id, kind: 'page', name, uid, template, status: statusOf(status), modifiedMinutes, modifiedBy, releasedMinutes, url, startPage };
}

function folder(
  id: string,
  name: string,
  status: StatusPair,
  modifiedMinutes: number,
  modifiedBy: SamplePerson,
  url: string,
  children: readonly SampleEntry[],
): SampleEntry {
  const uid = id.replace(/^f-/, '').replace(/-/g, '_');
  const releasedMinutes = status.startsWith('draft') ? null : modifiedMinutes + 90;
  return { id, kind: 'folder', name, uid, template: null, status: statusOf(status), modifiedMinutes, modifiedBy, releasedMinutes, url, children };
}

export const HOUR = 60;
export const DAY = 24 * HOUR;

/** The top level of the Pages tree (the root folder itself is the "Pages" section). */
export const SITE: readonly SampleEntry[] = [
  page('p-home', 'Home', 'Landing page', 'released/changed', 3 * HOUR, mira, 2 * DAY, '/', true),
  folder('f-about', 'About us', 'released/released', 9 * DAY, lukas, '/about/', [
    page('p-our-story', 'Our story', 'Content page', 'released/released', 9 * DAY, lukas, 9 * DAY, '/about/our-story', true),
    page('p-team', 'Team', 'Content page', 'changed/released', 2 * DAY, sofia, 12 * DAY, '/about/team'),
    page('p-careers', 'Careers', 'Content page', 'released/released', 20 * DAY, jonas, 20 * DAY, '/about/careers'),
  ]),
  folder('f-news', 'News', 'released/changed', 25, anna, '/news/', [
    page('p-news-overview', 'News overview', 'Article list', 'released/released', 6 * DAY, jonas, 6 * DAY, '/news/', true),
    page('p-spring-harvest', 'Spring harvest arrives', 'Article', 'changed/changed', 25, anna, 3 * DAY, '/news/spring-harvest'),
    page('p-hamburg-roastery', 'New roastery in Hamburg', 'Article', 'released/released', 4 * DAY, mira, 4 * DAY, '/news/hamburg-roastery'),
    page('p-barista-championship', 'Barista championship recap', 'Article', 'draft/draft', 50, sofia, null, '/news/barista-championship'),
    page('p-holiday-hours', 'Holiday opening hours', 'Article', 'scheduled/scheduled', 5 * HOUR, lukas, null, '/news/holiday-hours'),
    page('p-sustainability', 'Sustainability report 2026', 'Article', 'released/changed', 26 * HOUR, jonas, 15 * DAY, '/news/sustainability-2026'),
    folder('f-news-archive', 'Archive', 'released/released', 40 * DAY, jonas, '/news/archive/', [
      page('p-winter-blend', 'Winter blend is back', 'Article', 'released/released', 80 * DAY, mira, 80 * DAY, '/news/archive/winter-blend'),
      page('p-latte-art', 'Latte art workshop', 'Article', 'released/released', 95 * DAY, sofia, 95 * DAY, '/news/archive/latte-art'),
    ]),
  ]),
  folder('f-shop', 'Shop', 'released/released', 2 * DAY, lukas, '/shop/', [
    page('p-espresso', 'Espresso blends', 'Product list', 'released/released', 2 * DAY, lukas, 2 * DAY, '/shop/espresso', true),
    page('p-single-origins', 'Single origins', 'Product list', 'changed/released', 7 * HOUR, anna, 5 * DAY, '/shop/single-origins'),
    page('p-brewing-gear', 'Brewing gear', 'Product list', 'released/released', 11 * DAY, jonas, 11 * DAY, '/shop/brewing-gear'),
  ]),
  folder('f-locations', 'Locations', 'released/released', 6 * DAY, mira, '/locations/', [
    page('p-hamburg', 'Hamburg', 'Location', 'released/released', 6 * DAY, mira, 6 * DAY, '/locations/hamburg'),
    page('p-berlin', 'Berlin', 'Location', 'released/released', 30 * DAY, mira, 30 * DAY, '/locations/berlin'),
    page('p-munich', 'Munich', 'Location', 'draft/draft', 2 * HOUR, sofia, null, '/locations/munich'),
  ]),
  page('p-contact', 'Contact', 'Content page', 'released/released', 14 * DAY, lukas, 14 * DAY, '/contact'),
  page('p-imprint', 'Imprint', 'Content page', 'released/released', 60 * DAY, jonas, 60 * DAY, '/imprint'),
  page('p-privacy', 'Privacy policy', 'Content page', 'released/released', 45 * DAY, jonas, 45 * DAY, '/privacy'),
];

const byId = new Map<string, SampleEntry>();
const parentById = new Map<string, string | null>();
(function index(entries: readonly SampleEntry[], parent: string | null): void {
  for (const entry of entries) {
    byId.set(entry.id, entry);
    parentById.set(entry.id, parent);
    if (entry.children) {
      index(entry.children, entry.id);
    }
  }
})(SITE, null);

export function entryById(id: string | null): SampleEntry | null {
  return id === null ? null : (byId.get(id) ?? null);
}

/** The children of a folder; `null` is the root. */
export function childrenOf(id: string | null): readonly SampleEntry[] {
  return id === null ? SITE : (byId.get(id)?.children ?? []);
}

/** The entries from the top level down to `id` (inclusive). */
export function pathTo(id: string | null): SampleEntry[] {
  const path: SampleEntry[] = [];
  for (let current = id; current !== null; current = parentById.get(current) ?? null) {
    const entry = byId.get(current);
    if (!entry) {
      break;
    }
    path.unshift(entry);
  }
  return path;
}

export function parentOf(id: string): string | null {
  return parentById.get(id) ?? null;
}

/** `view=folder`: the folder that is opened, with these two rows selected so the bulk bar shows. */
export const FIXED_FOLDER = 'f-news';
export const FIXED_SELECTION: readonly string[] = ['p-spring-harvest', 'p-barista-championship'];
/** `view=editor`: the page that is opened. */
export const FIXED_PAGE = 'p-spring-harvest';

// ── Top bar ──────────────────────────────────────────────────────────────────

export interface SampleProject {
  readonly key: string;
  readonly name: string;
  readonly favorite?: boolean;
  readonly recent?: boolean;
}

export const CURRENT_PROJECT: SampleProject = { key: 'DEMO', name: 'Demo site' };

export const PROJECTS: readonly SampleProject[] = [
  { key: 'LUMEN', name: 'Lumen Coffee', favorite: true, recent: true },
  { key: 'CORP', name: 'Corporate website', favorite: true },
  { key: 'DOCS', name: 'Product docs', recent: true },
  { key: 'CAMP26', name: 'Campaign 2026', recent: true },
  { key: 'INTRA', name: 'Intranet' },
  { key: 'JOBS', name: 'Careers portal' },
];

export interface SampleRun {
  readonly id: string;
  readonly outcome: 'published' | 'warnings';
  readonly minutes: number;
  readonly by: SamplePerson;
  readonly pages: number;
}

export const RUNS: readonly SampleRun[] = [
  { id: 'r-412', outcome: 'published', minutes: 5, by: anna, pages: 248 },
  { id: 'r-411', outcome: 'warnings', minutes: 3 * HOUR, by: jonas, pages: 247 },
  { id: 'r-410', outcome: 'published', minutes: DAY + 2 * HOUR, by: mira, pages: 247 },
];

export const CHANGES_COUNT = 7;

// ── Page editor ──────────────────────────────────────────────────────────────

/** The article's language-dependent texts. */
export interface SampleArticleText {
  readonly title: string;
  readonly teaser: string;
  readonly headline: string;
  readonly cta: string;
  readonly text: string;
  readonly quote: string;
  readonly kicker: string;
  readonly listTitle: string;
  readonly listItems: readonly string[];
  readonly nav: readonly string[];
  readonly footer: string;
  readonly productName: string;
  readonly price: string;
}

export const ARTICLE: Readonly<Record<SampleLang, SampleArticleText>> = {
  en: {
    title: 'Spring harvest arrives',
    teaser:
      'Our first lots from the Yirgacheffe highlands have landed in Hamburg — bright, floral and roasted in small batches this week.',
    headline: 'Fresh from the highlands',
    cta: 'Shop single origins',
    text: 'After three months on the water, twelve bags of washed Ethiopian coffee reached our roastery on Monday. We cupped every lot, settled on a light roast that keeps the jasmine and bergamot notes, and started roasting in batches of fifteen kilos.',
    quote: 'This is the cleanest harvest we have tasted in years — sweet, delicate and very alive in the cup.',
    kicker: 'News',
    listTitle: 'What is new this week',
    listItems: ['Yirgacheffe Konga, washed — light roast', 'Guji Hambela, natural — medium roast', 'Tasting flights in every café until April 30'],
    nav: ['Shop', 'Locations', 'News', 'About us'],
    footer: 'Lumen Coffee Roasters · Speicherstadt 12, Hamburg',
    productName: 'Yirgacheffe Konga 250 g',
    price: '€ 14.90',
  },
  de: {
    title: 'Die Frühjahrsernte ist da',
    teaser:
      'Unsere ersten Partien aus dem Hochland von Yirgacheffe sind in Hamburg angekommen — hell, blumig und diese Woche in kleinen Chargen geröstet.',
    headline: 'Frisch aus dem Hochland',
    cta: 'Zu den Single Origins',
    text: 'Nach drei Monaten auf See haben zwölf Säcke gewaschener äthiopischer Kaffee am Montag unsere Rösterei erreicht. Wir haben jede Partie verkostet, uns für eine helle Röstung entschieden, die Jasmin und Bergamotte bewahrt, und rösten in Chargen von fünfzehn Kilo.',
    quote: 'Die sauberste Ernte seit Jahren — süß, fein und sehr lebendig in der Tasse.',
    kicker: 'Neuigkeiten',
    listTitle: 'Neu in dieser Woche',
    listItems: ['Yirgacheffe Konga, gewaschen — helle Röstung', 'Guji Hambela, natural — mittlere Röstung', 'Verkostungen in allen Cafés bis 30. April'],
    nav: ['Shop', 'Standorte', 'Neuigkeiten', 'Über uns'],
    footer: 'Lumen Coffee Roasters · Speicherstadt 12, Hamburg',
    productName: 'Yirgacheffe Konga 250 g',
    price: '14,90 €',
  },
};

/** The template's field labels and options: schema data, not UI text. */
export const ARTICLE_FIELDS = {
  title: 'Title',
  teaser: 'Teaser',
  date: 'Publication date',
  category: 'Category',
  tags: 'Tags',
  inNavigation: 'Show in navigation',
  metaDescription: 'Meta description',
  author: 'Author',
  headline: 'Headline',
  image: 'Image',
  alt: 'Alternative text',
  cta: 'Button label',
  ctaLink: 'Button target',
  text: 'Text',
  product: 'Product',
  showPrice: 'Show price',
  quote: 'Quote',
  attribution: 'Attribution',
} as const;

/** A choice of a select or combobox field. */
export interface SampleOption {
  readonly value: string;
  readonly label: string;
}

export const CATEGORY_OPTIONS: readonly SampleOption[] = [
  { value: 'news', label: 'News' },
  { value: 'events', label: 'Events' },
  { value: 'products', label: 'Products' },
  { value: 'company', label: 'Company' },
];

export const TAG_OPTIONS: readonly SampleOption[] = [
  { value: 'harvest', label: 'Harvest' },
  { value: 'ethiopia', label: 'Ethiopia' },
  { value: 'single-origin', label: 'Single origin' },
  { value: 'roastery', label: 'Roastery' },
  { value: 'events', label: 'Events' },
  { value: 'sustainability', label: 'Sustainability' },
];

export const PRODUCT_OPTIONS: readonly SampleOption[] = [
  { value: 'konga', label: 'Yirgacheffe Konga 250 g' },
  { value: 'hambela', label: 'Guji Hambela 250 g' },
  { value: 'house', label: 'House espresso 1 kg' },
];

/** The language-independent values of the article. */
export const ARTICLE_SHARED = {
  date: '2026-03-12',
  category: 'news',
  tags: ['harvest', 'ethiopia', 'single-origin'],
  inNavigation: true,
  metaDescription:
    'Spring harvest 2026: our first washed and natural lots from Yirgacheffe and Guji are here, roasted in small batches in Hamburg and available in all cafés and online now.',
  metaLimit: 160,
  author: anna.name,
  image: { name: 'harvest-yirgacheffe.jpg', dimensions: '2400 × 1350' },
  alt: 'Coffee cherries drying on raised beds in the Ethiopian highlands',
  ctaLink: '/shop/single-origins',
  product: 'konga',
  showPrice: true,
  attribution: 'Mira Okafor, head roaster',
};

export type SampleSectionKind = 'hero' | 'text' | 'product' | 'quote';

/** A section of the page body; `name` is its section template's display name. */
export interface SampleSection {
  readonly id: string;
  readonly kind: SampleSectionKind;
  readonly name: string;
  readonly icon: string;
}

export const BODY_NAME = 'Main content';

export const SECTIONS: readonly SampleSection[] = [
  { id: 's-hero', kind: 'hero', name: 'Hero', icon: 'image' },
  { id: 's-text', kind: 'text', name: 'Text', icon: 'notes' },
  { id: 's-product', kind: 'product', name: 'Product teaser', icon: 'sell' },
  { id: 's-quote', kind: 'quote', name: 'Quote', icon: 'format_quote' },
];

/** The History drawer's entries (fake revisions). */
export interface SampleRevision {
  readonly id: string;
  readonly by: SamplePerson;
  readonly minutes: number;
  readonly summary: string;
}

export const REVISIONS: readonly SampleRevision[] = [
  { id: 'rev-88', by: anna, minutes: 25, summary: 'Changed Teaser and Hero headline' },
  { id: 'rev-87', by: anna, minutes: 50, summary: 'Added section Product teaser' },
  { id: 'rev-86', by: mira, minutes: 3 * HOUR, summary: 'Changed Quote' },
  { id: 'rev-85', by: jonas, minutes: 3 * DAY, summary: 'Released (de, en)' },
  { id: 'rev-84', by: anna, minutes: 3 * DAY + HOUR, summary: 'Created page' },
];
