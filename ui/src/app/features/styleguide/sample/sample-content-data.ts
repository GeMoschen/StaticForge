/**
 * Fake data of the sample's Content and Templates areas (M35.9, review round 1, decisions 12–14): datasets with their
 * fields, CDL and record templates; folders and record sets with their records; and the templates tree. Like
 * `sample-data.ts` this is content and schema data, not UI text. Nothing is ever saved.
 */
import { NOTES_FIELD, SampleCard, SampleCardTypeId, notesOf } from './sample-catalog';
import { DAY, HOUR, PEOPLE, SampleLang, SampleOption, SamplePerson, SampleStatus } from './sample-data';

const { anna, jonas, mira, lukas, sofia } = PEOPLE;

// ── Datasets ─────────────────────────────────────────────────────────────────

export type SampleFieldType = 'text' | 'longtext' | 'select' | 'number' | 'money' | 'date' | 'boolean' | 'media' | 'catalog';

export interface SampleDatasetField {
  readonly id: string;
  readonly label: string;
  readonly type: SampleFieldType;
  readonly required?: boolean;
  readonly localized?: boolean;
  /** How many rules check it (the built-in attributes count too). */
  readonly rules: number;
  readonly options?: readonly SampleOption[];
  /** A column of the record table. */
  readonly inTable?: boolean;
  /** `catalog`: the card types it allows. */
  readonly cardTypes?: readonly SampleCardTypeId[];
}

export type SampleChannel = 'html' | 'rss';

export interface SampleDataset {
  readonly id: string;
  readonly uid: string;
  readonly name: string;
  readonly fields: readonly SampleDatasetField[];
  /** The field that names a record (decision 19: never its UUID). */
  readonly displayField: string;
  readonly rules: string;
  readonly channels: Readonly<Partial<Record<SampleChannel, string>>>;
}

export const ROAST_OPTIONS: readonly SampleOption[] = [
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'dark', label: 'Dark' },
];

const CITY_OPTIONS: readonly SampleOption[] = [
  { value: 'hamburg', label: 'Hamburg' },
  { value: 'berlin', label: 'Berlin' },
  { value: 'munich', label: 'Munich' },
];

const PRODUCTS: SampleDataset = {
  id: 'ds-products',
  uid: 'products',
  name: 'Products',
  displayField: 'name',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true, localized: true, rules: 1, inTable: true },
    { id: 'origin', label: 'Origin', type: 'text', rules: 0, inTable: true },
    { id: 'roast', label: 'Roast', type: 'select', required: true, rules: 1, options: ROAST_OPTIONS, inTable: true },
    { id: 'price', label: 'Price', type: 'money', required: true, rules: 2, inTable: true },
    { id: 'stock', label: 'Stock', type: 'number', rules: 2, inTable: true },
    { id: 'description', label: 'Description', type: 'longtext', localized: true, rules: 0 },
    { id: 'image', label: 'Image', type: 'media', rules: 1 },
    { id: 'tastingNotes', label: NOTES_FIELD.label, type: 'catalog', rules: 1, cardTypes: NOTES_FIELD.types },
  ],
  rules: `rule "price-positive" on price {
  level error
  scope [edit, save]
  assert "value > 0"
  message { en "A product needs a price" de "Ein Produkt braucht einen Preis" }
}

rule "low-stock" on stock {
  level warning
  scope [edit, release]
  when "!isEmpty(stock)"
  assert "stock >= 5"
  message { en "Only {value} bags left" de "Nur noch {value} Beutel" }
}`,
  channels: {
    html: `<article class="product product--$CMS_VALUE(roast)$">
  $CMS_IF(!isEmpty(image))$
    <img src="$CMS_REF(image)$" alt="$CMS_VALUE(name)$">
  $CMS_END_IF$
  <h3>$CMS_VALUE(name)$</h3>
  <p class="product__origin">$CMS_VALUE(origin)$</p>
  <p>$CMS_VALUE(description)$</p>
  $CMS_VALUE(tastingNotes)$
  <p class="product__price">€ $CMS_VALUE(price)$</p>
</article>`,
    rss: `<item>
  <title>$CMS_VALUE(name)$</title>
  <link>$CMS_REF(_recordSet)$#$CMS_VALUE(_uid)$</link>
  <description>$CMS_VALUE(description)$</description>
  <guid isPermaLink="false">$CMS_VALUE(_uuid)$</guid>
</item>`,
  },
};

