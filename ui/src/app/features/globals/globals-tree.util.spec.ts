import { describe, expect, it } from 'vitest';
import { buildIndex, childEntries, childNodes, idPath, isEmptyIndex, searchPaths, foldersOnly, type GlobalsNodeOptions } from './globals-tree.util';
import type { FolderView, GlobalSetSummaryView } from './globals.service';

const FOLDERS = [
  {
    uuid: 'root',
    uid: 'globals_root',
    displayName: 'All Globals',
    path: '/globals_root/',
    children: [
      { uuid: 'brand', uid: 'brand', displayName: 'Brand', path: '/globals_root/brand/', children: [{ uuid: 'deep', uid: 'deep', displayName: 'Deep', path: '/globals_root/brand/deep/', children: [] }] },
      { uuid: 'legal', uid: 'legal', displayName: 'Legal', path: '/globals_root/legal/', children: [] },
    ],
  },
] as unknown as FolderView[];

const SETS = [
  { uuid: 'set-site', uid: 'site', displayName: 'Site settings', folderPath: '/globals_root/brand/', revision: 4 },
  { uuid: 'set-shop', uid: 'shop', displayName: 'Shop settings', folderPath: '/globals_root/', revision: 2 },
  { uuid: 'set-deep', uid: 'banner', displayName: 'Banner', folderPath: '/globals_root/brand/deep/', revision: 1 },
] as unknown as GlobalSetSummaryView[];

const OPTIONS: GlobalsNodeOptions = {
  dev: false,
  locale: null,
  labels: { released: 'Released', changed: 'Changed', draft: 'Draft', scheduled: 'Scheduled', unpublished: 'Unpublished', deletion: 'Deletion pending' },
};

describe('globals tree index', () => {
  const index = buildIndex(FOLDERS, SETS);

  it('unwraps the fixed root: its folders and sets are the top level', () => {
    expect(childEntries(index, null).map((e) => e.name)).toEqual(['Brand', 'Legal', 'Shop settings']);
  });

  it('buckets sets into folders by their folder path, folders first, each by name', () => {
    expect(childEntries(index, 'brand').map((e) => `${e.kind}:${e.name}`)).toEqual(['folder:Deep', 'set:Site settings']);
    expect(index.parentOf.get('set-deep')).toBe('deep');
    expect(index.parentOf.get('set-shop')).toBeNull();
  });

  it('builds the id path to a nested set, and none for an unknown id', () => {
    expect(idPath(index, 'set-deep')).toEqual(['brand', 'deep', 'set-deep']);
    expect(idPath(index, 'nope')).toEqual([]);
  });

  it('finds sets and folders by name or UID, case-insensitively, with their paths', () => {
    expect(searchPaths(index, 'BANNER')).toEqual([['brand', 'deep', 'set-deep']]);
    expect(searchPaths(index, 'settings').map((p) => p.at(-1)).sort()).toEqual(['set-shop', 'set-site']);
    expect(searchPaths(index, '  ')).toEqual([]);
  });

  it('makes nodes: folders are droppable with children, sets are leaves; the UID shows in developer mode only', () => {
    const [brand] = childNodes(index, null, OPTIONS);
    expect(brand).toMatchObject({ id: 'brand', icon: 'folder', hasChildren: true, droppable: true, secondary: null });
    const [site] = childNodes(index, 'brand', { ...OPTIONS, dev: true }).filter((n) => n.id === 'set-site');
    expect(site).toMatchObject({ icon: 'tune', hasChildren: false, secondary: 'site' });
  });

  it('knows an empty store, and strips sets out for the move dialog', () => {
    expect(isEmptyIndex(buildIndex([{ ...FOLDERS[0], children: [] }], []))).toBe(true);
    expect(isEmptyIndex(index)).toBe(false);
    expect(foldersOnly(FOLDERS)[0].children?.map((c) => c.uuid)).toEqual(['brand', 'legal']);
  });
});
