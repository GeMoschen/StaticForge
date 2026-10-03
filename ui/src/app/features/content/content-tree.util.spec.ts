import { describe, expect, it } from 'vitest';
import type { TreeStatusLabels } from '../pages/pages-tree.util';
import {
  type ContentNodeOptions,
  EMPTY_INDEX,
  RECORD_SET_ICON,
  buildIndex,
  childEntries,
  childNodes,
  folderChain,
  folderTrail,
  folderMoveTargets,
  foldersOnly,
  idPath,
  isChildRoute,
  isEmptyIndex,
  recordMoveTargets,
  relativeFolderPath,
  searchPaths,
  setUuidFromUrl,
  storeFolderPath,
} from './content-tree.util';
import type { FolderView, RecordSetSummaryView } from './content.service';

/** The folder tree as the REST API sends it: the fixed wrapper with folders (stored paths) and record set leaves. */
const TREE: FolderView[] = [
  {
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
          { uuid: 'alumni', uid: 'alumni', displayName: 'Alumni', path: '/content_root/team/alumni/', type: 'FOLDER', children: [] },
        ],
      },
    ],
  },
];

/** The record set list as the API sends it: `folderPath` is store-relative. */
function summary(uuid: string, overrides: Partial<RecordSetSummaryView> = {}): RecordSetSummaryView {
  return { uuid, uid: uuid, displayName: uuid, recordCount: 0, queryValid: true, folderPath: '/', ...overrides };
}

const SETS: RecordSetSummaryView[] = [
  summary('set-leads', { displayName: 'Leads', dataset: { uuid: 'ds-team', displayName: 'Team members' }, recordCount: 7, changedAt: '2026-10-01T09:00:00Z', revision: 4 }),
  summary('set-staff', { displayName: 'Staff', dataset: { uuid: 'ds-team', displayName: 'Team members' }, folderPath: '/team/', queryValid: false }),
];

const LABELS: TreeStatusLabels = {
  released: 'Released',
  changed: 'Changed',
  draft: 'Draft',
  scheduled: 'Scheduled',
  unpublished: 'Unpublished',
  deletion: 'Deletion pending',
};
const OPTIONS: ContentNodeOptions = { dev: false, locale: null, labels: LABELS, invalidQuery: 'Query invalid' };

describe('buildIndex', () => {
  const index = buildIndex(TREE, SETS);

  it('indexes folders and record sets below the wrapper, whose children have the parent null', () => {
    expect([...index.entries.keys()].sort()).toEqual(['alumni', 'set-leads', 'set-staff', 'team']);
    expect(index.rootUuid).toBe('root');
    expect(index.parentOf.get('team')).toBeNull();
    expect(index.parentOf.get('set-staff')).toBe('team');
  });

  it("takes a set's dataset, count, validity and change time from the set list, not the tree", () => {
    expect(index.entries.get('set-leads')).toMatchObject({
      kind: 'set',
      name: 'Leads',
      datasetUuid: 'ds-team',
      datasetName: 'Team members',
      recordCount: 7,
      queryValid: true,
      changedAt: '2026-10-01T09:00:00Z',
      revision: 4,
    });
    expect(index.entries.get('set-staff')?.queryValid).toBe(false);
  });

  it("keeps the stored path of the folder a set lives in (the favorite's location), and a folder's own", () => {
    expect(index.entries.get('set-staff')?.path).toBe('/content_root/team/');
    expect(index.entries.get('set-leads')?.path).toBe('/content_root/');
    expect(index.entries.get('team')?.path).toBe('/content_root/team/');
  });

  it('still lists a set the set list lacks, with the tree’s own count', () => {
    const entry = buildIndex(TREE, []).entries.get('set-leads');
    expect(entry).toMatchObject({ recordCount: 3, queryValid: true, datasetUuid: null });
  });

  it('is empty without folders and sets', () => {
    expect(isEmptyIndex(EMPTY_INDEX)).toBe(true);
    expect(isEmptyIndex(buildIndex([{ ...TREE[0], children: [] }], []))).toBe(true);
    expect(isEmptyIndex(index)).toBe(false);
  });
});

describe('childEntries', () => {
  const index = buildIndex(TREE, SETS);

  it('lists the folders before the sets, each by name', () => {
    expect(childEntries(index, null).map((e) => e.name)).toEqual(['Team', 'Leads']);
    expect(childEntries(index, 'team').map((e) => e.name)).toEqual(['Alumni', 'Staff']);
  });

  it('is empty for an unknown folder', () => {
    expect(childEntries(index, 'nope')).toEqual([]);
  });
});

