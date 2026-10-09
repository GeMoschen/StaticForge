/**
 * Fake data of the sample's Publishing area (M35.9 decisions 27–28): build runs of the coffee-roaster site, their
 * findings and logs, targets, the publish policy, the quality rules, redirects and the URL registry. Content, not UI
 * text — the area's labels live in `en.json` under `styleguide.sample.publishing.*`. Nothing is saved.
 *
 * Page names are copied from the sample's Pages tree (`sample-data.ts`), not imported, so this area stands alone.
 */

export type RunStatus = 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
/** Why a page was rebuilt: the kind of change at the root of it. */
export type RebuiltRoot = 'page' | 'template' | 'navigation' | 'media' | 'settings';
/** Whether a run's rebuild plan can be shown: stored, never stored, removed by retention, or not made yet (queued). */
export type RunPlanState = 'stored' | 'none' | 'pruned' | 'pending';
export type RunMode = 'full' | 'incremental';
export type RunTrigger = 'manual' | 'schedule' | 'release';
export type FindingSeverity = 'error' | 'warning';
export type QualityCategory = 'links' | 'seo' | 'accessibility';
export type QualityLevel = 'off' | 'warning' | 'error';
export type TargetKind = 'folder' | 'zip' | 's3';
export type RedirectState = 'active' | 'shadowed' | 'dangling' | 'loop';
export type RedirectKind = 'auto' | 'manual';
export type PolicyAction = 'release' | 'schedule' | 'incremental' | 'full';
export type UrlArea = 'generated' | 'preview';

export const RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'success', 'partial', 'failed', 'cancelled'];
/** The signed-in editor of the sample (param `role=editor`): started the queued run, may cancel only runs of their own. */
export const EDITOR_NAME = 'Mira Okafor';
export const QUALITY_CATEGORIES: readonly QualityCategory[] = ['links', 'seo', 'accessibility'];
export const QUALITY_LEVELS: readonly QualityLevel[] = ['off', 'warning', 'error'];
export const POLICY_ACTIONS: readonly PolicyAction[] = ['release', 'schedule', 'incremental', 'full'];

/** A page the scope picker, findings and rebuilt lists name. */
export interface PublishPage {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly folder?: boolean;
}

export const PAGES: readonly PublishPage[] = [
  { id: 'p-home', name: 'Home', path: '/' },
  { id: 'f-about', name: 'About us', path: '/about/', folder: true },
  { id: 'p-our-story', name: 'Our story', path: '/about/our-story' },
  { id: 'p-team', name: 'Team', path: '/about/team' },
  { id: 'p-careers', name: 'Careers', path: '/about/careers' },
  { id: 'f-news', name: 'News', path: '/news/', folder: true },
  { id: 'p-news-overview', name: 'News overview', path: '/news/' },
  { id: 'p-spring-harvest', name: 'Spring harvest arrives', path: '/news/spring-harvest' },
  { id: 'p-hamburg-roastery', name: 'New roastery in Hamburg', path: '/news/hamburg-roastery' },
  { id: 'p-sustainability', name: 'Sustainability report 2026', path: '/news/sustainability-2026' },
  { id: 'f-shop', name: 'Shop', path: '/shop/', folder: true },
  { id: 'p-espresso', name: 'Espresso blends', path: '/shop/espresso' },
  { id: 'p-single-origins', name: 'Single origins', path: '/shop/single-origins' },
  { id: 'p-brewing-gear', name: 'Brewing gear', path: '/shop/brewing-gear' },
  { id: 'f-locations', name: 'Locations', path: '/locations/', folder: true },
  { id: 'p-hamburg', name: 'Hamburg', path: '/locations/hamburg' },
  { id: 'p-berlin', name: 'Berlin', path: '/locations/berlin' },
  { id: 'p-contact', name: 'Contact', path: '/contact' },
  { id: 'p-imprint', name: 'Imprint', path: '/imprint' },
  { id: 'p-privacy', name: 'Privacy policy', path: '/privacy' },
];

export function pageById(id: string): PublishPage | undefined {
  return PAGES.find((p) => p.id === id);
}

/** Where a page's HTML lands in a language's output: `/de/news/spring-harvest.html`, `/en/index.html`. */
export function outputPathOf(pageId: string, lang: string): string {
  const path = pageById(pageId)?.path ?? '/';
  return `/${lang.toLowerCase()}${path.endsWith('/') ? `${path}index` : path}.html`;
}

// ── Targets ──────────────────────────────────────────────────────────────────

export interface PublishTarget {
  readonly id: string;
  readonly name: string;
  readonly kind: TargetKind;
  /** Output folder, relative to the project's output root (empty = target-<id>). */
  readonly location: string;
  readonly baseUrl: string;
  readonly isDefault: boolean;
}

export const TARGETS: readonly PublishTarget[] = [
  { id: 't-live', name: 'Live site', kind: 'folder', location: 'roastery-live', baseUrl: 'https://www.nordlicht-roastery.example', isDefault: true },
  { id: 't-staging', name: 'Staging', kind: 'folder', location: 'roastery-staging', baseUrl: 'https://staging.nordlicht-roastery.example', isDefault: false },
  { id: 't-archive', name: 'Monthly archive', kind: 'zip', location: 'site-archive.zip', baseUrl: 'https://www.nordlicht-roastery.example', isDefault: false },
  { id: 't-cdn', name: 'CDN mirror', kind: 's3', location: 'cdn-mirror', baseUrl: 'https://cdn.nordlicht-roastery.example', isDefault: false },
];

