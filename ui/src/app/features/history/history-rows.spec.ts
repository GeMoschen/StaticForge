import { describe, expect, it } from 'vitest';
import { assetNamesOf, summaryOf, toHistoryRow } from './history-rows';

const TEXT: Record<string, string> = {
  'verb.UPDATE': 'Changed',
  'verb.RELEASE': 'Released',
  'verb.DELETE': 'Deleted',
  'summary.one': '{verb} {name}',
  'summary.many': '{verb} {name} and {count} more',
};
const t = (key: string, params: Record<string, unknown> = {}) =>
  (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));

const revision = {
  revisionId: 90,
  createdAt: '2026-10-02T10:00:00Z',
  createdBy: 4,
  createdByName: 'Anna Berger',
  changeType: 'UPDATE',
  summary: {
    assets: [
      { uuid: '11111111-2222-3333-4444-555555555555', uid: 'spring_harvest', type: 'PAGE', name: 'Spring harvest arrives', action: 'UPDATE', locales: ['de', 'en'] },
      { uuid: '99999999-2222-3333-4444-555555555555', uid: 'single_origins', type: 'PAGE', action: 'UPDATE', locales: ['en'] },
      { uid: 'footer', type: 'GLOBAL_SET', action: 'UPDATE' },
    ],
  },
};

describe('toHistoryRow', () => {
  it('names the author and the items by what people know them as', () => {
    const row = toHistoryRow(revision, 'Unknown user');
    expect(row).toMatchObject({ id: 90, byId: 4, byName: 'Anna Berger', kind: 'edit', changeType: 'UPDATE', compacted: false });
    expect(row.at).toBe(Date.parse('2026-10-02T10:00:00Z'));
    expect(row.assets.map((a) => a.name)).toEqual(['Spring harvest arrives', 'single_origins', 'footer']);
    expect(row.assets[0].action).toBe('update');
  });

  it('lists the touched languages once, upper case, in first-seen order', () => {
    expect(toHistoryRow(revision, '?').locales).toEqual(['DE', 'EN']);
  });

  it('never shows a raw UUID: a nameless, uid-less item shows its short id, and a removed author is "unknown"', () => {
    const row = toHistoryRow({ revisionId: 1, createdBy: 9, summary: { assets: [{ uuid: 'abcdef12-0000-0000-0000-000000000000' }] } }, 'Unknown user');
    expect(row.byName).toBe('Unknown user');
    expect(row.assets[0].name).toBe('abcdef12');
  });

  it('reads a revision without a summary, and the compacted flag', () => {
    const row = toHistoryRow({ revisionId: 2, changeType: 'RESTORE', compacted: true }, '?');
    expect(row.assets).toEqual([]);
    expect(row.kind).toBe('restore');
    expect(row.compacted).toBe(true);
  });
});

describe('summaryOf', () => {
  it('says what was done to one item, or to the first and how many more', () => {
    const row = toHistoryRow(revision, '?');
    expect(summaryOf({ ...row, assets: [row.assets[0]] }, t)).toBe('Changed Spring harvest arrives');
    expect(summaryOf(row, t)).toBe('Changed Spring harvest arrives and 2 more');
    expect(summaryOf(toHistoryRow({ ...revision, changeType: 'RELEASE' }, '?'), t)).toContain('Released');
  });

  it('falls back to the comment, then to the verb, when no item is named; an unknown type reads as a change', () => {
    expect(summaryOf(toHistoryRow({ revisionId: 3, changeType: 'DELETE', comment: 'Project restore to 71' }, '?'), t)).toBe('Project restore to 71');
    expect(summaryOf(toHistoryRow({ revisionId: 3, changeType: 'DELETE' }, '?'), t)).toBe('Deleted');
    expect(summaryOf(toHistoryRow({ revisionId: 3, changeType: 'FUTURE' }, '?'), t)).toBe('Changed');
  });
});

describe('assetNamesOf', () => {
  it('gives the first two names and how many more', () => {
    expect(assetNamesOf(toHistoryRow(revision, '?'))).toEqual({ names: 'Spring harvest arrives, single_origins', more: 1 });
    expect(assetNamesOf(toHistoryRow({ revisionId: 1 }, '?'))).toEqual({ names: '', more: 0 });
  });
});