describe('childNodes', () => {
  const index = buildIndex(TREE, SETS);

  it('shows a set as a leaf with its record count and the set icon, a folder as a droppable branch', () => {
    const [team, leads] = childNodes(index, null, OPTIONS);

    expect(team).toMatchObject({ id: 'team', icon: 'folder', hasChildren: true, droppable: true });
    expect(leads).toMatchObject({ id: 'set-leads', icon: RECORD_SET_ICON, hasChildren: false, droppable: false });
    expect(leads.badges).toEqual([{ kind: 'badge', label: '7' }]);
  });

  it('flags a set whose stored query is invalid, and only that one', () => {
    const [alumni, staff] = childNodes(index, 'team', OPTIONS);

    expect(staff.badges).toContainEqual({ kind: 'status', tone: 'warning', icon: 'warning', label: 'Query invalid' });
    expect(alumni.badges).toEqual([]);
    expect(childNodes(index, null, OPTIONS)[1].badges?.some((b) => b.label === 'Query invalid')).toBe(false);
  });

  it('badges what is not released with text, and nothing on a released set', () => {
    const changed = buildIndex(TREE, [{ ...SETS[0], release: { '': { status: 'CHANGED' } } as never }]);
    const released = buildIndex(TREE, [{ ...SETS[0], release: { '': { status: 'PUBLISHED' } } as never }]);

    expect(childNodes(changed, null, OPTIONS)[1].badges?.map((b) => b.label)).toEqual(['7', 'Changed']);
    expect(childNodes(released, null, OPTIONS)[1].badges?.map((b) => b.label)).toEqual(['7']);
  });

  it('shows the UID beside the name only in developer mode', () => {
    expect(childNodes(index, null, OPTIONS)[1].secondary).toBeNull();
    expect(childNodes(index, null, { ...OPTIONS, dev: true })[1].secondary).toBe('leads');
  });
});

describe('idPath and searchPaths', () => {
  const index = buildIndex(TREE, SETS);

  it('walks from the top down to the item', () => {
    expect(idPath(index, 'set-staff')).toEqual(['team', 'set-staff']);
    expect(idPath(index, 'nope')).toEqual([]);
  });

  it('finds folders and sets by name or UID, anywhere in the store, with the way to them', () => {
    expect(searchPaths(index, 'STAFF')).toEqual([['team', 'set-staff']]);
    expect(searchPaths(index, 'al')).toEqual(expect.arrayContaining([['team', 'alumni']]));
    expect(searchPaths(index, '  ')).toEqual([]);
  });
});

describe('the URL', () => {
  it('reads the open record set', () => {
    expect(setUuidFromUrl('/p/acme/content/sets/set-1?panel=history')).toBe('set-1');
    expect(setUuidFromUrl('/p/acme/content?folder=team')).toBeNull();
    expect(setUuidFromUrl('/p/acme/content/records/rec-1')).toBeNull();
  });

  it('tells the child screens (a set, a record) from the folder view', () => {
    expect(isChildRoute('/p/acme/content/sets/set-1')).toBe(true);
    expect(isChildRoute('/p/acme/content/records/rec-1?x=1')).toBe(true);
    expect(isChildRoute('/p/acme/content')).toBe(false);
    expect(isChildRoute('/p/acme/content?folder=team')).toBe(false);
    expect(isChildRoute('/p/acme/pages/sets/x')).toBe(false);
  });
});

describe('folders', () => {
  it('finds the chain of folders down to one, skipping record sets', () => {
    expect(folderChain(TREE, 'alumni').map((f) => f.uuid)).toEqual(['root', 'team', 'alumni']);
    expect(folderChain(TREE, 'set-staff')).toEqual([]);
    expect(folderChain(TREE, 'nope')).toEqual([]);
  });

  it('makes a breadcrumb of the folders above, without the wrapper', () => {
    const chain = folderChain(TREE, 'alumni');

    expect(folderTrail(chain.slice(0, -1), 'acme', 'root')).toEqual([
      { id: 'team', label: 'Team', link: ['/p', 'acme', 'content'], queryParams: { folder: 'team' } },
    ]);
  });

  it('drops the record sets from the tree a move picks a folder in', () => {
    const folders = foldersOnly(TREE);

    expect(folders[0].children?.map((c) => c.uuid)).toEqual(['team']);
    expect(folders[0].children?.[0].children?.map((c) => c.uuid)).toEqual(['alumni']);
    expect(TREE[0].children).toHaveLength(2);
  });
});

describe('folderMoveTargets', () => {
  it('offers the store root and every folder, never a record set', () => {
    const targets = folderMoveTargets(TREE[0], 'team');

    expect(targets.map((t) => [t.uuid, t.label, t.depth])).toEqual([
      [null, 'All content', 0],
      ['team', 'Team', 1],
      ['alumni', 'Alumni', 2],
    ]);
  });

  it("marks the set's current folder, which the dialog lists but won't choose", () => {
    expect(folderMoveTargets(TREE[0], 'team').filter((t) => t.current).map((t) => t.uuid)).toEqual(['team']);
    expect(folderMoveTargets(TREE[0], 'root').filter((t) => t.current).map((t) => t.uuid)).toEqual([null]);
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