export const DEFAULT_TARGET = TARGETS.find((t) => t.isDefault)!;

export function targetById(id: string): PublishTarget | undefined {
  return TARGETS.find((t) => t.id === id);
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export interface RunFinding {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly category: QualityCategory;
  /** The rule's name. */
  readonly rule: string;
  /** How to fix it. */
  readonly fix: string;
  readonly pages: readonly {
    readonly pageId: string;
    readonly message: string;
    readonly lang: string;
    /** Checked in an earlier build and carried over: the page was not rebuilt in this run. */
    readonly carried?: boolean;
  }[];
}

export interface RebuiltPage {
  readonly pageId: string;
  readonly lang: string;
  readonly reason: string;
  /** The change this page was rebuilt because of (rebuilt pages are grouped by it). */
  readonly via: string;
  readonly root: RebuiltRoot;
}

export interface SampleRun {
  readonly id: string;
  readonly number: number;
  readonly status: RunStatus;
  readonly mode: RunMode;
  readonly targetId: string;
  readonly trigger: RunTrigger;
  readonly by: string;
  /** Minutes before now. */
  readonly startedMinutes: number;
  /** Seconds; `null` while running. */
  readonly durationSeconds: number | null;
  readonly pages: number;
  /** Running only: how far it is, 0–100. */
  readonly progress?: number;
  readonly filesWritten: number;
  readonly filesSkipped: number;
  readonly bytes: string;
  readonly revision: number;
  readonly comment?: string;
  readonly findings: readonly RunFinding[];
  readonly rebuilt: readonly RebuiltPage[];
  /** Default `stored`; see {@link RunPlanState}. */
  readonly planState?: RunPlanState;
  /** Channels the run generated; without it "All enabled". */
  readonly channels?: readonly string[];
  /** Redirects the run added (shown when above 0). */
  readonly redirectsAdded?: number;
  /** Findings beyond the findings limit: counted, but not stored. */
  readonly truncated?: number;
}

const FINDINGS_LAST: readonly RunFinding[] = [
  {
    code: 'SF-CHK-0101',
    severity: 'error',
    category: 'links',
    rule: 'Link to a missing page or file',
    fix: 'Open the page and correct the link, or point it at an existing page with the page picker.',
    pages: [
      { pageId: 'p-spring-harvest', lang: 'DE', message: "Link to '/shop/yirgacheffe.html': no page or file of this build is there." },
      { pageId: 'p-spring-harvest', lang: 'EN', message: "Link to '/shop/yirgacheffe.html': no page or file of this build is there." },
    ],
  },
  {
    code: 'SF-CHK-0204',
    severity: 'warning',
    category: 'seo',
    rule: 'Meta description length',
    fix: 'Write a description of 50–160 characters in the page’s SEO fields.',
    pages: [
      { pageId: 'p-team', lang: 'DE', carried: true, message: 'Meta description "Unser Team." is too short: 11 characters, at least 50 recommended.' },
      { pageId: 'p-careers', lang: 'EN', message: 'Meta description "Join us." is too short: 8 characters, at least 50 recommended.' },
      { pageId: 'p-berlin', lang: 'EN', carried: true, message: 'Meta description "Berlin roastery." is too short: 16 characters, at least 50 recommended.' },
    ],
  },
  {
    code: 'SF-CHK-0301',
    severity: 'warning',
    category: 'accessibility',
    rule: 'Image without alt attribute',
    fix: 'Add alt text to the image in the media library (Details tab) or in the section that places it.',
    pages: [{ pageId: 'p-hamburg-roastery', lang: 'EN', message: 'Image without alt attribute: roastery-hamburg-interior.jpg.' }],
  },
  {
    code: 'SF-CHK-0304',
    severity: 'warning',
    category: 'accessibility',
    rule: 'Heading level skipped',
    fix: 'Use the next heading level in the text: an h3 after an h2.',
    pages: [{ pageId: 'p-sustainability', lang: 'DE', message: 'Heading level skipped: h4 follows h2 without an h3.' }],
  },
];

const REBUILT_LAST: readonly RebuiltPage[] = [
  { pageId: 'p-spring-harvest', lang: 'DE', reason: 'Released', via: 'Spring harvest arrives was released', root: 'page' },
  { pageId: 'p-spring-harvest', lang: 'EN', reason: 'Released', via: 'Spring harvest arrives was released', root: 'page' },
  { pageId: 'p-news-overview', lang: 'DE', reason: 'Changed', via: 'Spring harvest arrives was released', root: 'page' },
  { pageId: 'p-news-overview', lang: 'EN', reason: 'Changed', via: 'Spring harvest arrives was released', root: 'page' },
  { pageId: 'p-home', lang: 'EN', reason: 'Changed', via: 'Main navigation changed', root: 'navigation' },
  { pageId: 'p-team', lang: 'DE', reason: 'Released', via: 'Team was released', root: 'page' },
  { pageId: 'p-single-origins', lang: 'DE', reason: 'URL changed', via: 'Single origins got a new URL', root: 'settings' },
  { pageId: 'p-brewing-gear', lang: 'EN', reason: 'Changed', via: 'Template product.html changed', root: 'template' },
  { pageId: 'p-espresso', lang: 'EN', reason: 'Changed', via: 'Template product.html changed', root: 'template' },
  { pageId: 'p-hamburg-roastery', lang: 'EN', reason: 'Changed', via: 'harvest-ethiopia.jpg was replaced', root: 'media' },
];

export const RUNS: readonly SampleRun[] = [
  {
    id: 'r-49', number: 49, status: 'queued', mode: 'incremental', targetId: 't-live', trigger: 'manual', by: EDITOR_NAME,
    startedMinutes: 0, durationSeconds: null, pages: 0, filesWritten: 0, filesSkipped: 0, bytes: '0 B', revision: 413,
    comment: 'Waits for run #48', findings: [], rebuilt: [], planState: 'pending',
  },
  {
    id: 'r-48', number: 48, status: 'running', mode: 'incremental', targetId: 't-live', trigger: 'release', by: 'Anna Berger',
    startedMinutes: 1, durationSeconds: null, pages: 12, progress: 58, filesWritten: 7, filesSkipped: 0, bytes: '1.1 MB', revision: 412,
    comment: 'Spring harvest article', findings: [], rebuilt: REBUILT_LAST.slice(0, 5),
    redirectsAdded: 1,
  },
  {
    id: 'r-47', number: 47, status: 'partial', mode: 'incremental', targetId: 't-live', trigger: 'manual', by: 'Jonas Weber',
    startedMinutes: 95, durationSeconds: 41, pages: 14, filesWritten: 26, filesSkipped: 312, bytes: '4.8 MB', revision: 405,
    findings: FINDINGS_LAST, rebuilt: REBUILT_LAST, channels: ['HTML', 'RSS'], redirectsAdded: 3, truncated: 212,
  },
  {
    id: 'r-46', number: 46, status: 'success', mode: 'full', targetId: 't-live', trigger: 'schedule', by: 'Nightly build',
    startedMinutes: 9 * 60, durationSeconds: 204, pages: 338, filesWritten: 338, filesSkipped: 0, bytes: '61.2 MB', revision: 398,
    findings: FINDINGS_LAST.slice(1), rebuilt: REBUILT_LAST.slice(2), redirectsAdded: 1,
  },
  {
    id: 'r-45', number: 45, status: 'success', mode: 'incremental', targetId: 't-staging', trigger: 'manual', by: 'Mira Okafor',
    startedMinutes: 26 * 60, durationSeconds: 18, pages: 4, filesWritten: 9, filesSkipped: 329, bytes: '0.9 MB', revision: 391,
    findings: [], rebuilt: REBUILT_LAST.slice(0, 4),
  },
  {
    id: 'r-44', number: 44, status: 'failed', mode: 'full', targetId: 't-cdn', trigger: 'manual', by: 'Lukas Brandt',
    startedMinutes: 30 * 60, durationSeconds: 7, pages: 10, filesWritten: 0, filesSkipped: 0, bytes: '0 B', revision: 388,
    comment: 'Bucket credentials rotated', findings: FINDINGS_LAST.slice(1), rebuilt: REBUILT_LAST, redirectsAdded: 1,
  },
  {
    id: 'r-43', number: 43, status: 'success', mode: 'incremental', targetId: 't-live', trigger: 'schedule', by: 'Nightly build',
    startedMinutes: 33 * 60, durationSeconds: 6, pages: 0, filesWritten: 0, filesSkipped: 338, bytes: '0 B', revision: 380,
    findings: [], rebuilt: [],
  },
  {
    id: 'r-42', number: 42, status: 'cancelled', mode: 'incremental', targetId: 't-live', trigger: 'manual', by: 'Sofia Marquez',
    startedMinutes: 50 * 60, durationSeconds: 12, pages: 3, filesWritten: 2, filesSkipped: 0, bytes: '0.2 MB', revision: 371,
    findings: [], rebuilt: REBUILT_LAST.slice(0, 2), planState: 'pruned',
  },
  {
    id: 'r-41', number: 41, status: 'failed', mode: 'full', targetId: 't-live', trigger: 'manual', by: 'Lukas Brandt',
    startedMinutes: 56 * 60, durationSeconds: 2, pages: 0, filesWritten: 0, filesSkipped: 0, bytes: '0 B', revision: 366,
    comment: 'Template product.html did not compile', findings: [], rebuilt: [], planState: 'none',
  },
];

export const RUNNING_RUN = RUNS.find((r) => r.id === 'r-48')!;
export const LAST_FINISHED_RUN = RUNS.find((r) => r.id === 'r-47')!;

export function runById(id: string | null): SampleRun | undefined {
  return RUNS.find((r) => r.id === id);
}

/** Whether the run is waiting or building: it can be cancelled and its log is live. */
export function isActiveRun(run: SampleRun): boolean {
  return run.status === 'queued' || run.status === 'running';
}

/** Whether the run's output can be promoted (published to another target): it finished and wrote something. */
export function isPromotable(run: SampleRun): boolean {
  return run.status === 'success' || run.status === 'partial';
}

/** The target a run is promoted to: the default target, or the CDN mirror for a run that is already on it. */
export function promoteTargetOf(run: SampleRun): PublishTarget {
  return run.targetId === DEFAULT_TARGET.id ? TARGETS.find((t) => t.id === 't-cdn')! : DEFAULT_TARGET;
}

/** Pages (page, language) a partial run held back: the ones with an Error finding. */
export function heldBackOf(run: SampleRun): { readonly pageId: string; readonly lang: string }[] {
  const held = new Map<string, { pageId: string; lang: string }>();
  for (const f of run.findings) {
    for (const p of f.pages) {
      if (f.severity === 'error') {
        held.set(`${p.pageId}-${p.lang}`, { pageId: p.pageId, lang: p.lang });
      }
    }
  }
  return [...held.values()];
}

export function findingCounts(run: SampleRun): { readonly errors: number; readonly warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const f of run.findings) {
    if (f.severity === 'error') {
      errors += f.pages.length;
    } else {
      warnings += f.pages.length;
    }
  }
  // Findings beyond the findings limit are counted, not stored (all of them warnings here).
  return { errors, warnings: warnings + (run.truncated ?? 0) };
}

