/**
 * Fake data of the sample's Publishing area (M35.9 decisions 27–28): build runs of the coffee-roaster site, their
 * findings and logs, targets, the publish policy, the quality rules, redirects and the URL registry. Content, not UI
 * text — the area's labels live in `en.json` under `styleguide.sample.publishing.*`. Nothing is saved.
 *
 * Page names are copied from the sample's Pages tree (`sample-data.ts`), not imported, so this area stands alone.
 */

export type RunStatus = 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
export type RunMode = 'full' | 'incremental';
export type RunTrigger = 'manual' | 'schedule' | 'release';
export type FindingSeverity = 'error' | 'warning';
export type QualityCategory = 'links' | 'seo' | 'accessibility';
export type QualityLevel = 'off' | 'warning' | 'error';
export type TargetKind = 'folder' | 'zip' | 's3';
export type RedirectState = 'active' | 'shadowed' | 'dangling' | 'loop';
export type RedirectKind = 'auto' | 'manual';
export type PolicyRole = 'editor' | 'developer' | 'admin';
export type PolicyAction = 'release' | 'schedule' | 'incremental' | 'full';
export type UrlArea = 'generated' | 'preview';

export const RUN_STATUSES: readonly RunStatus[] = ['running', 'success', 'partial', 'failed', 'cancelled'];
export const QUALITY_CATEGORIES: readonly QualityCategory[] = ['links', 'seo', 'accessibility'];
export const QUALITY_LEVELS: readonly QualityLevel[] = ['off', 'warning', 'error'];
export const POLICY_ROLES: readonly PolicyRole[] = ['editor', 'developer', 'admin'];
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

// ── Targets ──────────────────────────────────────────────────────────────────

export interface PublishTarget {
  readonly id: string;
  readonly name: string;
  readonly kind: TargetKind;
  /** Output folder, archive path or bucket URL. */
  readonly location: string;
  readonly baseUrl: string;
  readonly isDefault: boolean;
}

export const TARGETS: readonly PublishTarget[] = [
  { id: 't-live', name: 'Live site', kind: 'folder', location: '/srv/www/roastery-live', baseUrl: 'https://www.nordlicht-roastery.example', isDefault: true },
  { id: 't-staging', name: 'Staging', kind: 'folder', location: '/srv/www/roastery-staging', baseUrl: 'https://staging.nordlicht-roastery.example', isDefault: false },
  { id: 't-archive', name: 'Monthly archive', kind: 'zip', location: '/backups/site-archive.zip', baseUrl: 'https://www.nordlicht-roastery.example', isDefault: false },
  { id: 't-cdn', name: 'CDN mirror', kind: 's3', location: 's3://nordlicht-site/eu-central-1', baseUrl: 'https://cdn.nordlicht-roastery.example', isDefault: false },
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
  readonly pages: readonly { readonly pageId: string; readonly message: string; readonly lang: string }[];
}

export interface RebuiltPage {
  readonly pageId: string;
  readonly lang: string;
  readonly reason: string;
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
      { pageId: 'p-team', lang: 'DE', message: 'Meta description "Unser Team." is too short: 11 characters, at least 50 recommended.' },
      { pageId: 'p-careers', lang: 'EN', message: 'Meta description "Join us." is too short: 8 characters, at least 50 recommended.' },
      { pageId: 'p-berlin', lang: 'EN', message: 'Meta description "Berlin roastery." is too short: 16 characters, at least 50 recommended.' },
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
  { pageId: 'p-spring-harvest', lang: 'DE', reason: 'Released' },
  { pageId: 'p-spring-harvest', lang: 'EN', reason: 'Released' },
  { pageId: 'p-news-overview', lang: 'DE', reason: 'Changed' },
  { pageId: 'p-news-overview', lang: 'EN', reason: 'Changed' },
  { pageId: 'p-home', lang: 'EN', reason: 'Changed' },
  { pageId: 'p-team', lang: 'DE', reason: 'Released' },
  { pageId: 'p-single-origins', lang: 'DE', reason: 'URL changed' },
];

export const RUNS: readonly SampleRun[] = [
  {
    id: 'r-48', number: 48, status: 'running', mode: 'incremental', targetId: 't-live', trigger: 'release', by: 'Anna Berger',
    startedMinutes: 1, durationSeconds: null, pages: 12, progress: 58, filesWritten: 7, filesSkipped: 0, bytes: '1.1 MB', revision: 412,
    comment: 'Spring harvest article', findings: [], rebuilt: REBUILT_LAST.slice(0, 5),
  },
  {
    id: 'r-47', number: 47, status: 'partial', mode: 'incremental', targetId: 't-live', trigger: 'manual', by: 'Jonas Weber',
    startedMinutes: 95, durationSeconds: 41, pages: 14, filesWritten: 26, filesSkipped: 312, bytes: '4.8 MB', revision: 405,
    findings: FINDINGS_LAST, rebuilt: REBUILT_LAST,
  },
  {
    id: 'r-46', number: 46, status: 'success', mode: 'full', targetId: 't-live', trigger: 'schedule', by: 'Nightly build',
    startedMinutes: 9 * 60, durationSeconds: 204, pages: 338, filesWritten: 338, filesSkipped: 0, bytes: '61.2 MB', revision: 398,
    findings: FINDINGS_LAST.slice(1), rebuilt: REBUILT_LAST.slice(2),
  },
  {
    id: 'r-45', number: 45, status: 'success', mode: 'incremental', targetId: 't-staging', trigger: 'manual', by: 'Mira Okafor',
    startedMinutes: 26 * 60, durationSeconds: 18, pages: 4, filesWritten: 9, filesSkipped: 329, bytes: '0.9 MB', revision: 391,
    findings: [], rebuilt: REBUILT_LAST.slice(0, 4),
  },
  {
    id: 'r-44', number: 44, status: 'failed', mode: 'full', targetId: 't-cdn', trigger: 'manual', by: 'Lukas Brandt',
    startedMinutes: 30 * 60, durationSeconds: 7, pages: 0, filesWritten: 0, filesSkipped: 0, bytes: '0 B', revision: 388,
    comment: 'Bucket credentials rotated', findings: [], rebuilt: [],
  },
  {
    id: 'r-43', number: 43, status: 'success', mode: 'full', targetId: 't-live', trigger: 'schedule', by: 'Nightly build',
    startedMinutes: 33 * 60, durationSeconds: 198, pages: 336, filesWritten: 336, filesSkipped: 0, bytes: '60.7 MB', revision: 380,
    findings: FINDINGS_LAST.slice(1, 3), rebuilt: REBUILT_LAST.slice(3),
  },
  {
    id: 'r-42', number: 42, status: 'cancelled', mode: 'incremental', targetId: 't-live', trigger: 'manual', by: 'Sofia Marquez',
    startedMinutes: 50 * 60, durationSeconds: 12, pages: 3, filesWritten: 2, filesSkipped: 0, bytes: '0.2 MB', revision: 371,
    findings: [], rebuilt: REBUILT_LAST.slice(0, 2),
  },
];

