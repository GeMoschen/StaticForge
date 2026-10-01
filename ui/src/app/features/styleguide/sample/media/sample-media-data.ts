/**
 * Fake data of the sample media library (M35.9, decisions 19–22): folders, about twenty files of the coffee roaster —
 * photos (drawn inline, with sizes and focal points), one banner with a file per language, two text media (a CSS file
 * and the SVG logo) and a PDF price list — with their usages and versions. Content only: the library's labels live in
 * `en.json` under `styleguide.sample.media.*`. Nothing is ever saved.
 */
import { CodeDiagnostic } from '../../../../shared/code-editor/code-editor.types';
import { DAY, HOUR, PEOPLE, SampleLang, SamplePerson, SampleStatus } from '../sample-data';
import {
  bag,
  banner,
  beans,
  bottle,
  burrs,
  cherries,
  cupping,
  cutout,
  dawn,
  farm,
  latte,
  pdfPage,
  portrait,
  pourOver,
  roaster,
  sacks,
  svgDataUri,
} from './sample-media-art';

const { anna, jonas, mira, lukas, sofia } = PEOPLE;

export type SampleMediaKind = 'image' | 'text' | 'pdf';
export type SampleMediaFormat = 'JPG' | 'PNG' | 'SVG' | 'CSS' | 'PDF';
export type SampleMediaTypeFilter = 'all' | 'images' | 'documents' | 'text';
export const MEDIA_TYPE_FILTERS: readonly SampleMediaTypeFilter[] = ['all', 'images', 'documents', 'text'];

export interface SampleMediaFolder {
  readonly id: string;
  readonly name: string;
  /** The developer-mode identifier (decision 19). */
  readonly uid: string;
  readonly children?: readonly SampleMediaFolder[];
}

/** A focal point in percent of the width and height (0–100). */
export interface SampleFocal {
  readonly x: number;
  readonly y: number;
}

/** The file of one language of a localized file. */
export interface SampleMediaLangFile {
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly art: string;
}

export interface SampleMediaUsage {
  readonly id: string;
  readonly title: string;
  readonly kind: 'page' | 'record';
  /** Where it lives (developer mode shows the path). */
  readonly path: string;
  /** The field that references the file. */
  readonly field: string;
}

export interface SampleMediaVersion {
  readonly version: number;
  readonly by: SamplePerson;
  readonly minutes: number;
  readonly sizeBytes: number;
  readonly note: string;
}

export interface SampleMediaFile {
  readonly id: string;
  readonly uid: string;
  /** The file name (the card and list label). */
  readonly name: string;
  readonly folderId: string;
  readonly kind: SampleMediaKind;
  readonly format: SampleMediaFormat;
  readonly sizeBytes: number;
  /** Pixel size (images and SVG); `null` for text and PDF. */
  readonly width: number | null;
  readonly height: number | null;
  /** Images only. */
  readonly focal: SampleFocal | null;
  readonly alt: string;
  readonly caption: string;
  readonly status: SampleStatus;
  readonly uploadedBy: SamplePerson;
  readonly uploadedMinutes: number;
  readonly modifiedMinutes: number;
  /** The picture (an inline SVG data URI); `null` for CSS, which previews as code. */
  readonly art: string | null;
  /** Text media: the file's text. */
  readonly source?: string;
  /** Text media: whether CMS syntax is processed when the file is served. */
  readonly processCms?: boolean;
  /** A file per language (decision 22). */
  readonly localized?: Readonly<Record<SampleLang, SampleMediaLangFile>>;
  readonly pages?: number;
  readonly usages: readonly SampleMediaUsage[];
  readonly versions: readonly SampleMediaVersion[];
}

// ── Folders ──────────────────────────────────────────────────────────────────

function folder(id: string, name: string, children?: readonly SampleMediaFolder[]): SampleMediaFolder {
  return { id, name, uid: id.replace(/^m-/, '').replace(/-/g, '_'), children };
}

export const MEDIA_FOLDERS: readonly SampleMediaFolder[] = [
  folder('m-brand', 'Brand'),
  folder('m-downloads', 'Downloads'),
  folder('m-products', 'Products', [folder('m-origins', 'Single origins')]),
  folder('m-roastery', 'Roastery'),
  folder('m-team', 'Team'),
];

