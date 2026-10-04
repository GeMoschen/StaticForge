import { describe, expect, it } from 'vitest';
import type { TreeStatusLabels } from '../pages/pages-tree.util';
import {
  buildNavIndex,
  entryFolderPath,
  entryUrl,
  folderRevision,
  navChildren,
  navFolderTree,
  navIdPath,
  navNodes,
  navSearchPaths,
  navSecondary,
  navTrail,
  orderWith,
} from './navigation-tree.util';
import type { NavTreeView } from './navigation.service';

const LABELS: TreeStatusLabels = {
  released: 'Released',
  changed: 'Changed',
  draft: 'Draft',
  scheduled: 'Scheduled',
  unpublished: 'Unpublished',
  deletion: 'Deletion pending',
};

/** The tree as the API returns it: the "All Navigation" wrapper, its children in the stored menu order. */
const FOREST: NavTreeView[] = [
  {
    uuid: 'root',
    uid: 'navigation_root',
    type: 'FOLDER',
    displayName: 'All Navigation',
    revision: 9,
    children: [
      { uuid: 'n-home', uid: 'home', type: 'PAGE_REFERENCE', displayName: 'Home link', label: 'Home', resolvedPageUuid: 'p-home', resolvedPageName: 'Welcome', revision: 2, children: [] },
      {
        uuid: 'n-company',
        uid: 'company',
        type: 'FOLDER',
        displayName: 'Company',
        label: 'Company',
        resolvedPageUuid: 'p-about',
        resolvedPageName: 'About us',
        revision: 4,
        children: [
          { uuid: 'n-about', uid: 'about', type: 'PAGE_REFERENCE', displayName: 'About', label: 'About us', resolvedPageUuid: 'p-about', resolvedPageName: 'About us', revision: 1, children: [] },
          { uuid: 'n-team', uid: 'team', type: 'PAGE_REFERENCE', displayName: 'Team', label: 'Team', resolvedPageUuid: null as never, revision: 1, children: [] },
        ],
      },
    ],
  },
];
const URLS = new Map([
  ['p-home', '/'],
  ['p-about', '/about-us/'],
]);

describe('the navigation index', () => {
  const index = buildNavIndex(FOREST);

  it('treats the wrapper as the top level and keeps the server order of the children', () => {
    expect(index.rootUuid).toBe('root');
    expect(index.rootRevision).toBe(9);
    expect(navChildren(index, null).map((e) => e.uuid)).toEqual(['n-home', 'n-company']);
    expect(navChildren(index, 'n-company').map((e) => e.uuid)).toEqual(['n-about', 'n-team']);
    expect(index.parentOf.get('n-about')).toBe('n-company');
    expect(index.parentOf.get('n-home')).toBeNull();
  });

  it('shows an item by its label and a folder by its name', () => {
    expect(index.entries.get('n-home')).toMatchObject({ kind: 'item', label: 'Home', targetName: 'Welcome', targetUuid: 'p-home' });
    expect(index.entries.get('n-company')).toMatchObject({ kind: 'folder', label: 'Company' });
  });

  it('is empty without a forest', () => {
    expect(buildNavIndex([]).entries.size).toBe(0);
  });

  it('knows which revision a reorder of a folder (or of the top level) is written against', () => {
    expect(folderRevision(index, null)).toBe(9);
    expect(folderRevision(index, 'n-company')).toBe(4);
  });
});

describe('where an entry leads', () => {
  const index = buildNavIndex(FOREST);

  it('says "→ public URL" after the label', () => {
    expect(navSecondary(index.entries.get('n-about')!, { dev: false, urls: URLS })).toBe('→ /about-us/');
    expect(entryUrl(index.entries.get('n-about')!, URLS)).toBe('/about-us/');
  });

  it('names the target page while no URL is registered yet, and nothing for an item without a target', () => {
    expect(navSecondary(index.entries.get('n-about')!, { dev: false, urls: new Map() })).toBe('→ About us');
    expect(navSecondary(index.entries.get('n-team')!, { dev: false, urls: URLS })).toBeNull();
  });

  it('adds the UID in developer mode', () => {
    expect(navSecondary(index.entries.get('n-about')!, { dev: true, urls: URLS })).toBe('→ /about-us/  ·  about');
    expect(navSecondary(index.entries.get('n-team')!, { dev: true, urls: URLS })).toBe('team');
  });

  it('a folder leads where its entry page leads', () => {
    expect(entryUrl(index.entries.get('n-company')!, URLS)).toBe('/about-us/');
  });
});

