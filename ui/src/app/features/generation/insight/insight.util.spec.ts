import { describe, expect, it } from 'vitest';
import {
  chainLines,
  edgeLabel,
  entryQueryParams,
  fallbackWarning,
  firstEdgeRows,
  impactHeadline,
  otherCausesLabel,
  planRequestKey,
  planSummaryLine,
  reasonBadge,
  reasonText,
  rootKindRows,
  viaRows,
  type PlanEntryView,
  type PlanSummaryView,
  type ReasonView,
} from './insight.util';

const hero = { uuid: 'm1', type: 'MEDIA', uid: 'hero' };

const twoHops: ReasonView = {
  rootKind: 'ASSET_CHANGED',
  rootAsset: hero,
  rootRevision: 1842,
  causeCount: 1,
  steps: [
    { assetUuid: 'p1', assetType: 'PAGE', uid: 'about', edge: 'PAGE_TEMPLATE', sourcePath: 'templateRef' },
    {
      assetUuid: 't1',
      assetType: 'PAGE_TEMPLATE',
      uid: 'article',
      edge: 'REFERENCE',
      referenceKind: 'OCTL_REF',
      sourcePath: 'channelTemplates.html',
    },
  ],
};

function entry(reason: ReasonView, outputPath = 'about.html'): PlanEntryView {
  return { assetUuid: 'p1', assetType: 'PAGE', uid: 'about', channel: 'html', outputPath, reason };
}

describe('build insight reasons', () => {
  it('labels every root kind, spelling out a fallback cause, and keeps unknown kinds readable', () => {
    expect(reasonBadge({ rootKind: 'FULL_BUILD', causeCount: 1, steps: [] })).toBe('Full build');
    expect(reasonBadge({ rootKind: 'INCREMENTAL_FALLBACK_FULL', fallbackCause: 'NO_COMPLETE_BUILD_FOR_TARGET' })).toBe(
      'Full build (no previous complete build for this target)',
    );
    expect(reasonBadge({ rootKind: 'ASSET_CHANGED' })).toBe('Changed');
    expect(reasonBadge({ rootKind: 'ASSET_DELETED' })).toBe('Deleted');
    expect(reasonBadge({ rootKind: 'EXPLICIT_SCOPE' })).toBe('Explicitly selected');
    expect(reasonBadge({ rootKind: 'NOT_IN_BASE_BUILD' })).toBe('Missing from the previous build');
    expect(reasonBadge({ rootKind: 'LOCALE_ADDED' })).toBe('LOCALE_ADDED');
    expect(reasonBadge(undefined)).toBe('Unknown');
  });

  it('labels edges from one lookup and falls back to the raw name of an unknown edge', () => {
    expect(edgeLabel({ edge: 'SECTION_TEMPLATE' })).toBe('places section');
    expect(edgeLabel({ edge: 'NAVIGATION' })).toBe('renders navigation of');
    expect(edgeLabel({ edge: 'RECORD_SET_MEMBERSHIP' })).toBe('reads record set containing');
    expect(edgeLabel({ edge: 'RECORD_SET_QUERY' })).toBe('reads record set with changed query');
    expect(edgeLabel({ edge: 'RECORD_TEMPLATE' })).toBe('renders through record template of');
    expect(edgeLabel({ edge: 'REFERENCE', referenceKind: 'MEDIA_REF' })).toBe('references media');
    expect(edgeLabel({ edge: 'REFERENCE', referenceKind: 'SOMETHING' })).toBe('references (SOMETHING)');
    expect(edgeLabel({ edge: 'LOCALE_VARIANT' })).toBe('LOCALE_VARIANT');
  });

  it('turns a multi-step chain into ordered lines ending at the root', () => {
    expect(chainLines(twoHops)).toEqual([
      { asset: 'page:about', edge: 'uses template', sourcePath: 'templateRef', uuid: 'p1', type: 'PAGE' },
      {
        asset: 'page_template:article',
        edge: 'links to',
        sourcePath: 'channelTemplates.html',
        uuid: 't1',
        type: 'PAGE_TEMPLATE',
      },
      { asset: 'media:hero', edge: null, sourcePath: null, uuid: 'm1', type: 'MEDIA' },
    ]);
    expect(chainLines(twoHops, true).at(-1)?.asset).toBe('this asset');
    expect(chainLines({ rootKind: 'FULL_BUILD', steps: [] })).toEqual([]);
  });

  it('reads a reason as one line of text', () => {
    expect(reasonText(entry(twoHops))).toBe('about.html ← page_template:article ← media:hero · changed r1842');
    expect(reasonText(entry({ ...twoHops, causeCount: 4 }))).toContain('+ 3 other changes');
    expect(
      reasonText(entry({ rootKind: 'ASSET_CHANGED', rootAsset: { uuid: 'p1', type: 'PAGE', uid: 'about' }, steps: [] })),
    ).toBe('about.html · changed');
    expect(reasonText(entry({ rootKind: 'FULL_BUILD', causeCount: 1, steps: [] }))).toBe('about.html · full build');
    // A release names its revision and the language of the output it rebuilds (M27.2.2).
    const released = { ...twoHops, rootKind: 'ASSET_RELEASED', rootRevision: 1902 };
    expect(reasonText({ ...entry(released, 'en/about.html'), locale: 'en' })).toBe(
      'en/about.html ← page_template:article ← media:hero · released in r1902, en',
    );
    expect(reasonText(entry({ ...released, rootKind: 'ASSET_UNPUBLISHED' }))).toBe(
      'about.html ← page_template:article ← media:hero · unpublished in r1902',
    );
    expect(reasonBadge({ rootKind: 'ASSET_RELEASED' })).toBe('Released');
    expect(reasonText(entry(twoHops), true)).toBe('about.html ← page_template:article ← this asset');
    expect(otherCausesLabel({ causeCount: 2 })).toBe('+ 1 other change');
    expect(otherCausesLabel({ causeCount: 1 })).toBe('');
  });
});