// ── Log ──────────────────────────────────────────────────────────────────────

export interface LogLine {
  readonly n: number;
  readonly time: string;
  readonly stage: string;
  readonly text: string;
  readonly level: 'info' | 'warning' | 'error';
}

const STAGES: readonly (readonly [string, string])[] = [
  ['SNAPSHOT', 'Snapshotting assets'],
  ['PLAN', 'Planning build'],
  ['VALIDATE', 'Validating templates'],
  ['RENDER', 'Rendering pages'],
];

function clock(seconds: number): string {
  const h = 14;
  const m = 2 + Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** One rendered-file line of a run's log (`n` counts from 1). */
export function renderLine(n: number): LogLine {
  const pages = PAGES.filter((p) => !p.folder);
  const page = pages[n % pages.length];
  const lang = n % 2 ? 'de' : 'en';
  if (n % 23 === 0) {
    return { n, time: clock(n), stage: 'CHECK', level: 'warning', text: `[SF-CHK-0204] ${page.path} (${lang}): meta description too short` };
  }
  return { n, time: clock(n), stage: 'RENDER', level: 'info', text: `${lang}${page.path === '/' ? '/index' : page.path}.html (${(2 + (n % 9)) * 3} ms)` };
}

/** The log of a run: stage lines, then one line per rendered file; a finished run ends with its report. */
export function logOf(run: SampleRun): LogLine[] {
  const lines: LogLine[] = STAGES.map(([stage, text], i) => ({ n: i + 1, time: clock(i), stage, text, level: 'info' as const }));
  if (run.status === 'queued') {
    return [];
  }
  const count = run.status === 'running' ? 140 : run.status === 'failed' ? 0 : 1200;
  for (let i = 0; i < count; i++) {
    lines.push(renderLine(lines.length + 1));
  }
  if (run.status === 'failed') {
    lines.push({ n: lines.length + 1, time: clock(lines.length), stage: 'WRITE', level: 'error', text: 'Access denied writing to s3://nordlicht-site (403).' });
  }
  if (run.status !== 'running') {
    const tail: [string, string][] = [
      ['ASSETS', 'Copying media'],
      ['CHECK', 'Checking output'],
      ['WRITE', 'Writing output'],
      ['REPORT', run.status.toUpperCase()],
    ];
    for (const [stage, text] of tail) {
      lines.push({ n: lines.length + 1, time: clock(lines.length), stage, text, level: 'info' });
    }
  }
  return lines;
}

// ── Build now: dry-run plan ──────────────────────────────────────────────────

export interface BuildPlan {
  readonly pages: number;
  readonly media: number;
  readonly deleted: number;
  readonly redirects: number;
  readonly sample: readonly { readonly name: string; readonly reason: string }[];
}

export function planFor(mode: RunMode, scope: readonly string[]): BuildPlan {
  if (scope.length) {
    const picked = scope.map((id) => pageById(id)).filter((p): p is PublishPage => !!p);
    const pages = picked.reduce((sum, p) => sum + (p.folder ? 5 : 1), 0) * 2;
    return { pages, media: picked.length * 2, deleted: 0, redirects: 0, sample: picked.slice(0, 4).map((p) => ({ name: p.name, reason: 'Explicitly selected' })) };
  }
  if (mode === 'full') {
    return { pages: 338, media: 214, deleted: 0, redirects: 6, sample: [
      { name: 'Home', reason: 'Full build' },
      { name: 'News overview', reason: 'Full build' },
      { name: 'Espresso blends', reason: 'Full build' },
      { name: 'Our story', reason: 'Full build' },
    ] };
  }
  return { pages: 12, media: 3, deleted: 1, redirects: 1, sample: [
    { name: 'Spring harvest arrives', reason: 'Released' },
    { name: 'News overview', reason: 'Changed' },
    { name: 'Team', reason: 'Released' },
    { name: 'Single origins', reason: 'URL changed' },
  ] };
}

// ── Quality ──────────────────────────────────────────────────────────────────

/** A setting of one rule (M35.24 round 17): a number with its allowed range and default, or an on/off switch. */
export interface QualityParam {
  readonly id: string;
  readonly kind: 'number' | 'boolean';
  /** The field's label (content, like the rule name). */
  readonly label: string;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly default: number | boolean;
}

export interface QualityRule {
  readonly code: string;
  readonly category: QualityCategory;
  readonly name: string;
  readonly explanation: string;
  readonly fixIn: 'content' | 'template' | 'both';
  /** The level stored for the project. */
  readonly level: QualityLevel;
  /** The level the rule has until somebody changes it. */
  readonly defaultLevel: QualityLevel;
  /** The highest level the rule supports (findings capped at warnings). */
  readonly max?: QualityLevel;
  /** Findings of the last run. */
  readonly lastFindings: number;
  readonly params: readonly QualityParam[];
  /** The rule checks only these channels (the others are not checked); absent: every channel. */
  readonly channels?: readonly string[];
}

/** The levels a rule has until changed, where they are not Warning. */
const DEFAULT_LEVELS: Readonly<Record<string, QualityLevel>> = {
  'SF-CHK-0101': 'error',
  'SF-CHK-0102': 'error',
  'SF-CHK-0107': 'off',
  'SF-CHK-0109': 'off',
  'SF-CHK-0201': 'error',
  'SF-CHK-0205': 'off',
  'SF-CHK-0209': 'error',
  'SF-CHK-0211': 'off',
  'SF-CHK-0306': 'error',
  'SF-CHK-0308': 'error',
};

/** Rules with settings. */
const RULE_PARAMS: Readonly<Record<string, readonly QualityParam[]>> = {
  'SF-CHK-0202': [{ id: 'maxLength', kind: 'number', label: 'Longest title', unit: 'characters', min: 20, max: 120, default: 60 }],
  'SF-CHK-0204': [
    { id: 'minLength', kind: 'number', label: 'Shortest description', unit: 'characters', min: 10, max: 200, default: 50 },
    { id: 'maxLength', kind: 'number', label: 'Longest description', unit: 'characters', min: 50, max: 400, default: 160 },
  ],
  'SF-CHK-0211': [{ id: 'required', kind: 'boolean', label: 'Also report pages without a canonical link', default: false }],
  'SF-CHK-0302': [{ id: 'minLength', kind: 'number', label: 'Shortest link text', unit: 'characters', min: 1, max: 20, default: 3 }],
};

/** Rules that check only some of the project's channels. */
const RULE_CHANNELS: Readonly<Record<string, readonly string[]>> = {
  'SF-CHK-0108': ['HTML'],
  'SF-CHK-0202': ['HTML'],
  'SF-CHK-0204': ['HTML'],
  'SF-CHK-0211': ['HTML'],
};

function rule(code: string, category: QualityCategory, name: string, explanation: string, fixIn: QualityRule['fixIn'], level: QualityLevel = 'warning', lastFindings = 0, max?: QualityLevel): QualityRule {
  return { code, category, name, explanation, fixIn, level, defaultLevel: DEFAULT_LEVELS[code] ?? 'warning', lastFindings, max, params: RULE_PARAMS[code] ?? [], channels: RULE_CHANNELS[code] };
}

export const QUALITY_RULES: readonly QualityRule[] = [
  rule('SF-CHK-0101', 'links', 'Link to a missing page or file', 'A link points at a path no page or file of this build is at — visitors get a 404.', 'both', 'error', 2),
  rule('SF-CHK-0102', 'links', 'Link to missing media', 'A hard-coded media path in a template that the build has no file for.', 'template'),
  rule('SF-CHK-0103', 'links', 'Link to a page held back in this build', 'The linked page has an error finding, so it is held back; the link leads to its old version or nowhere.', 'content', 'warning', 0, 'warning'),
  rule('SF-CHK-0104', 'links', 'Link to an unreleased asset', 'It renders an empty link until the target is released.', 'both'),
  rule('SF-CHK-0105', 'links', 'Link to a deleted asset', 'The target was deleted; the link renders empty.', 'both'),
  rule('SF-CHK-0107', 'links', 'Missing anchor', 'A link to #section, but the target page has no element with that id.', 'both', 'off'),
  rule('SF-CHK-0108', 'links', 'Empty or #-only link', 'A link with href="#" goes nowhere but to the top of the page.', 'both'),
  rule('SF-CHK-0109', 'links', 'Link reaches only a redirect', 'The link works, but through a redirect; link to the new URL directly.', 'both', 'off'),
  rule('SF-CHK-0201', 'seo', 'Missing or empty title', 'The page has no <title>, or an empty one — search results show the URL instead.', 'template', 'error'),
  rule('SF-CHK-0202', 'seo', 'Title length', 'Titles between 10 and 60 characters show in full in search results.', 'both'),
  rule('SF-CHK-0203', 'seo', 'Missing meta description', 'Without a description, search engines pick a snippet from the page.', 'template'),
  rule('SF-CHK-0204', 'seo', 'Meta description length', 'Descriptions between 50 and 160 characters show in full in search results.', 'content', 'warning', 3),
  rule('SF-CHK-0205', 'seo', 'Duplicate title', 'Several pages of a language share a title; search engines may show only one.', 'both'),
  rule('SF-CHK-0207', 'seo', 'No h1 heading', 'Every page should have one main heading.', 'template'),
  rule('SF-CHK-0209', 'seo', "Language attribute doesn't match the page's language", 'The lang of <html> differs from the language the page is generated in.', 'template', 'error'),
  rule('SF-CHK-0211', 'seo', 'Canonical link missing or broken', 'Reports a canonical link that points at a missing page; with "required", pages without one too.', 'template', 'off'),
  rule('SF-CHK-0301', 'accessibility', 'Image without alt attribute', 'Screen readers announce the file name instead; decorative images need alt="".', 'both', 'warning', 1),
  rule('SF-CHK-0302', 'accessibility', 'Link without accessible text', 'An icon-only link without text or aria-label is announced as "link".', 'both'),
  rule('SF-CHK-0303', 'accessibility', 'Button without accessible text', 'An icon-only button without text or aria-label is announced as "button".', 'template'),
  rule('SF-CHK-0304', 'accessibility', 'Heading level skipped', 'Headings should go down one level at a time, so the outline makes sense.', 'both', 'warning', 1),
  rule('SF-CHK-0305', 'accessibility', 'Duplicate id', 'Ids must be unique; labels and links to a duplicated id reach the first only.', 'template'),
  rule('SF-CHK-0306', 'accessibility', 'Form control without label', 'A field without a label is announced without a name.', 'template', 'error'),
  rule('SF-CHK-0308', 'accessibility', '<html> without lang', 'Screen readers need the language to pronounce the page.', 'template', 'error'),
];

// ── Redirects ────────────────────────────────────────────────────────────────

/** A channel of the project; language-less channels (static files) have no language. */
export interface SampleChannel {
  readonly id: string;
  readonly name: string;
  readonly localized: boolean;
}

export const SAMPLE_CHANNELS: readonly SampleChannel[] = [
  { id: 'html', name: 'HTML', localized: true },
  { id: 'rss', name: 'RSS', localized: true },
  { id: 'files', name: 'Files', localized: false },
];

export interface SampleRedirect {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** The page the redirect follows, when it leads to a page. */
  readonly toPage: string | null;
  /** That page's id in {@link PAGES}, when it still exists there (the edit dialog preselects it). */
  readonly toPageId?: string;
  readonly channel: string;
  /** `DE`, `EN`, or `—` on a channel without languages. */
  readonly lang: string;
  readonly kind: RedirectKind;
  readonly state: RedirectState;
  readonly createdMinutes: number;
  /** The member who added a manual redirect. */
  readonly createdBy: string;
  /** The run that wrote an automatic redirect (its number), else null. */
  readonly run: number | null;
}

export const REDIRECTS: readonly SampleRedirect[] = [
  { id: 'rd-1', from: '/en/news/spring-harvest-2025.html', to: '/en/news/spring-harvest.html', toPage: 'Spring harvest arrives', toPageId: 'p-spring-harvest', channel: 'html', lang: 'EN', kind: 'auto', state: 'active', createdMinutes: 95, createdBy: '', run: 47 },
  { id: 'rd-2', from: '/de/news/fruehlingsernte-2025.html', to: '/de/news/spring-harvest.html', toPage: 'Spring harvest arrives', toPageId: 'p-spring-harvest', channel: 'html', lang: 'DE', kind: 'auto', state: 'active', createdMinutes: 95, createdBy: '', run: 47 },
  { id: 'rd-3', from: '/de/shop/single-origin.html', to: '/de/shop/single-origins.html', toPage: 'Single origins', toPageId: 'p-single-origins', channel: 'html', lang: 'DE', kind: 'auto', state: 'active', createdMinutes: 7 * 60, createdBy: '', run: 46 },
  { id: 'rd-4', from: '/en/about/jobs.html', to: '/en/about/careers.html', toPage: 'Careers', toPageId: 'p-careers', channel: 'html', lang: 'EN', kind: 'manual', state: 'active', createdMinutes: 20 * 1440, createdBy: 'Jonas Weber', run: null },
  { id: 'rd-5', from: '/en/locations/munich.html', to: '/en/locations/munich-preview.html', toPage: 'Munich', channel: 'html', lang: 'EN', kind: 'manual', state: 'dangling', createdMinutes: 2 * 1440, createdBy: 'Sofia Marquez', run: null },
  { id: 'rd-6', from: '/en/contact.html', to: '/en/contact-us.html', toPage: null, channel: 'html', lang: 'EN', kind: 'manual', state: 'shadowed', createdMinutes: 40 * 1440, createdBy: 'Lukas Brandt', run: null },
  { id: 'rd-7', from: '/de/kaffee/', to: '/de/coffee/', toPage: null, channel: 'html', lang: 'DE', kind: 'manual', state: 'loop', createdMinutes: 3 * 1440, createdBy: 'Mira Okafor', run: null },
  { id: 'rd-8', from: '/en/news/feed-old.xml', to: '/en/news/feed.xml', toPage: null, channel: 'rss', lang: 'EN', kind: 'manual', state: 'active', createdMinutes: 12 * 1440, createdBy: 'Jonas Weber', run: null },
  { id: 'rd-9', from: '/media/old-menu.pdf', to: 'https://cdn.nordlicht-roastery.example/menu.pdf', toPage: null, channel: 'files', lang: '—', kind: 'manual', state: 'active', createdMinutes: 5 * 1440, createdBy: 'Sofia Marquez', run: null },
];

// ── URL registry ─────────────────────────────────────────────────────────────

export interface RegisteredUrl {
  readonly id: string;
  readonly target: string;
  readonly type: 'page' | 'media' | 'folder';
  readonly channel: string;
  /** `DE`, `EN`, or `—` ("No language"). */
  readonly lang: string;
  readonly area: UrlArea;
  readonly url: string;
  readonly overridden: boolean;
  readonly assignedMinutes: number;
  /** The target no longer exists (its URL stays registered until reset). */
  readonly deleted?: boolean;
}

export const URLS: readonly RegisteredUrl[] = [
  { id: 'u-1', target: 'Home', type: 'page', channel: 'html', lang: 'DE', area: 'generated', url: '/de/index.html', overridden: false, assignedMinutes: 60 * 1440 },
  { id: 'u-2', target: 'Home', type: 'page', channel: 'html', lang: 'EN', area: 'generated', url: '/en/index.html', overridden: false, assignedMinutes: 60 * 1440 },
  { id: 'u-3', target: 'Spring harvest arrives', type: 'page', channel: 'html', lang: 'DE', area: 'generated', url: '/de/news/spring-harvest.html', overridden: false, assignedMinutes: 95 },
  { id: 'u-4', target: 'Spring harvest arrives', type: 'page', channel: 'html', lang: 'EN', area: 'generated', url: '/en/news/spring-harvest.html', overridden: false, assignedMinutes: 95 },
  { id: 'u-5', target: 'Spring harvest arrives', type: 'page', channel: 'rss', lang: 'EN', area: 'generated', url: '/en/news/feed.xml', overridden: false, assignedMinutes: 95 },
  { id: 'u-6', target: 'Careers', type: 'page', channel: 'html', lang: 'EN', area: 'generated', url: '/en/about/careers.html', overridden: true, assignedMinutes: 20 * 1440 },
  { id: 'u-7', target: 'Shop', type: 'folder', channel: 'html', lang: 'DE', area: 'generated', url: '/de/shop/', overridden: false, assignedMinutes: 30 * 1440 },
  { id: 'u-8', target: 'harvest-ethiopia.jpg', type: 'media', channel: 'all', lang: '—', area: 'generated', url: '/media/harvest-ethiopia.jpg', overridden: false, assignedMinutes: 3 * 1440 },
  { id: 'u-9', target: 'price-list-2026.pdf', type: 'media', channel: 'all', lang: 'DE', area: 'generated', url: '/media/de/preisliste-2026.pdf', overridden: true, assignedMinutes: 9 * 1440 },
  { id: 'u-10', target: 'Munich', type: 'page', channel: 'html', lang: 'EN', area: 'preview', url: '/preview/en/locations/munich.html', overridden: false, assignedMinutes: 2 * 60 },
  { id: 'u-11', target: 'Summer promotion 2025', type: 'page', channel: 'html', lang: 'EN', area: 'generated', url: '/en/news/summer-promotion.html', overridden: false, assignedMinutes: 120 * 1440, deleted: true },
  { id: 'u-12', target: 'Summer promotion 2025', type: 'page', channel: 'html', lang: 'DE', area: 'generated', url: '/de/news/sommeraktion.html', overridden: true, assignedMinutes: 120 * 1440, deleted: true },
  { id: 'u-13', target: 'Team', type: 'page', channel: 'html', lang: 'DE', area: 'generated', url: '/de/about/team.html', overridden: false, assignedMinutes: 45 * 1440 },
  { id: 'u-14', target: 'Team', type: 'page', channel: 'html', lang: 'EN', area: 'generated', url: '/en/about/team.html', overridden: false, assignedMinutes: 45 * 1440 },
  { id: 'u-15', target: 'Imprint', type: 'page', channel: 'html', lang: 'EN', area: 'generated', url: '/en/imprint.html', overridden: false, assignedMinutes: 60 * 1440 },
  { id: 'u-16', target: 'logo.svg', type: 'media', channel: 'all', lang: '—', area: 'generated', url: '/media/logo.svg', overridden: false, assignedMinutes: 60 * 1440 },
];

/** The project's key: what the typed confirmations of the destructive actions ask for. */
export const PROJECT_KEY = 'nordlicht-roastery';

// ── Build now: channels and the explicit plan preview (M35.24 round 17) ──────

export type BuildChannel = 'html' | 'rss' | 'markdown';
/** The project's enabled channels (one checkbox each in Build now). */
export const BUILD_CHANNELS: readonly BuildChannel[] = ['html', 'rss', 'markdown'];

export type BuildRootKind = 'page' | 'recordSet' | 'globalSet' | 'template' | 'media';
export type BuildViaKind = 'template' | 'globalSet' | 'page' | 'media';

/** The preview a Build now plan shows ("computed at revision N"), as the real plan endpoint answers it. */
export interface BuildPreview {
  readonly revision: number;
  readonly pages: number;
  readonly media: number;
  readonly deleted: number;
  readonly redirects: number;
  /** An incremental plan that cannot be computed incrementally and falls back to a full build. */
  readonly fallback: boolean;
  /** Nothing changed since the last build. */
  readonly empty: boolean;
  readonly roots: readonly { readonly kind: BuildRootKind; readonly count: number }[];
  /** Groups of changed output by the change they come from, largest first. */
  readonly via: readonly { readonly kind: BuildViaKind; readonly name: string; readonly count: number }[];
  readonly assets: readonly { readonly type: 'page' | 'media' | 'template' | 'recordSet'; readonly uid: string; readonly change: 'deleted' | 'changed'; readonly revision: number }[];
  /** Redirects the run would add on its own. */
  readonly autoRedirects: readonly { readonly from: string; readonly to: string; readonly channel: BuildChannel; readonly locale: string }[];
}

export interface BuildDiagnostic {
  readonly code: string;
  readonly message: string;
}

export const BUILD_REVISION = 1482;

export function previewFor(mode: RunMode, scope: readonly string[], opts: { fallback: boolean; empty: boolean }): BuildPreview {
  const base = { revision: BUILD_REVISION, fallback: false, empty: false };
  if (opts.empty && !scope.length) {
    return { ...base, empty: true, pages: 0, media: 0, deleted: 0, redirects: 0, roots: [], via: [], assets: [], autoRedirects: [] };
  }
  const counts = planFor(opts.fallback ? 'full' : mode, scope);
  const full = !scope.length && (mode === 'full' || opts.fallback);
  return {
    ...base,
    fallback: opts.fallback && mode === 'incremental' && !scope.length,
    pages: counts.pages,
    media: counts.media,
    deleted: counts.deleted,
    redirects: counts.redirects,
    roots: full
      ? [{ kind: 'page', count: 164 }, { kind: 'recordSet', count: 118 }, { kind: 'globalSet', count: 6 }, { kind: 'template', count: 24 }, { kind: 'media', count: 26 }]
      : scope.length
        ? [{ kind: 'page', count: counts.pages / 2 }]
        : [{ kind: 'page', count: 5 }, { kind: 'recordSet', count: 4 }, { kind: 'globalSet', count: 1 }, { kind: 'template', count: 1 }, { kind: 'media', count: 3 }],
    via: scope.length
      ? []
      : full
        ? [{ kind: 'template', name: 'base.html', count: 338 }, { kind: 'globalSet', name: 'Footer', count: 338 }, { kind: 'template', name: 'article.html', count: 74 }]
        : [{ kind: 'globalSet', name: 'Footer', count: 6 }, { kind: 'template', name: 'article.html', count: 4 }, { kind: 'page', name: 'Spring harvest arrives', count: 2 }],
    assets: scope.length
      ? []
      : [
          { type: 'page', uid: 'news/spring-harvest', change: 'changed', revision: 1481 },
          { type: 'page', uid: 'about/team', change: 'changed', revision: 1480 },
          { type: 'media', uid: 'harvest-ethiopia.jpg', change: 'changed', revision: 1479 },
          { type: 'page', uid: 'shop/old-grinder', change: 'deleted', revision: 1478 },
        ],
    autoRedirects: scope.length
      ? []
      : [{ from: '/en/shop/old-grinder.html', to: '/en/shop/grinders.html', channel: 'html', locale: 'en' }],
  };
}

/** What "Validate templates" reports (`bdiag=1`); otherwise the templates validate cleanly. */
export const BUILD_DIAGNOSTICS: readonly BuildDiagnostic[] = [
  { code: 'SF-TPL-0102', message: 'article.html, line 14: unknown filter "money".' },
  { code: 'SF-TPL-0117', message: 'footer.html, line 3: include "partials/legal.html" not found.' },
];

// ── Policy: the schedules that would fail when permissions are taken away (`pdialog=impact`) ──

export interface PolicyImpactRow {
  readonly type: 'release' | 'unpublish';
  readonly item: string;
  readonly runAt: string;
  readonly owner: string;
  readonly missing: PolicyAction;
}

export const POLICY_IMPACT: readonly PolicyImpactRow[] = [
  { type: 'release', item: 'Spring harvest arrives', runAt: '2026-10-12 09:00', owner: 'Mara Hoffmann', missing: 'schedule' },
  { type: 'unpublish', item: 'Summer promotion', runAt: '2026-10-14 00:00', owner: 'Jonas Weber', missing: 'schedule' },
  { type: 'release', item: 'Autumn blends', runAt: '2026-10-20 08:30', owner: 'Mara Hoffmann', missing: 'release' },
];

/** What editors may do today (the project's Publishing by editors settings; admins and developers always may do all). */
export type EditorPolicy = Readonly<Record<PolicyAction, boolean>>;
export const EDITOR_POLICY: EditorPolicy = { release: true, schedule: true, incremental: true, full: false };