describe('tree nodes', () => {
  const index = buildNavIndex(FOREST);
  const options = { dev: false, locale: null, labels: LABELS, urls: URLS };

  it('are folders (droppable, expandable only with children) and items (link icon), in menu order', () => {
    const nodes = navNodes(index, null, options);
    expect(nodes.map((n) => n.id)).toEqual(['n-home', 'n-company']);
    expect(nodes[0]).toMatchObject({ label: 'Home', icon: 'link', secondary: '→ /', hasChildren: false, droppable: false });
    expect(nodes[1]).toMatchObject({ label: 'Company', icon: 'folder', hasChildren: true, droppable: true });
  });

  it('badge what is not released', () => {
    const changed = buildNavIndex([{ ...FOREST[0], children: [{ ...FOREST[0].children![0], release: { '': { status: 'CHANGED' } } as never }] }]);
    expect(navNodes(changed, null, options)[0].badges?.map((b) => b.label)).toEqual(['Changed']);
    expect(navNodes(index, null, options)[0].badges).toEqual([]);
  });
});

describe('finding and walking entries', () => {
  const index = buildNavIndex(FOREST);

  it('gives the path from the top to an entry', () => {
    expect(navIdPath(index, 'n-about')).toEqual(['n-company', 'n-about']);
    expect(navIdPath(index, 'unknown')).toEqual([]);
  });

  it('filters by label, target page, public URL and UID', () => {
    expect(navSearchPaths(index, 'about-us', URLS)).toEqual([['n-company'], ['n-company', 'n-about']]);
    expect(navSearchPaths(index, 'welcome', URLS)).toEqual([['n-home']]);
    expect(navSearchPaths(index, 'team', URLS)).toEqual([['n-company', 'n-team']]);
    expect(navSearchPaths(index, '  ', URLS)).toEqual([]);
  });

  it('builds the breadcrumb of folders above an entry as links that keep the selection in the URL', () => {
    expect(navTrail(index, 'n-about', 'acme')).toEqual([
      { id: 'n-company', label: 'Company', link: ['/p', 'acme', 'navigation'], queryParams: { asset: 'n-company' } },
    ]);
    expect(navTrail(index, 'n-home', 'acme')).toEqual([]);
  });

  it('builds the stored folder path from the UIDs (a folder\'s own, an item\'s folder)', () => {
    expect(entryFolderPath(index, index.entries.get('n-company')!)).toBe('/navigation_root/company/');
    expect(entryFolderPath(index, index.entries.get('n-about')!)).toBe('/navigation_root/company/');
    expect(entryFolderPath(index, index.entries.get('n-home')!)).toBe('/navigation_root/');
  });

  it('offers the folders only (the wrapper is not part of it) for "Move to…"', () => {
    expect(navFolderTree(FOREST)).toEqual([
      { uuid: 'root', uid: 'navigation_root', displayName: 'All Navigation', children: [{ uuid: 'n-company', uid: 'company', displayName: 'Company', children: [] }] },
    ]);
  });
});

describe('the order a reorder stores', () => {
  const index = buildNavIndex(FOREST);

  it('puts the entry at the position among the folder\'s children (counted after it left its place)', () => {
    expect(orderWith(index, null, 'n-company', 0)).toEqual(['n-company', 'n-home']);
    expect(orderWith(index, null, 'n-home', 1)).toEqual(['n-company', 'n-home']);
    expect(orderWith(index, 'n-company', 'n-team', 0)).toEqual(['n-team', 'n-about']);
  });

  it('adds an entry that comes from another folder', () => {
    expect(orderWith(index, 'n-company', 'n-home', 1)).toEqual(['n-about', 'n-home', 'n-team']);
  });

  it('clamps a position past the end', () => {
    expect(orderWith(index, null, 'n-home', 99)).toEqual(['n-company', 'n-home']);
    expect(orderWith(index, null, 'n-home', -3)).toEqual(['n-home', 'n-company']);
  });
});