describe('build insight summaries', () => {
  const incremental: PlanSummaryView = {
    incremental: true,
    pageCount: 37,
    changedAssetCount: 2,
    processedMediaCount: 0,
    byRootKind: { ASSET_CHANGED: 30, NOT_IN_BASE_BUILD: 7 },
    byFirstEdge: { SECTION_TEMPLATE: 30, NONE: 7 },
    via: [{ edge: 'SECTION_TEMPLATE', assetType: 'SECTION_TEMPLATE', uid: 'teaser', count: 412 }],
  };

  it('writes the run history one-liner', () => {
    expect(planSummaryLine(incremental)).toBe('Incremental · 37 pages (via 2 changes)');
    expect(planSummaryLine({ incremental: false, pageCount: 5000 })).toBe('Full · 5,000 pages');
    expect(planSummaryLine({ incremental: false, pageCount: 1, scoped: true })).toBe('Scoped · 1 page');
    expect(planSummaryLine({ incremental: false, pageCount: 3, fallbackCause: 'BASE_BUILD_MISSING' })).toBe(
      'Full · 3 pages · fell back from incremental',
    );
    expect(planSummaryLine(null)).toBe('');
  });

  it('counts by root kind and first edge, largest first', () => {
    expect(rootKindRows(incremental).map((row) => `${row.label}: ${row.count}`)).toEqual([
      'Changed: 30',
      'Missing from the previous build: 7',
    ]);
    expect(firstEdgeRows(incremental.byFirstEdge).map((row) => row.label)).toEqual(['places section', 'No chain']);
    expect(viaRows(incremental)).toEqual(['412 via section_template:teaser']);
  });

  it('warns about a fallback to a full build', () => {
    expect(fallbackWarning('NO_COMPLETE_BUILD_FOR_TARGET', 'Site')).toBe(
      'Incremental requested — no previous complete build for target Site; this will be a full build.',
    );
    expect(fallbackWarning('BASE_BUILD_WITHOUT_QUALITY_FACTS', 'Site')).toBe(
      'Incremental requested — the previous build of target Site has no quality check results; this will be a full build.',
    );
    expect(fallbackWarning('QUALITY_RULES_CHANGED', undefined)).toBe(
      'Incremental requested — the quality rules changed since the previous build; this will be a full build.',
    );
  });

  it('heads the impact panel', () => {
    expect(impactHeadline({ entryCount: 24, pageCount: 12 })).toBe('Changing this rebuilds 12 pages (24 files)');
    expect(impactHeadline({ entryCount: 0, pageCount: 0 })).toBe('Changing this rebuilds nothing.');
  });

  it('keys a plan request so a changed form marks a preview stale', () => {
    const base = planRequestKey({ mode: 'INCREMENTAL', targetId: 1, channels: ['html', 'md'] });
    expect(planRequestKey({ mode: 'INCREMENTAL', targetId: 1, channels: ['md', 'html'] })).toBe(base);
    expect(planRequestKey({ mode: 'FULL', targetId: 1, channels: ['html', 'md'] })).not.toBe(base);
    expect(planRequestKey({ mode: 'INCREMENTAL', targetId: 2, channels: ['html', 'md'] })).not.toBe(base);
    expect(planRequestKey({ mode: 'INCREMENTAL', targetId: 1, channels: ['html'] })).not.toBe(base);
  });

  it('builds entry query parameters without empty filters', () => {
    expect(entryQueryParams({ page: 2, size: 25, rootKind: '', q: '  news ' }, { validate: true })).toEqual({
      page: '2',
      size: '25',
      q: 'news',
      validate: 'true',
    });
  });
});
