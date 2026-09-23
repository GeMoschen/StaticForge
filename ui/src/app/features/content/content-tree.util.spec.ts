import { describe, expect, it } from 'vitest';
import {
  contentTreeNodes,
  deleteSetQuestion,
  folderMoveTargets,
  INVALID_QUERY_WARNING,
  RECORD_SET_ICON,
  recordMoveTargets,
  relativeFolderPath,
  storeFolderPath,
} from './content-tree.util';
import type { FolderView, RecordSetSummaryView } from './content.service';

const ROOT: FolderView = {
  uuid: 'root',
  uid: 'content_root',
  displayName: 'All Content',
  path: '/content_root/',
  protectedFolder: true,
  type: 'FOLDER',
  children: [
    { uuid: 'set-leads', uid: 'leads', displayName: 'Leads', type: 'RECORD_SET', recordCount: 3 },
    {
      uuid: 'team',
      uid: 'team',
      displayName: 'Team',
      path: '/content_root/team/',
      type: 'FOLDER',
      children: [
        { uuid: 'set-staff', uid: 'staff', displayName: 'Staff', type: 'RECORD_SET', recordCount: 1 },
        { uuid: 'alumni', uid: 'alumni', displayName: 'Alumni', path: '/content_root/team/alumni/', type: 'FOLDER' },
      ],
    },
  ],
};

function summary(uuid: string, overrides: Partial<RecordSetSummaryView> = {}): RecordSetSummaryView {
  return { uuid, uid: uuid, displayName: uuid, recordCount: 0, queryValid: true, ...overrides };
}

describe('contentTreeNodes', () => {
  it('lists folders before the record sets beside them, sets as leaves with the set icon', () => {
    const nodes = contentTreeNodes(ROOT, new Map());

    expect(nodes.map((n) => n.displayName)).toEqual(['Team', 'Leads']);
    expect(nodes[0].kind).toBe('FOLDER');
    expect(nodes[0].children?.map((n) => n.displayName)).toEqual(['Alumni', 'Staff']);
    expect(nodes[1]).toMatchObject({ kind: 'LEAF', icon: RECORD_SET_ICON, uuid: 'set-leads' });
  });

  it("badges a set with its record count, preferring the set list's count", () => {
    const nodes = contentTreeNodes(ROOT, new Map([['set-leads', summary('set-leads', { recordCount: 7 })]]));

    expect(nodes[1].badge).toEqual({ text: '7', label: '7 records' });
    expect(nodes[0].children?.[1].badge).toEqual({ text: '1', label: '1 record' });
  });

  it('flags a set whose stored query is invalid, and only that one', () => {
    const sets = new Map([
      ['set-leads', summary('set-leads', { queryValid: false })],
      ['set-staff', summary('set-staff', { queryValid: true })],
    ]);

    const nodes = contentTreeNodes(ROOT, sets);

    expect(nodes[1].warning).toBe(INVALID_QUERY_WARNING);
    expect(nodes[0].children?.[1].warning).toBeUndefined();
  });

  it('is empty before the tree has loaded', () => {
    expect(contentTreeNodes(null, new Map())).toEqual([]);
  });
});

describe('folderMoveTargets', () => {
  it('offers the store root and every folder, never a record set', () => {
    const targets = folderMoveTargets(ROOT, 'team');

    expect(targets.map((t) => [t.uuid, t.label, t.depth])).toEqual([
      [null, 'All content', 0],
      ['team', 'Team', 1],
      ['alumni', 'Alumni', 2],
    ]);
  });

  it("marks the set's current folder, which the dialog lists but won't choose", () => {
    expect(folderMoveTargets(ROOT, 'team').filter((t) => t.current).map((t) => t.uuid)).toEqual(['team']);
    expect(folderMoveTargets(ROOT, 'root').filter((t) => t.current).map((t) => t.uuid)).toEqual([null]);
  });
});

describe('recordMoveTargets', () => {
  const sets: RecordSetSummaryView[] = [
    summary('a', { displayName: 'Leads', dataset: { uuid: 'team-ds' }, folderPath: '/' }),
    summary('b', { displayName: 'Staff', dataset: { uuid: 'team-ds' }, folderPath: '/team/' }),
    summary('c', { displayName: 'Products', dataset: { uuid: 'product-ds' }, folderPath: '/' }),
  ];

  it("offers only the sets of the record's own dataset", () => {
    const targets = recordMoveTargets(sets, 'team-ds', 'a');

    expect(targets.map((t) => t.label)).toEqual(['Leads', 'Staff']);
    expect(targets.map((t) => t.detail)).toEqual(['/', '/team/']);
  });

  it("marks the record's current set", () => {
    expect(recordMoveTargets(sets, 'team-ds', 'a').find((t) => t.current)?.uuid).toBe('a');
  });

  it('offers nothing without a dataset', () => {
    expect(recordMoveTargets(sets, undefined, 'a')).toEqual([]);
  });
});

describe('deleteSetQuestion', () => {
  it('names the records that go with a non-empty set', () => {
    expect(deleteSetQuestion('Leads', 3)).toContain('and its 3 records');
    expect(deleteSetQuestion('Leads', 1)).toContain('and its 1 record?');
  });

  it('asks plainly for an empty set', () => {
    expect(deleteSetQuestion('Leads', 0)).toBe('Delete the record set "Leads"? You can restore it from its history.');
  });
});

describe('relativeFolderPath', () => {
  it('strips the Content root', () => {
    expect(relativeFolderPath('/content_root/team/')).toBe('/team/');
    expect(relativeFolderPath('/content_root/')).toBe('/');
    expect(relativeFolderPath(undefined)).toBe('/');
  });
});

describe('storeFolderPath', () => {
  // The REST API sends a record's or set's `folderPath` store-relative already (`ContentStorePaths.relative`):
  // treating it as a stored path turned every set's folder into `/` (M25.6.2 journey).
  it('keeps the store-relative path the API sends', () => {
    expect(storeFolderPath('/team/leads/')).toBe('/team/leads/');
    expect(storeFolderPath('/')).toBe('/');
  });

  it('reads a missing path as the store root', () => {
    expect(storeFolderPath(undefined)).toBe('/');
    expect(storeFolderPath('')).toBe('/');
  });
});