function allFolders(list: readonly SampleMediaFolder[] = MEDIA_FOLDERS): SampleMediaFolder[] {
  return list.flatMap((f) => [f, ...allFolders(f.children ?? [])]);
}

export function mediaFolder(id: string | null): SampleMediaFolder | null {
  return id === null ? null : (allFolders().find((f) => f.id === id) ?? null);
}

export function mediaFolderChildren(id: string | null): readonly SampleMediaFolder[] {
  return id === null ? MEDIA_FOLDERS : (mediaFolder(id)?.children ?? []);
}

/** The folders from the top down to `id`. */
export function mediaFolderPath(id: string | null): SampleMediaFolder[] {
  const walk = (list: readonly SampleMediaFolder[], trail: SampleMediaFolder[]): SampleMediaFolder[] | null => {
    for (const f of list) {
      const next = [...trail, f];
      if (f.id === id) {
        return next;
      }
      const found = walk(f.children ?? [], next);
      if (found) {
        return found;
      }
    }
    return null;
  };
  return walk(MEDIA_FOLDERS, []) ?? [];
}

// ── Files ────────────────────────────────────────────────────────────────────

const KB = 1024;
const MB = 1024 * KB;

const PRODUCT_PAGE: SampleMediaUsage = { id: 'u-shop', title: 'Shop', kind: 'page', path: '/shop', field: 'Hero image' };
const SPRING_PAGE: SampleMediaUsage = {
  id: 'u-spring',
  title: 'Spring harvest arrives',
  kind: 'page',
  path: '/news/spring-harvest',
  field: 'Product teaser',
};

function versions(sizeBytes: number, by: SamplePerson, minutes: number, extra: readonly SampleMediaVersion[] = []): SampleMediaVersion[] {
  return [...extra, { version: 1, by, minutes, sizeBytes, note: 'Uploaded' }].map((v, i, all) => ({ ...v, version: all.length - i }));
}

interface PhotoSpec {
  readonly id: string;
  readonly name: string;
  readonly folderId: string;
  readonly art: string;
  readonly size: readonly [number, number];
  readonly sizeBytes: number;
  readonly focal: SampleFocal;
  readonly alt: string;
  readonly caption?: string;
  readonly status?: SampleStatus;
  readonly by: SamplePerson;
  readonly minutes: number;
  readonly usages?: readonly SampleMediaUsage[];
  readonly format?: 'JPG' | 'PNG';
  readonly replaced?: boolean;
}

function photo(spec: PhotoSpec): SampleMediaFile {
  const extra: SampleMediaVersion[] = spec.replaced
    ? [{ version: 0, by: mira, minutes: spec.minutes, sizeBytes: spec.sizeBytes, note: 'Replaced the file' }]
    : [];
  const uploaded = spec.replaced ? spec.minutes + 9 * DAY : spec.minutes;
  return {
    id: spec.id,
    uid: spec.id.replace(/^a-/, '').replace(/-/g, '_'),
    name: spec.name,
    folderId: spec.folderId,
    kind: 'image',
    format: spec.format ?? 'JPG',
    sizeBytes: spec.sizeBytes,
    width: spec.size[0],
    height: spec.size[1],
    focal: spec.focal,
    alt: spec.alt,
    caption: spec.caption ?? '',
    status: spec.status ?? 'released',
    uploadedBy: spec.by,
    uploadedMinutes: uploaded,
    modifiedMinutes: spec.minutes,
    art: spec.art,
    usages: spec.usages ?? [],
    versions: versions(Math.round(spec.sizeBytes * 1.18), spec.by, uploaded, extra),
  };
}

const LANDSCAPE: readonly [number, number] = [4000, 2667];
const PORTRAIT: readonly [number, number] = [2400, 3000];
const SQUARE: readonly [number, number] = [3000, 3000];

const BRAND_CSS = `/* Lumen Coffee Roasters — brand styles */
:root {
  --brand-roast: $CMS_VALUE(#global.brand.roastColor)$;
  --brand-cream: #f2ebe0;
  --brand-font: "Inter", system-ui, sans-serif;
}

.hero {
  background: url("$CMS_REF(media:hero_texture)$") center / cover;
  color: var(--brand-cream);
}

.badge--new {
  background: $CMS_VALUE(#global.brand.accent)$;
}

.price::before {
  content: "$$";
}
`;