export const RUNNING_RUN = RUNS[0];
export const LAST_FINISHED_RUN = RUNS[1];

export function runById(id: string | null): SampleRun | undefined {
  return RUNS.find((r) => r.id === id);
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
  return { errors, warnings };
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

// ── Policy ───────────────────────────────────────────────────────────────────

export type PolicyGrid = Readonly<Record<PolicyAction, Readonly<Record<PolicyRole, boolean>>>>;

export const POLICY: PolicyGrid = {
  release: { editor: true, developer: true, admin: true },
  schedule: { editor: true, developer: true, admin: true },
  incremental: { editor: true, developer: true, admin: true },
  full: { editor: false, developer: true, admin: true },
};

// ── Quality ──────────────────────────────────────────────────────────────────

export interface QualityRule {
  readonly code: string;
  readonly category: QualityCategory;
  readonly name: string;
  readonly explanation: string;
  readonly fixIn: 'content' | 'template' | 'both';
  readonly level: QualityLevel;
  /** The highest level the rule supports (findings capped at warnings). */
  readonly max?: QualityLevel;
  /** Findings of the last run. */
  readonly lastFindings: number;
}

function rule(code: string, category: QualityCategory, name: string, explanation: string, fixIn: QualityRule['fixIn'], level: QualityLevel = 'warning', lastFindings = 0, max?: QualityLevel): QualityRule {
  return { code, category, name, explanation, fixIn, level, lastFindings, max };
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

export interface SampleRedirect {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly toPage: string | null;
  readonly lang: string;
  readonly kind: RedirectKind;
  readonly state: RedirectState;
  readonly createdMinutes: number;
  readonly createdBy: string;
}

export const REDIRECTS: readonly SampleRedirect[] = [
  { id: 'rd-1', from: '/en/news/spring-harvest-2025.html', to: '/en/news/spring-harvest.html', toPage: 'Spring harvest arrives', lang: 'EN', kind: 'auto', state: 'active', createdMinutes: 95, createdBy: 'run #47' },
  { id: 'rd-2', from: '/de/news/fruehlingsernte-2025.html', to: '/de/news/spring-harvest.html', toPage: 'Spring harvest arrives', lang: 'DE', kind: 'auto', state: 'active', createdMinutes: 95, createdBy: 'run #47' },
  { id: 'rd-3', from: '/de/shop/single-origin.html', to: '/de/shop/single-origins.html', toPage: 'Single origins', lang: 'DE', kind: 'auto', state: 'active', createdMinutes: 7 * 60, createdBy: 'run #46' },
  { id: 'rd-4', from: '/en/about/jobs.html', to: '/en/about/careers.html', toPage: 'Careers', lang: 'EN', kind: 'manual', state: 'active', createdMinutes: 20 * 1440, createdBy: 'Jonas Weber' },
  { id: 'rd-5', from: '/en/locations/munich.html', to: '/en/locations/munich-preview.html', toPage: 'Munich', lang: 'EN', kind: 'manual', state: 'dangling', createdMinutes: 2 * 1440, createdBy: 'Sofia Marquez' },
  { id: 'rd-6', from: '/en/contact.html', to: '/en/contact-us.html', toPage: null, lang: 'EN', kind: 'manual', state: 'shadowed', createdMinutes: 40 * 1440, createdBy: 'Lukas Brandt' },
  { id: 'rd-7', from: '/de/kaffee/', to: '/de/coffee/', toPage: null, lang: 'DE', kind: 'manual', state: 'loop', createdMinutes: 3 * 1440, createdBy: 'Mira Okafor' },
];

// ── URL registry ─────────────────────────────────────────────────────────────

export interface RegisteredUrl {
  readonly id: string;
  readonly target: string;
  readonly type: 'page' | 'media' | 'folder';
  readonly channel: string;
  readonly lang: string;
  readonly area: UrlArea;
  readonly url: string;
  readonly overridden: boolean;
  readonly assignedMinutes: number;
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
];

/** The project's key: what the typed confirmations of the destructive actions ask for. */
export const PROJECT_KEY = 'nordlicht-roastery';
