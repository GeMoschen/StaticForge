import type { components } from '../../../../core/api/generated/schema.d.ts';
import type { FindingPageView, QualityRuleItem } from '../findings.util';

type GenerationRunView = components['schemas']['GenerationRunView'];
type GenerationPlanView = components['schemas']['GenerationPlanView'];

/*
 * Responses captured from a dev backend (M30.6.2 manual check): a localized project (de default, en) with a clean
 * template, a "Bare" one (no title, an image without alt, broken links) and one without a title; rule SF-CHK-0301 set
 * to ERROR holds Alpha and Beta back. Run 2 is the incremental build after Gamma's uid changed. Trimmed to what the
 * specs read; values unchanged.
 */

export const ABOUT = '852d2ed6-741b-40e0-bc03-193d760ff9cd';
export const ALPHA = 'c7969335-210e-4a59-8110-1fe2261a5e88';
export const GAMMA = '252019da-bb99-4b5b-a827-b5f34069d740';

/** `GET /generations/2` after the move: held-back pages, findings and redirect counts. */
export const RUN_WITH_FINDINGS: GenerationRunView = {
  id: 2,
  revisionId: 19,
  mode: 'INCREMENTAL',
  channels: [],
  targetId: 1,
  status: 'PARTIAL',
  startedAt: '2026-09-27T15:20:29.165236Z',
  finishedAt: '2026-09-27T15:20:30.023573Z',
  filesWritten: 2,
  filesSkipped: 0,
  bytesWritten: 722,
  errorCount: 4,
  warningCount: 0,
  diagnostics: {
    errors: [
      {
        code: 'SF-GEN-0125',
        count: 4,
        messages: [
          "Quality check failed for page 'alpha' (html, de): SF-CHK-0301",
          "Quality check failed for page 'beta' (html, de): SF-CHK-0301",
          "Quality check failed for page 'alpha' (html, en): SF-CHK-0301",
          "Quality check failed for page 'beta' (html, en): SF-CHK-0301",
        ],
      },
    ],
    warnings: [],
  } as unknown as GenerationRunView['diagnostics'],
  planSummary: {
    mode: 'INCREMENTAL',
    incremental: true,
    revision: 19,
    scoped: false,
    channels: ['html'],
    changedAssetCount: 1,
    entryCount: 2,
    pageCount: 1,
    processedMediaCount: 0,
    byRootKind: { ASSET_CHANGED: 2 },
    byFirstEdge: { NONE: 2 },
    byChannel: { html: 2 },
    via: [],
    planAvailable: true,
    redirectsAdded: 2,
    redirectsActive: 2,
  },
  startedBy: { id: 1, displayName: 'Administrator' },
  findingCounts: {
    errors: 4,
    warnings: 42,
    byCategory: { links: 10, seo: 22, accessibility: 14 },
    truncated: 0,
  },
};

/** `GET /generations/2/findings?size=5`: the first rows, one of them carried from run 1. */
export const FINDINGS_PAGE: FindingPageView = {
  content: [
    {
      id: 51,
      code: 'SF-CHK-0204',
      category: 'SEO',
      severity: 'WARNING',
      message: 'Meta description "About About DE in detail." is too short: 25 characters, at least 50 recommended.',
      selector: 'head > meta',
      carried: true,
      outputPath: 'about.html',
      channel: 'html',
      locale: 'de',
      page: { uuid: ABOUT, uid: 'about', displayName: 'About' },
    },
    {
      id: 53,
      code: 'SF-CHK-0101',
      category: 'LINKS',
      severity: 'WARNING',
      message: "Link to 'missing.html': no page or file of this build is there.",
      selector: 'body > a',
      carried: false,
      outputPath: 'en/alpha.html',
      channel: 'html',
      locale: 'en',
      page: { uuid: ALPHA, uid: 'alpha', displayName: 'Alpha' },
    },
    {
      id: 55,
      code: 'SF-CHK-0201',
      category: 'SEO',
      severity: 'WARNING',
      message: 'The page has no <title>.',
      carried: false,
      outputPath: 'alpha.html',
      channel: 'html',
      locale: 'de',
      page: { uuid: ALPHA, uid: 'alpha', displayName: 'Alpha' },
    },
    {
      id: 57,
      code: 'SF-CHK-0301',
      category: 'ACCESSIBILITY',
      severity: 'ERROR',
      message: 'Image without alt attribute: pic.png.',
      selector: 'body > img',
      carried: false,
      outputPath: 'alpha.html',
      channel: 'html',
      locale: 'de',
      page: { uuid: ALPHA, uid: 'alpha', displayName: 'Alpha' },
    },
  ],
  page: { size: 25, number: 0, totalElements: 46, totalPages: 2 },
};

/** `GET /quality-rules`, the rules the fixtures' findings name. */
export const RULES: QualityRuleItem[] = [
  { code: 'SF-CHK-0101', name: 'Link to a missing page or file', category: 'LINKS', severity: 'WARNING' },
  { code: 'SF-CHK-0102', name: 'Link to missing media', category: 'LINKS', severity: 'WARNING' },
  { code: 'SF-CHK-0201', name: 'Missing or empty title', category: 'SEO', severity: 'WARNING' },
  { code: 'SF-CHK-0204', name: 'Meta description length', category: 'SEO', severity: 'WARNING' },
  { code: 'SF-CHK-0301', name: 'Image without alt attribute', category: 'ACCESSIBILITY', severity: 'ERROR' },
];

/** `POST /generations/plan` after Gamma's uid changed: the redirects the build would add. */
export const PLAN_AFTER_MOVE: GenerationPlanView = {
  target: { id: 1, name: 'site' },
  summary: {
    mode: 'INCREMENTAL',
    incremental: true,
    revision: 19,
    channels: ['html'],
    changedAssetCount: 1,
    entryCount: 2,
    pageCount: 1,
    byRootKind: { ASSET_CHANGED: 2 },
    byFirstEdge: { NONE: 2 },
    byChannel: { html: 2 },
    via: [],
    planAvailable: true,
    redirectsAdded: 2,
  },
  changedAssets: [{ uuid: GAMMA, type: 'PAGE', uid: 'gamma_moved', deleted: false, revision: 19 }],
  entries: { content: [], page: { size: 25, number: 0, totalElements: 2, totalPages: 1 } },
  redirectCandidates: [
    { channel: 'html', locale: 'de', fromPath: 'gamma.html', toAssetUuid: GAMMA, toPageNumber: 1, toPath: 'gamma_moved.html' },
    {
      channel: 'html',
      locale: 'en',
      fromPath: 'en/gamma.html',
      toAssetUuid: GAMMA,
      toPageNumber: 1,
      toPath: 'en/gamma_moved.html',
    },
  ],
};