const TEAM: SampleDataset = {
  id: 'ds-team',
  uid: 'team_members',
  name: 'Team members',
  displayField: 'name',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true, rules: 1, inTable: true },
    { id: 'role', label: 'Role', type: 'text', localized: true, rules: 0, inTable: true },
    { id: 'location', label: 'Café', type: 'select', rules: 0, options: CITY_OPTIONS, inTable: true },
    { id: 'bio', label: 'About', type: 'longtext', localized: true, rules: 1 },
    { id: 'photo', label: 'Photo', type: 'media', rules: 0 },
  ],
  rules: '',
  channels: {
    html: `<li class="person">
  <img src="$CMS_REF(photo)$" alt="">
  <strong>$CMS_VALUE(name)$</strong> · $CMS_VALUE(role)$
</li>`,
  },
};

const LOCATIONS: SampleDataset = {
  id: 'ds-locations',
  uid: 'locations',
  name: 'Locations',
  displayField: 'name',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true, localized: true, rules: 1, inTable: true },
    { id: 'city', label: 'City', type: 'select', required: true, rules: 1, options: CITY_OPTIONS, inTable: true },
    { id: 'address', label: 'Address', type: 'text', rules: 0, inTable: true },
    { id: 'seats', label: 'Seats', type: 'number', rules: 1, inTable: true },
  ],
  rules: '',
  channels: {
    html: `<div class="cafe">
  <h3>$CMS_VALUE(name)$</h3>
  <address>$CMS_VALUE(address)$</address>
</div>`,
  },
};

const EVENTS: SampleDataset = {
  id: 'ds-events',
  uid: 'events',
  name: 'Events',
  displayField: 'name',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true, localized: true, rules: 1, inTable: true },
    { id: 'city', label: 'City', type: 'select', rules: 0, options: CITY_OPTIONS, inTable: true },
    { id: 'seats', label: 'Seats', type: 'number', rules: 1, inTable: true },
    { id: 'price', label: 'Price', type: 'money', rules: 1, inTable: true },
    { id: 'date', label: 'Date', type: 'date', rules: 0, inTable: true },
    { id: 'soldOut', label: 'Sold out', type: 'boolean', rules: 0, inTable: true },
    { id: 'description', label: 'Description', type: 'longtext', localized: true, rules: 0 },
  ],
  rules: '',
  channels: {
    html: `<li class="event">
  <strong>$CMS_VALUE(name)$</strong> — $CMS_VALUE(city)$, € $CMS_VALUE(price)$
</li>`,
  },
};

export const DATASETS: readonly SampleDataset[] = [PRODUCTS, TEAM, LOCATIONS, EVENTS];

export function datasetById(id: string | null | undefined): SampleDataset | null {
  return DATASETS.find((dataset) => dataset.id === id) ?? null;
}

const CDL_TYPES: Readonly<Record<SampleFieldType, string>> = {
  text: 'text',
  longtext: 'text',
  select: 'select',
  number: 'number',
  money: 'number',
  date: 'date',
  boolean: 'boolean',
  media: 'media',
  catalog: 'catalog',
};

/** The dataset's schema as CDL (the content section), written from its fields. */
export function cdlOf(dataset: SampleDataset): string {
  return dataset.fields
    .map((field) => {
      const lines = [`  label "${field.label}"`];
      if (field.localized) {
        lines.push('  localizable');
      }
      if (field.type === 'longtext') {
        lines.push('  multiline');
      }
      if (field.required) {
        lines.push('  required');
      }
      if (field.type === 'money' || (field.type === 'number' && field.rules > 0)) {
        lines.push('  min 0');
      }
      if (field.type === 'media') {
        lines.push('  mimeTypes ["image/*"]');
      }
      if (field.options) {
        lines.push('  options [');
        field.options.forEach((option, i) =>
          lines.push(`    { value "${option.value}" label "${option.label}" }${i < field.options!.length - 1 ? ',' : ''}`),
        );
        lines.push('  ]');
      }
      if (field.cardTypes) {
        lines.push(`  allow [${field.cardTypes.map((type) => `"${type === 'note' ? 'tasting_note' : type}"`).join(', ')}]`);
        lines.push('  max 5');
      }
      return `editor ${CDL_TYPES[field.type]} ${field.id} {\n${lines.join('\n')}\n}`;
    })
    .join('\n\n');
}