describe('Visible in menu, the wrapper and the entry page', () => {
  const forest: NavTreeView[] = [
    {
      uuid: 'root',
      uid: 'navigation_root',
      type: 'FOLDER',
      displayName: 'All Navigation',
      protectedFolder: true,
      startNode: { kind: 'PAGE_REFERENCE', assetUuid: 'n-home' },
      revision: 9,
      children: [
        { uuid: 'n-home', uid: 'home', type: 'PAGE_REFERENCE', displayName: 'Home', label: 'Home', revision: 2, children: [] },
        { uuid: 'n-old', uid: 'old', type: 'PAGE_REFERENCE', displayName: 'Old', label: 'Old', visibleInMenu: false, revision: 2, children: [] },
        {
          uuid: 'n-co',
          uid: 'co',
          type: 'FOLDER',
          displayName: 'Co',
          visibleInMenu: false,
          startNode: { kind: 'FOLDER', assetUuid: 'n-sub' },
          revision: 3,
          children: [{ uuid: 'n-sub', uid: 'sub', type: 'FOLDER', displayName: 'Sub', visibleInMenu: true, revision: 1, children: [] }],
        },
      ],
    },
  ];
  const index = buildNavIndex(forest);
  const options = { dev: false, locale: null, labels: LABELS, urls: new Map<string, string>(), hiddenLabel: 'Hidden' };

  it('is on unless the server says false (an absent flag is visible)', () => {
    expect(index.entries.get('n-home')!.visible).toBe(true);
    expect(index.entries.get('n-old')!.visible).toBe(false);
    expect(index.entries.get('n-co')!.visible).toBe(false);
    expect(index.entries.get('n-sub')!.visible).toBe(true);
  });

  it('mutes a hidden node in the tree and marks it with an eye-off badge, whatever its release status', () => {
    const [home, old, folder] = navNodes(index, null, options);
    expect(home).toMatchObject({ muted: false, badges: [] });
    expect(old.muted).toBe(true);
    expect(old.badges).toEqual([{ label: 'Hidden', tone: 'neutral', icon: 'visibility_off' }]);
    expect(folder.muted).toBe(true);
    // Release status first, then Hidden.
    const changed = buildNavIndex([{ ...forest[0], children: [{ ...forest[0].children![1], release: { '': { status: 'CHANGED' } } as never }] }]);
    expect(navNodes(changed, null, options)[0].badges?.map((b) => b.label)).toEqual(['Changed', 'Hidden']);
  });

  it('keeps hidden entries in their place in the menu order and in the filter', () => {
    expect(navChildren(index, null).map((e) => e.uuid)).toEqual(['n-home', 'n-old', 'n-co']);
    expect(navSearchPaths(index, 'old', new Map())).toEqual([['n-old']]);
  });

  it('knows the entry page of a folder (a direct child, item or folder) and none for items', () => {
    expect(index.entries.get('n-co')!.entry).toEqual({ kind: 'FOLDER', uuid: 'n-sub' });
    expect(index.entries.get('n-home')!.entry).toBeNull();
    expect(index.entries.get('n-sub')!.entry).toBeNull();
  });

  it('keeps the wrapper as a protected folder entry with its own entry page, and lists the top level as its children', () => {
    expect(index.root).toMatchObject({ kind: 'folder', uuid: 'root', protectedFolder: true, revision: 9, entry: { kind: 'PAGE_REFERENCE', uuid: 'n-home' } });
    expect(index.entries.has('root')).toBe(false);
    expect(navChildren(index, 'root').map((e) => e.uuid)).toEqual(['n-home', 'n-old', 'n-co']);
    expect(navChildren(index, null)).toEqual(navChildren(index, 'root'));
    expect(buildNavIndex([]).root).toBeNull();
  });
});