const BRAND_CSS_RENDERED = `/* Lumen Coffee Roasters — brand styles */
:root {
  --brand-roast: #b5652b;
  --brand-cream: #f2ebe0;
  --brand-font: "Inter", system-ui, sans-serif;
}

.hero {
  background: url("/media/brand/hero-texture.png") center / cover;
  color: var(--brand-cream);
}

.badge--new {
  background: ;
}

.price::before {
  content: "$";
}
`;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 64" width="240" height="64">
  <circle cx="32" cy="32" r="26" fill="#b5652b"/>
  <ellipse cx="32" cy="32" rx="11" ry="17" fill="#2b1a10" transform="rotate(30 32 32)"/>
  <path d="M27 20 C 36 28, 28 36, 37 44" stroke="#b5652b" stroke-width="3" fill="none"/>
  <text x="70" y="41" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="700" fill="#2b1a10">Lumen</text>
  <text x="152" y="41" font-family="Inter, Arial, sans-serif" font-size="14" fill="#8a6a50">COFFEE</text>
</svg>
`;

/** The last processing attempt of the brand CSS: one warning (decision 21, Processing). */
export const CSS_DIAGNOSTICS: readonly CodeDiagnostic[] = [
  {
    severity: 'WARNING',
    code: 'UNKNOWN_GLOBAL',
    message: 'The global value brand.accent does not exist; it was rendered empty.',
    line: 13,
    column: 15,
  },
];

/** What the SVG logo's source tab flags. */
export const SVG_DIAGNOSTICS: readonly CodeDiagnostic[] = [
  {
    severity: 'WARNING',
    code: 'SVG_NO_TITLE',
    message: 'The SVG has no <title>; screen readers announce it without a name.',
    line: 1,
    column: 1,
  },
];

export const MEDIA_FILES: readonly SampleMediaFile[] = [
  // Products
  photo({
    id: 'a-yirgacheffe-beans',
    name: 'yirgacheffe-beans-light-roast.jpg',
    folderId: 'm-products',
    art: beans('landscape', 4, 'light'),
    size: LANDSCAPE,
    sizeBytes: 1.2 * MB,
    focal: { x: 50, y: 50 },
    alt: 'Light roasted Yirgacheffe beans, close up',
    caption: 'Yirgacheffe Konga, washed — light roast',
    by: anna,
    minutes: 2 * DAY,
    usages: [SPRING_PAGE, PRODUCT_PAGE, { id: 'u-rec-yirg', title: 'Yirgacheffe 250 g', kind: 'record', path: '/content/products/yirgacheffe', field: 'Image' }],
    replaced: true,
  }),
  photo({
    id: 'a-espresso-bag',
    name: 'espresso-blend-bag.jpg',
    folderId: 'm-products',
    art: bag('portrait', '#e9dfd2', '#2b1a10'),
    size: PORTRAIT,
    sizeBytes: 860 * KB,
    focal: { x: 50, y: 46 },
    alt: 'A bag of the Speicherstadt espresso blend',
    status: 'changed',
    by: jonas,
    minutes: 3 * HOUR,
    usages: [PRODUCT_PAGE],
  }),
  photo({
    id: 'a-latte-rosetta',
    name: 'latte-art-rosetta.jpg',
    folderId: 'm-products',
    art: latte('square'),
    size: SQUARE,
    sizeBytes: 1.6 * MB,
    focal: { x: 50, y: 42 },
    alt: 'A latte with a rosetta, seen from above',
    by: mira,
    minutes: 5 * DAY,
    usages: [{ id: 'u-home', title: 'Home', kind: 'page', path: '/', field: 'Hero image' }],
  }),
  photo({
    id: 'a-cold-brew',
    name: 'cold-brew-bottle.jpg',
    folderId: 'm-products',
    art: bottle('portrait'),
    size: PORTRAIT,
    sizeBytes: 740 * KB,
    focal: { x: 50, y: 55 },
    alt: '',
    status: 'draft',
    by: sofia,
    minutes: 40,
  }),
  {
    id: 'a-summer-campaign',
    uid: 'summer_campaign',
    name: 'summer-campaign.jpg',
    folderId: 'm-products',
    kind: 'image',
    format: 'JPG',
    sizeBytes: 640 * KB,
    width: 3200,
    height: 1800,
    focal: { x: 30, y: 45 },
    alt: 'Summer campaign: 20 % off cold brew',
    caption: '',
    status: 'scheduled',
    uploadedBy: lukas,
    uploadedMinutes: 6 * DAY,
    modifiedMinutes: 1 * DAY,
    art: banner('Sommer-Aktion', '20 % auf Cold Brew', 'warm'),
    localized: {
      de: { fileName: 'sommer-aktion.jpg', sizeBytes: 640 * KB, art: banner('Sommer-Aktion', '20 % auf Cold Brew', 'warm') },
      en: { fileName: 'summer-campaign-en.jpg', sizeBytes: 655 * KB, art: banner('Summer sale', '20 % off cold brew', 'warm') },
    },
    usages: [{ id: 'u-home', title: 'Home', kind: 'page', path: '/', field: 'Banner' }],
    versions: versions(640 * KB, lukas, 6 * DAY, [{ version: 0, by: lukas, minutes: 1 * DAY, sizeBytes: 655 * KB, note: 'Added the English file' }]),
  },
  photo({
    id: 'a-v60',
    name: 'v60-pour-over-at-the-bar.jpg',
    folderId: 'm-products',
    art: pourOver('landscape'),
    size: LANDSCAPE,
    sizeBytes: 1.1 * MB,
    focal: { x: 55, y: 60 },
    alt: 'A V60 pour-over on the bar',
    by: mira,
    minutes: 8 * DAY,
    usages: [{ id: 'u-brew', title: 'Brewing guide', kind: 'page', path: '/guides/brewing', field: 'Step image' }],
  }),
  photo({
    id: 'a-burrs',
    name: 'grinder-burrs-macro.jpg',
    folderId: 'm-products',
    art: burrs('square'),
    size: SQUARE,
    sizeBytes: 2.3 * MB,
    focal: { x: 50, y: 50 },
    alt: 'Grinder burrs, macro',
    by: jonas,
    minutes: 12 * DAY,
  }),
  photo({
    id: 'a-guji-cherries',
    name: 'guji-cherries-on-the-branch.jpg',
    folderId: 'm-products',
    art: cherries('landscape', 9),
    size: LANDSCAPE,
    sizeBytes: 1.9 * MB,
    focal: { x: 40, y: 40 },
    alt: 'Ripe coffee cherries on the branch in Guji',
    by: anna,
    minutes: 15 * DAY,
    usages: [SPRING_PAGE],
  }),
  // Products / Single origins
  photo({
    id: 'a-huila-farm',
    name: 'huila-farm-hillside.jpg',
    folderId: 'm-origins',
    art: farm('landscape', ['#9cc7e6', '#e8f1f6']),
    size: LANDSCAPE,
    sizeBytes: 2.1 * MB,
    focal: { x: 62, y: 58 },
    alt: 'Coffee rows on a hillside farm in Huila',
    by: lukas,
    minutes: 20 * DAY,
  }),
  photo({
    id: 'a-kenya-beans',
    name: 'kenya-aa-dark-roast.jpg',
    folderId: 'm-origins',
    art: beans('square', 17, 'dark'),
    size: SQUARE,
    sizeBytes: 1.4 * MB,
    focal: { x: 50, y: 50 },
    alt: 'Dark roasted Kenya AA beans',
    status: 'changed',
    by: anna,
    minutes: 2 * HOUR,
  }),
  // Roastery
  photo({
    id: 'a-roaster-drum',
    name: 'roaster-drum-first-crack.jpg',
    folderId: 'm-roastery',
    art: roaster('landscape'),
    size: LANDSCAPE,
    sizeBytes: 1.7 * MB,
    focal: { x: 45, y: 58 },
    alt: 'The drum roaster at first crack',
    caption: 'Our 15 kg roaster in the Speicherstadt',
    by: mira,
    minutes: 4 * DAY,
    usages: [{ id: 'u-roastery', title: 'New roastery in Hamburg', kind: 'page', path: '/news/hamburg-roastery', field: 'Hero image' }],
  }),
  photo({
    id: 'a-cupping-table',
    name: 'cupping-table.jpg',
    folderId: 'm-roastery',
    art: cupping('landscape'),
    size: LANDSCAPE,
    sizeBytes: 980 * KB,
    focal: { x: 50, y: 50 },
    alt: 'Eight cups on the cupping table',
    by: jonas,
    minutes: 9 * DAY,
  }),
  photo({
    id: 'a-green-sacks',
    name: 'green-coffee-sacks.jpg',
    folderId: 'm-roastery',
    art: sacks('landscape'),
    size: LANDSCAPE,
    sizeBytes: 1.3 * MB,
    focal: { x: 50, y: 60 },
    alt: 'Sacks of green coffee in the warehouse',
    by: lukas,
    minutes: 11 * DAY,
  }),
  photo({
    id: 'a-roastery-dawn',
    name: 'roastery-at-dawn.jpg',
    folderId: 'm-roastery',
    art: dawn('landscape'),
    size: LANDSCAPE,
    sizeBytes: 1.5 * MB,
    focal: { x: 50, y: 62 },
    alt: '',
    status: 'draft',
    by: sofia,
    minutes: 25,
  }),
  // Team
  photo({
    id: 'a-anna',
    name: 'anna-berger.jpg',
    folderId: 'm-team',
    art: portrait('#d9e4ec', '#e8c4a6', '#6b4226', '#2f4858', true),
    size: PORTRAIT,
    sizeBytes: 540 * KB,
    focal: { x: 50, y: 34 },
    alt: 'Anna Berger, editor',
    by: anna,
    minutes: 30 * DAY,
    usages: [{ id: 'u-team', title: 'Our team', kind: 'page', path: '/about/team', field: 'Portrait' }],
  }),
  photo({
    id: 'a-jonas',
    name: 'jonas-weber.jpg',
    folderId: 'm-team',
    art: portrait('#ece3d6', '#d6a77f', '#2b2420', '#7a4421'),
    size: PORTRAIT,
    sizeBytes: 510 * KB,
    focal: { x: 50, y: 33 },
    alt: 'Jonas Weber, roaster',
    by: anna,
    minutes: 30 * DAY,
    usages: [{ id: 'u-team', title: 'Our team', kind: 'page', path: '/about/team', field: 'Portrait' }],
  }),
  photo({
    id: 'a-mira',
    name: 'mira-okafor.jpg',
    folderId: 'm-team',
    art: portrait('#e4dcef', '#8d5a3b', '#1d1512', '#b5652b', true),
    size: PORTRAIT,
    sizeBytes: 560 * KB,
    focal: { x: 50, y: 35 },
    alt: 'Mira Okafor, head roaster',
    status: 'changed',
    by: mira,
    minutes: 5 * HOUR,
  }),
  photo({
    id: 'a-team-cupping',
    name: 'team-cupping-session.jpg',
    folderId: 'm-team',
    art: cupping('landscape', '#c9b8a3'),
    size: LANDSCAPE,
    sizeBytes: 1.2 * MB,
    focal: { x: 50, y: 50 },
    alt: 'The team cupping new lots',
    by: jonas,
    minutes: 18 * DAY,
  }),
  // Brand
  {
    id: 'a-logo',
    uid: 'logo',
    name: 'lumen-logo.svg',
    folderId: 'm-brand',
    kind: 'text',
    format: 'SVG',
    sizeBytes: 612,
    width: 240,
    height: 64,
    focal: null,
    alt: 'Lumen Coffee Roasters',
    caption: '',
    status: 'released',
    uploadedBy: lukas,
    uploadedMinutes: 60 * DAY,
    modifiedMinutes: 14 * DAY,
    art: svgDataUri(LOGO_SVG),
    source: LOGO_SVG,
    processCms: false,
    usages: [
      { id: 'u-layout', title: 'Site header', kind: 'record', path: '/content/globals/header', field: 'Logo' },
      { id: 'u-footer', title: 'Site footer', kind: 'record', path: '/content/globals/footer', field: 'Logo' },
    ],
    versions: versions(612, lukas, 60 * DAY, [{ version: 0, by: lukas, minutes: 14 * DAY, sizeBytes: 612, note: 'Edited the source' }]),
  },
  {
    id: 'a-brand-css',
    uid: 'brand_css',
    name: 'brand.css',
    folderId: 'm-brand',
    kind: 'text',
    format: 'CSS',
    sizeBytes: 412,
    width: null,
    height: null,
    focal: null,
    alt: '',
    caption: '',
    status: 'changed',
    uploadedBy: jonas,
    uploadedMinutes: 45 * DAY,
    modifiedMinutes: 35,
    art: null,
    source: BRAND_CSS,
    processCms: true,
    usages: [{ id: 'u-article', title: 'Article', kind: 'page', path: '/templates/article', field: 'Stylesheet' }],
    versions: versions(412, jonas, 45 * DAY, [
      { version: 0, by: anna, minutes: 35, sizeBytes: 412, note: 'Edited the source' },
      { version: 0, by: jonas, minutes: 3 * DAY, sizeBytes: 380, note: 'Edited the source' },
    ]),
  },
  photo({
    id: 'a-hero-texture',
    name: 'hero-texture.png',
    folderId: 'm-brand',
    format: 'PNG',
    art: cutout('landscape'),
    size: [2400, 1600],
    sizeBytes: 3.4 * MB,
    focal: { x: 50, y: 50 },
    alt: '',
    by: lukas,
    minutes: 40 * DAY,
    usages: [{ id: 'u-css', title: 'brand.css', kind: 'record', path: '/media/brand/brand.css', field: 'CSS' }],
  }),
  // Downloads
  {
    id: 'a-price-list',
    uid: 'price_list_2026',
    name: 'wholesale-price-list-2026.pdf',
    folderId: 'm-downloads',
    kind: 'pdf',
    format: 'PDF',
    sizeBytes: 284 * KB,
    width: null,
    height: null,
    focal: null,
    alt: '',
    caption: 'Wholesale prices, valid from 1 March 2026',
    status: 'released',
    uploadedBy: sofia,
    uploadedMinutes: 22 * DAY,
    modifiedMinutes: 22 * DAY,
    art: pdfPage(),
    pages: 4,
    usages: [{ id: 'u-wholesale', title: 'Wholesale', kind: 'page', path: '/wholesale', field: 'Downloads' }],
    versions: versions(284 * KB, sofia, 22 * DAY),
  },
];

/** The served output of the brand CSS (decision 21, Rendered). */
export function renderedSource(file: SampleMediaFile): string {
  return file.id === 'a-brand-css' ? BRAND_CSS_RENDERED : (file.source ?? '');
}

export function mediaFile(files: readonly SampleMediaFile[], id: string | null): SampleMediaFile | null {
  return id === null ? null : (files.find((f) => f.id === id) ?? null);
}

export function matchesType(file: SampleMediaFile, filter: SampleMediaTypeFilter): boolean {
  switch (filter) {
    case 'images':
      return file.kind === 'image' || file.format === 'SVG';
    case 'documents':
      return file.kind === 'pdf';
    case 'text':
      return file.kind === 'text';
    default:
      return true;
  }
}

/** The generated sizes and formats of an image (decision 21, Variants). */
export interface SampleMediaVariant {
  readonly id: string;
  readonly label: string;
  readonly format: SampleMediaFormat | 'WEBP';
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  readonly original: boolean;
}

export function variantsOf(file: SampleMediaFile): SampleMediaVariant[] {
  if (file.kind !== 'image' || !file.width || !file.height) {
    return [];
  }
  const { width, height } = file;
  const sized = [320, 640, 1280, 2560]
    .filter((w) => w < width)
    .map((w) => {
      const h = Math.round((height * w) / width);
      return { id: `${w}w`, label: `${w}w`, format: 'WEBP' as const, width: w, height: h, sizeBytes: Math.round(w * h * 0.11), original: false };
    });
  return [...sized, { id: 'original', label: '', format: file.format, width, height, sizeBytes: file.sizeBytes, original: true }];
}

// ── Scripted states ──────────────────────────────────────────────────────────

/** The folder the library opens on. */
export const DEFAULT_MEDIA_FOLDER = 'm-products';

/** The file a finished upload of the `upload=1` state points at ("Add alt text"). */
export const UPLOADED_FILE = 'a-cold-brew';