// ── Records ──────────────────────────────────────────────────────────────────

export type SampleValue = string | number | null | readonly SampleCard[];

export interface SampleRecord {
  readonly id: string;
  readonly uid: string;
  readonly uuid: string;
  readonly values: Readonly<Record<string, SampleValue>>;
  readonly status: Readonly<Record<SampleLang, SampleStatus>>;
  readonly modifiedMinutes: number;
  readonly modifiedBy: SamplePerson;
}

/** A stable, UUID-shaped identifier for a fake record. */
function fakeUuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let hex = '';
  for (let round = 0; hex.length < 32; round++) {
    for (const ch of `${seed}:${round}`) {
      h1 = Math.imul(h1 ^ ch.charCodeAt(0), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + ch.charCodeAt(0), 0x5bd1e995) >>> 0;
    }
    hex += (h1 ^ h2).toString(16).padStart(8, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type StatusPair = `${SampleStatus}/${SampleStatus}`;

function record(
  values: Record<string, SampleValue>,
  status: StatusPair,
  modifiedMinutes: number,
  modifiedBy: SamplePerson,
): SampleRecord {
  const name = String(values['name']);
  const uid = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const [de, en] = status.split('/') as [SampleStatus, SampleStatus];
  return { id: `r-${uid}`, uid, uuid: fakeUuid(uid), values, status: { de, en }, modifiedMinutes, modifiedBy };
}

function product(
  name: string,
  origin: string,
  roast: 'light' | 'medium' | 'dark',
  price: number,
  stock: number,
  status: StatusPair,
  minutes: number,
  by: SamplePerson,
  description = '',
  notes: readonly (readonly [string, string])[] = [],
): SampleRecord {
  const image = `${name.split(' ')[0].toLowerCase()}.jpg`;
  return record({ name, origin, roast, price, stock, description, image, tastingNotes: notesOf(...notes) }, status, minutes, by);
}

/** `view=record`: the record that is opened. */
export const FIXED_RECORD = 'r-yirgacheffe_konga_250_g';

const SINGLE_ORIGINS: readonly SampleRecord[] = [
  product(
    'Yirgacheffe Konga 250 g',
    'Ethiopia',
    'light',
    14.9,
    42,
    'released/changed',
    25,
    anna,
    'A washed coffee from smallholders around Konga, grown at 2,000 metres. Light roasted to keep its floral side.',
    [
      ['Jasmine', 'clear'],
      ['Bergamot', 'intense'],
      ['Lemon zest', 'subtle'],
    ],
  ),
  product('Guji Hambela 250 g', 'Ethiopia', 'medium', 15.5, 18, 'released/released', 3 * DAY, mira, 'Natural process, dried on raised beds.', [
    ['Blueberry', 'intense'],
    ['Cocoa nib', 'clear'],
  ]),
  product('Huila La Esperanza 250 g', 'Colombia', 'light', 13.9, 0, 'released/released', 9 * DAY, jonas),
  product('Santa Bárbara Honey 250 g', 'Honduras', 'medium', 13.5, 27, 'released/released', 12 * DAY, lukas),
  product('Nyeri Gatomboya 250 g', 'Kenya', 'light', 16.9, 9, 'changed/changed', 4 * HOUR, anna, 'SL28 and SL34 from the Gatomboya factory.', [
    ['Blackcurrant', 'intense'],
  ]),
  product('Cerrado Mineiro 250 g', 'Brazil', 'dark', 11.9, 64, 'released/released', 20 * DAY, mira),
  product('Kayanza Heza 250 g', 'Burundi', 'light', 15.9, 12, 'draft/draft', 50, sofia),
  product('Finca El Puente 250 g', 'Honduras', 'medium', 14.5, 0, 'released/released', 30 * DAY, jonas),
  product('Sumatra Ketiara 250 g', 'Indonesia', 'dark', 13.9, 31, 'scheduled/scheduled', 6 * HOUR, lukas),
];

const ESPRESSO: readonly SampleRecord[] = [
  product('House espresso 1 kg', 'Brazil, Ethiopia', 'medium', 32.0, 80, 'released/released', 14 * DAY, lukas),
  product('Hafenblend 1 kg', 'Brazil, Colombia', 'dark', 29.5, 46, 'released/changed', 2 * DAY, mira),
  product('Speicherstadt 250 g', 'Guatemala, India', 'dark', 10.9, 22, 'released/released', 40 * DAY, jonas),
  product('Decaf Mexico 250 g', 'Mexico', 'medium', 12.9, 15, 'changed/released', 5 * HOUR, sofia),
];

const SPRING: readonly SampleRecord[] = [
  product('Spring blend 250 g', 'Ethiopia, Kenya', 'light', 13.9, 120, 'scheduled/scheduled', 2 * HOUR, anna),
  product('Konga drip bags (10)', 'Ethiopia', 'light', 9.9, 200, 'draft/draft', 35, anna),
  product('Cold brew kit', 'Colombia', 'medium', 24.0, 30, 'draft/draft', 3 * HOUR, mira),
];

const TOURS: readonly SampleRecord[] = [
  record({ name: 'Roastery tour Hamburg', city: 'hamburg', seats: 12, price: 25, date: '2026-11-07', soldOut: 'false', description: '' }, 'released/released', 8 * DAY, sofia),
  record({ name: 'Cupping evening', city: 'berlin', seats: 16, price: 35, date: '2026-11-21', soldOut: 'false', description: '' }, 'released/changed', DAY, mira),
  record({ name: 'Home barista course', city: 'munich', seats: 8, price: 89, date: '2026-12-05', soldOut: 'false', description: '' }, 'draft/draft', 3 * HOUR, sofia),
  record({ name: 'Spring cupping', city: 'berlin', seats: 16, price: 30, date: '2026-03-14', soldOut: 'true', description: '' }, 'released/released', 40 * DAY, mira),
];

const TEAM_RECORDS: readonly SampleRecord[] = [
  record({ name: 'Mira Okafor', role: 'Head roaster', location: 'hamburg', bio: '', photo: 'mira.jpg' }, 'released/released', 30 * DAY, mira),
  record({ name: 'Lukas Brandt', role: 'Green coffee buyer', location: 'hamburg', bio: '', photo: 'lukas.jpg' }, 'released/released', 45 * DAY, lukas),
  record({ name: 'Sofia Marquez', role: 'Café manager', location: 'berlin', bio: '', photo: 'sofia.jpg' }, 'changed/released', 2 * DAY, sofia),
  record({ name: 'Jonas Weber', role: 'Barista trainer', location: 'munich', bio: '', photo: 'jonas.jpg' }, 'released/released', 60 * DAY, jonas),
  record({ name: 'Anna Berger', role: 'Editor', location: 'hamburg', bio: '', photo: 'anna.jpg' }, 'draft/draft', 4 * HOUR, anna),
];

const CAFES: readonly SampleRecord[] = [
  record({ name: 'Speicherstadt', city: 'hamburg', address: 'Speicherstadt 12, Hamburg', seats: 40 }, 'released/released', 20 * DAY, mira),
  record({ name: 'Kreuzberg', city: 'berlin', address: 'Oranienstraße 8, Berlin', seats: 28 }, 'released/released', 25 * DAY, sofia),
  record({ name: 'Glockenbach', city: 'munich', address: 'Müllerstraße 31, München', seats: 24 }, 'draft/draft', 2 * HOUR, sofia),
];

// ── Folders and record sets ──────────────────────────────────────────────────

export type SampleOperator = 'is' | 'isNot' | 'contains' | 'gt' | 'lt';

export interface SampleCondition {
  readonly id: string;
  readonly field: string;
  readonly op: SampleOperator;
  readonly value: string | number | null;
}

/** One key of the sort order: the first key sorts, each further key breaks its ties. */
export interface SampleSortKey {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

export interface SampleQuery {
  readonly conditions: readonly SampleCondition[];
  readonly sort: readonly SampleSortKey[];
  /** Skip this many records of the sorted selection (`null`: none). */
  readonly offset: number | null;
  /** Show at most this many (`null`: no limit). */
  readonly limit: number | null;
  /**
   * A stored expression the builder cannot represent (`roast == 'dark' || stock > 50`): the builder steps aside, the
   * expression is shown as it is and *Clear filter* returns to the builder. It counts instead of the conditions.
   */
  readonly custom?: string | null;
}

/** A folder or record set of the Content tree. */
export interface SampleContentEntry {
  readonly id: string;
  readonly kind: 'folder' | 'recordset';
  readonly name: string;
  readonly uid: string;
  readonly modifiedMinutes: number;
  readonly modifiedBy: SamplePerson;
  /** Record sets: the dataset (fixed once created). */
  readonly dataset?: string;
  readonly records?: readonly SampleRecord[];
  readonly query?: SampleQuery;
  readonly children?: readonly SampleContentEntry[];
}

const byName: SampleQuery = { conditions: [], sort: [{ field: 'name', direction: 'asc' }], offset: null, limit: null };

function recordSet(
  id: string,
  name: string,
  dataset: string,
  records: readonly SampleRecord[],
  modifiedMinutes: number,
  modifiedBy: SamplePerson,
  query: SampleQuery = byName,
): SampleContentEntry {
  return { id, kind: 'recordset', name, uid: id.replace(/^rs-/, '').replace(/-/g, '_'), dataset, records, query, modifiedMinutes, modifiedBy };
}

function contentFolder(
  id: string,
  name: string,
  modifiedMinutes: number,
  modifiedBy: SamplePerson,
  children: readonly SampleContentEntry[],
): SampleContentEntry {
  return { id, kind: 'folder', name, uid: id.replace(/^cf-/, '').replace(/-/g, '_'), modifiedMinutes, modifiedBy, children };
}

/** `view=recordset`: the record set that is opened, its rows selected so the bulk bar shows. */
export const FIXED_RECORD_SET = 'rs-single-origins';
export const FIXED_RECORD_SELECTION: readonly string[] = ['r-yirgacheffe_konga_250_g', 'r-nyeri_gatomboya_250_g'];
/** `view=contentfolder`: the folder that is opened, filtered to one dataset. */
/** `view=recordset&filter=extras`: the record set whose stored filter uses a date, a Yes/No, two sort keys and a limit. */
export const FIXED_EXTRAS_SET = 'rs-tours';
export const FIXED_CONTENT_FOLDER = 'cf-shop';
export const FIXED_CONTENT_FILTER = 'ds-products';

export const CONTENT: readonly SampleContentEntry[] = [
  contentFolder('cf-shop', 'Shop', 25, anna, [
    recordSet('rs-single-origins', 'Single origins', 'ds-products', SINGLE_ORIGINS, 25, anna, {
      conditions: [
        { id: 'c-1', field: 'roast', op: 'is', value: 'light' },
        { id: 'c-2', field: 'stock', op: 'gt', value: 0 },
      ],
      sort: [{ field: 'name', direction: 'asc' }],
      offset: null,
      limit: null,
    }),
    recordSet('rs-espresso', 'Espresso blends', 'ds-products', ESPRESSO, 5 * HOUR, sofia),
    recordSet('rs-tours', 'Roastery tours', 'ds-events', TOURS, DAY, mira, {
      conditions: [
        { id: 'c-3', field: 'date', op: 'gt', value: '2026-06-01' },
        { id: 'c-4', field: 'soldOut', op: 'is', value: 'false' },
      ],
      sort: [
        { field: 'date', direction: 'asc' },
        { field: 'price', direction: 'desc' },
      ],
      offset: null,
      limit: 10,
    }),
  ]),
  contentFolder('cf-company', 'Company', 4 * HOUR, anna, [
    recordSet('rs-team', 'Team', 'ds-team', TEAM_RECORDS, 4 * HOUR, anna),
    recordSet('rs-cafes', 'Cafés', 'ds-locations', CAFES, 2 * HOUR, sofia),
  ]),
  contentFolder('cf-campaigns', 'Campaigns', 35, anna, [
    contentFolder('cf-spring', 'Spring 2026', 35, anna, [recordSet('rs-spring', 'Spring specials', 'ds-products', SPRING, 35, anna)]),
  ]),
];

const contentById = new Map<string, SampleContentEntry>();
const contentParent = new Map<string, string | null>();
(function index(entries: readonly SampleContentEntry[], parent: string | null): void {
  for (const entry of entries) {
    contentById.set(entry.id, entry);
    contentParent.set(entry.id, parent);
    if (entry.children) {
      index(entry.children, entry.id);
    }
  }
})(CONTENT, null);

export function contentEntry(id: string | null): SampleContentEntry | null {
  return id === null ? null : (contentById.get(id) ?? null);
}

export function contentChildren(id: string | null): readonly SampleContentEntry[] {
  return id === null ? CONTENT : (contentById.get(id)?.children ?? []);
}

export function contentParentOf(id: string): string | null {
  return contentParent.get(id) ?? null;
}

/** The entries from the top level down to `id` (inclusive). */
export function contentPath(id: string | null): SampleContentEntry[] {
  const path: SampleContentEntry[] = [];
  for (let current = id; current !== null; current = contentParent.get(current) ?? null) {
    const entry = contentById.get(current);
    if (!entry) {
      break;
    }
    path.unshift(entry);
  }
  return path;
}

/** Every record set (for "Used by"). */
export function recordSets(): SampleContentEntry[] {
  return [...contentById.values()].filter((entry) => entry.kind === 'recordset');
}

/** The record set holding a record. */
export function recordSetOf(recordId: string): SampleContentEntry | null {
  return recordSets().find((set) => set.records?.some((r) => r.id === recordId)) ?? null;
}

// ── Templates tree ───────────────────────────────────────────────────────────

export type SampleTemplateKind = 'folder' | 'page' | 'section' | 'dataset';

export interface SampleTemplateEntry {
  readonly id: string;
  readonly kind: SampleTemplateKind;
  readonly name: string;
  readonly uid: string;
  readonly children?: readonly SampleTemplateEntry[];
}

function template(kind: 'page' | 'section', name: string): SampleTemplateEntry {
  const uid = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return { id: `t-${kind}-${uid}`, kind, name, uid };
}

/** `view=dataset`: the dataset that is opened. */
export const FIXED_DATASET = 'ds-products';

export const TEMPLATES: readonly SampleTemplateEntry[] = [
  {
    id: 'tf-page',
    kind: 'folder',
    name: 'Page templates',
    uid: 'page_templates',
    children: ['Base page', 'Landing page', 'Content page', 'Article', 'Article list', 'Product list', 'Location'].map((name) =>
      template('page', name),
    ),
  },
  {
    id: 'tf-section',
    kind: 'folder',
    name: 'Section templates',
    uid: 'section_templates',
    children: ['Hero', 'Text', 'Product teaser', 'Quote', 'Badge', 'Tasting note'].map((name) => template('section', name)),
  },
  {
    id: 'tf-datasets',
    kind: 'folder',
    name: 'Datasets',
    uid: 'datasets',
    children: DATASETS.map((dataset) => ({ id: dataset.id, kind: 'dataset' as const, name: dataset.name, uid: dataset.uid })),
  },
];

const templateById = new Map<string, SampleTemplateEntry>();
const templateParent = new Map<string, string | null>();
(function index(entries: readonly SampleTemplateEntry[], parent: string | null): void {
  for (const entry of entries) {
    templateById.set(entry.id, entry);
    templateParent.set(entry.id, parent);
    if (entry.children) {
      index(entry.children, entry.id);
    }
  }
})(TEMPLATES, null);

export function templateEntry(id: string | null): SampleTemplateEntry | null {
  return id === null ? null : (templateById.get(id) ?? null);
}

export function templateChildren(id: string | null): readonly SampleTemplateEntry[] {
  return id === null ? TEMPLATES : (templateById.get(id)?.children ?? []);
}

export function templatePath(id: string | null): SampleTemplateEntry[] {
  const path: SampleTemplateEntry[] = [];
  for (let current = id; current !== null; current = templateParent.get(current) ?? null) {
    const entry = templateById.get(current);
    if (!entry) {
      break;
    }
    path.unshift(entry);
  }
  return path;
}

// ── Template metadata (the folder table, gate round 13) ──────────────────────

/** What the Templates folder table shows per template or dataset: channels, how many things use it, last change. */
export interface SampleTemplateMeta {
  readonly channels: readonly string[];
  readonly usedBy: number;
  readonly modifiedMinutes: number;
  readonly modifiedBy: SamplePerson;
}

/** What uses a template or dataset (the *Used by* drawer); one missing here is used by nothing. */
export const TEMPLATE_USAGES: Readonly<Record<string, readonly SampleUsage[]>> = {
  't-page-base_page': [
    { type: 'template', name: 'Landing page', path: 'extends' },
    { type: 'template', name: 'Content page', path: 'extends' },
  ],
  't-page-content_page': [
    { type: 'template', name: 'Article', path: 'extends' },
    { type: 'template', name: 'Article list', path: 'extends' },
    { type: 'page', name: 'About us', path: 'template' },
  ],
  't-page-article': [
    { type: 'page', name: 'Spring harvest arrives', path: 'template' },
    { type: 'page', name: 'Roasting day recap', path: 'template' },
    { type: 'page', name: 'New brew guide', path: 'template' },
  ],
  't-section-product_teaser': [
    { type: 'page', name: 'Single origins', path: 'sections[1]' },
    { type: 'page', name: 'Shop', path: 'sections[0]' },
    { type: 'template', name: 'Product list', path: 'bodies.main' },
  ],
  't-section-hero': [
    { type: 'page', name: 'Home', path: 'sections[0]' },
    { type: 'page', name: 'Spring harvest arrives', path: 'sections[0]' },
  ],
  'ds-products': [
    { type: 'recordset', name: 'Single origins', path: 'Products / Single origins' },
    { type: 'recordset', name: 'Blends', path: 'Products / Blends' },
    { type: 'template', name: 'Product teaser', path: 'content.items' },
  ],
};

const TEMPLATE_PEOPLE: readonly SamplePerson[] = [PEOPLE.anna, PEOPLE.jonas, PEOPLE.mira, PEOPLE.lukas];

/**
 * The folder table's data for an entry. Sections render in html only; page templates and datasets in html and rss. A
 * folder has none of it (its row shows "—"). Derived from the id, so the table is the same on every visit.
 */
export function templateMeta(entry: SampleTemplateEntry): SampleTemplateMeta {
  const seed = [...entry.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return {
    channels: entry.kind === 'folder' ? [] : entry.kind === 'section' ? ['html'] : ['html', 'rss'],
    usedBy: TEMPLATE_USAGES[entry.id]?.length ?? 0,
    modifiedMinutes: 90 + (seed % 17) * 410,
    modifiedBy: TEMPLATE_PEOPLE[seed % TEMPLATE_PEOPLE.length],
  };
}

/** Every template, dataset and folder under a folder (not the folder itself), depth first. */
export function templatesInside(id: string | null): SampleTemplateEntry[] {
  return templateChildren(id).flatMap((entry) => [entry, ...templatesInside(entry.id)]);
}

/** How many other things use the template, dataset or (for a folder) anything inside it. */
export function templateUsageCount(entry: SampleTemplateEntry): number {
  return entry.kind === 'folder' ? templatesInside(entry.id).reduce((sum, e) => sum + templateMeta(e).usedBy, 0) : templateMeta(entry).usedBy;
}

/** The expression `filter=custom` stores in a set: it has an `||`, which the filter builder cannot write. */
export const CUSTOM_EXPRESSION = "roast == 'dark' || stock > 50";

/**
 * A release status per language for records together: released when all are, draft when all are, otherwise changed —
 * what a record set's or folder's *Status* column says about the records inside it.
 */
export function combinedStatus(records: readonly SampleRecord[], lang: SampleLang): SampleStatus | null {
  if (records.length === 0) {
    return null;
  }
  const all = new Set(records.map((record) => record.status[lang]));
  return all.size === 1 ? [...all][0] : 'changed';
}

/** The records of a record set and, for a folder, of every set inside it. */
export function recordsInside(entry: SampleContentEntry, recordsOf: (setId: string) => readonly SampleRecord[]): SampleRecord[] {
  return entry.kind === 'recordset' ? [...recordsOf(entry.id)] : (entry.children ?? []).flatMap((child) => recordsInside(child, recordsOf));
}

// ── Usages ───────────────────────────────────────────────────────────────────

/** Something that reads a record set or record (the *Used by* lists). */
export interface SampleUsage {
  readonly type: 'page' | 'template' | 'record' | 'recordset';
  readonly name: string;
  /** Where in it the reference sits. */
  readonly path: string;
}

/** What uses each record set; a set missing here is used by nothing. */
export const SET_USAGES: Readonly<Record<string, readonly SampleUsage[]>> = {
  'rs-single-origins': [
    { type: 'page', name: 'Single origins', path: 'sections[1].teasers' },
    { type: 'template', name: 'product_list', path: 'content.items' },
  ],
  'rs-team': [{ type: 'page', name: 'About us', path: 'sections[2].people' }],
};

/** What uses the fixed record (`view=record`); other records are used by nothing. */
export const FIXED_RECORD_USAGES: readonly SampleUsage[] = [
  { type: 'page', name: 'Spring harvest arrives', path: 'sections[3].teasers[0]' },
  { type: 'record', name: 'Nyeri Gatomboya 250 g', path: 'related[0]' },
];
