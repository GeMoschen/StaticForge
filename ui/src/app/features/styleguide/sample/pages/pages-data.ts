import type { SampleSectionKind } from '../sample-data';

// ── Issues (M35.18: the Issues drawer) ───────────────────────────────────────────────────────────────────────────

/** How serious a finding is; the drawer groups by it, most severe first. */
export type IssueLevel = 'error' | 'warning' | 'info' | 'hint';
export const ISSUE_LEVELS: readonly IssueLevel[] = ['error', 'warning', 'info', 'hint'];

/** When a rule is checked: while editing, when saving, before releasing, when the site is built. */
export type IssueScopeKey = 'edit' | 'save' | 'release' | 'generation';
export const ISSUE_SCOPES: readonly IssueScopeKey[] = ['edit', 'save', 'release', 'generation'];

export const ISSUE_LEVEL_ICONS: Readonly<Record<IssueLevel, string>> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
  hint: 'lightbulb',
};

/** One finding about the open page: a content rule (what the author typed) or an output check (what a build would produce). */
export interface SampleIssue {
  /** `issues.items.<id>.*` holds its texts. */
  readonly id: string;
  readonly level: IssueLevel;
  readonly kind: 'content' | 'output';
  /** Where it is: `fields`, a section id of the page, or `catalog`. */
  readonly target: string;
  /** The field inside the target, for the location line ("Hero › Image"); the key of `issues.fields.*`. */
  readonly field: string | null;
  readonly scopes: readonly IssueScopeKey[];
  /** Who can fix it: the content, the template, either. */
  readonly fix: 'content' | 'template' | 'either' | null;
  /** The code of an output check (monospace in the row's detail). */
  readonly code?: string;
}

export const ISSUES: readonly SampleIssue[] = [
  { id: 'altMissing', level: 'error', kind: 'content', target: 's-hero', field: 'image', scopes: ['save', 'release'], fix: 'content' },
  { id: 'metaTooLong', level: 'error', kind: 'content', target: 'fields', field: 'metaDescription', scopes: ['edit', 'save'], fix: 'content' },
  { id: 'teaserLong', level: 'warning', kind: 'content', target: 'fields', field: 'teaser', scopes: ['edit'], fix: 'content' },
  { id: 'productUnreleased', level: 'warning', kind: 'content', target: 's-product', field: 'product', scopes: ['release', 'generation'], fix: 'content' },
  { id: 'titleTag', level: 'warning', kind: 'output', target: 'fields', field: 'title', scopes: ['generation'], fix: 'template', code: 'SF-CHK-0101' },
  { id: 'noH1', level: 'warning', kind: 'output', target: 's-hero', field: 'headline', scopes: ['generation'], fix: 'either', code: 'SF-CHK-0102' },
  { id: 'teasersNoLink', level: 'info', kind: 'content', target: 'catalog', field: null, scopes: ['edit'], fix: 'content' },
  { id: 'htmlLang', level: 'info', kind: 'output', target: 'fields', field: null, scopes: ['generation'], fix: 'template', code: 'SF-CHK-0205' },
  { id: 'canonical', level: 'hint', kind: 'content', target: 'fields', field: 'canonical', scopes: ['edit'], fix: 'content' },
];

/** The pages a change to this page rebuilds ("Pages affected by this change"). */
export interface SampleAffected {
  readonly name: string;
  readonly url: string;
  /** `issues.impact.reasons.<reason>` */
  readonly reason: 'self' | 'listed' | 'linked' | 'navigation';
}

export const AFFECTED: readonly SampleAffected[] = [
  { name: 'Spring harvest arrives', url: '/news/spring-harvest', reason: 'self' },
  { name: 'News overview', url: '/news/', reason: 'listed' },
  { name: 'Home', url: '/', reason: 'listed' },
  { name: 'Single origins', url: '/shop/single-origins', reason: 'linked' },
  { name: 'Sustainability report 2026', url: '/news/sustainability-2026', reason: 'navigation' },
];
export const AFFECTED_FILES = 9;

// ── Section palette ──────────────────────────────────────────────────────────────────────────────────────────────

export type PaletteCategory = 'headers' | 'content' | 'commerce' | 'social';
export const PALETTE_CATEGORIES: readonly PaletteCategory[] = ['headers', 'content', 'commerce', 'social'];

/** A section template the palette offers. A thumbnail, when a template has one, replaces the icon tile's glyph. */
export interface SampleSectionTemplate {
  readonly id: string;
  readonly category: PaletteCategory;
  readonly icon: string;
  /** The renderable kind it becomes in the sample page. */
  readonly kind: SampleSectionKind;
  /** At most this many on a page (the template's `max`); `null` = no limit. */
  readonly max: number | null;
  /** A preview image; none of the sample's templates has one. */
  readonly thumbnail?: string;
}

export const SECTION_TEMPLATES: readonly SampleSectionTemplate[] = [
  { id: 'hero', category: 'headers', icon: 'image', kind: 'hero', max: 1 },
  { id: 'banner', category: 'headers', icon: 'campaign', kind: 'hero', max: null },
  { id: 'text', category: 'content', icon: 'notes', kind: 'text', max: null },
  { id: 'columns', category: 'content', icon: 'view_column', kind: 'text', max: null },
  { id: 'gallery', category: 'content', icon: 'photo_library', kind: 'text', max: 2 },
  { id: 'faq', category: 'content', icon: 'quiz', kind: 'text', max: 1 },
  { id: 'product', category: 'commerce', icon: 'sell', kind: 'product', max: null },
  { id: 'tasting', category: 'commerce', icon: 'coffee', kind: 'product', max: null },
  { id: 'quote', category: 'social', icon: 'format_quote', kind: 'quote', max: null },
  { id: 'newsletter', category: 'social', icon: 'mail', kind: 'text', max: 1 },
];

// ── Settings drawers ─────────────────────────────────────────────────────────────────────────────────────────────

/** The page's navigation settings (the payload's `nav` member). */
export interface SampleNavSettings {
  readonly visible: boolean;
  readonly noIndex: boolean;
  readonly label: string;
  readonly position: number;
}

export const PAGE_NAV: SampleNavSettings = { visible: true, noIndex: false, label: 'Spring harvest', position: 3 };
export const FOLDER_NAV: SampleNavSettings = { visible: true, noIndex: false, label: '', position: 2 };
