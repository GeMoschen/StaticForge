import { describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SUMMARIES, TREE } from './templates-fixtures.testing';
import {
  buildTemplatesIndex,
  childEntries,
  childNodes,
  entryOfSummary,
  folderChain,
  folderSubtree,
  folderTrail,
  foldersOnly,
  idPath,
  searchPaths,
  templateUuidFromUrl,
  templatesInside,
} from './templates-tree.util';

type FolderView = components['schemas']['FolderView'];

describe('the Templates index', () => {
  const index = buildTemplatesIndex(TREE, SUMMARIES);

  it('unwraps the fixed "All Templates" root: the kind folders are the top level, in the order page, section, datasets', () => {
    expect(index.rootUuid).toBe('all');
    expect(childEntries(index, null).map((entry) => entry.name)).toEqual(['Page Templates', 'Section Templates', 'Datasets']);
    expect(index.entries.has('all')).toBe(false);
  });

  it('lists a folder\'s sub-folders first, then its templates by name, and puts each template in the folder of its path', () => {
    expect(childEntries(index, 'pt').map((entry) => [entry.kind, entry.name])).toEqual([
      ['folder', 'Blog'],
      ['page', 'Article'],
    ]);
    expect(childEntries(index, 'blog').map((entry) => entry.name)).toEqual(['Archive', 'Post']);
    expect(index.parentOf.get('post')).toBe('blog');
  });

  it('drops a template whose folder is not in the tree', () => {
    expect(index.entries.has('lost')).toBe(false);
  });

  it('carries what the folder table shows: kind, channels, used by count and change time; a folder has none', () => {
    const article = index.entries.get('article')!;
    expect(article).toMatchObject({ kind: 'page', channels: ['html', 'rss'], usedByCount: 3, changedAt: '2026-10-01T10:00:00Z', assetKind: 'PAGE_TEMPLATE' });
    expect(index.entries.get('teaser')).toMatchObject({ kind: 'section', assetKind: 'SECTION_TEMPLATE', channels: [] });
    expect(index.entries.get('products')).toMatchObject({ kind: 'dataset', assetKind: 'DATASET' });
    expect(index.entries.get('blog')).toMatchObject({ kind: 'folder', usedByCount: null, channels: [], assetKind: 'PAGE_TEMPLATE', protectedFolder: false });
    expect(index.entries.get('pt')!.protectedFolder).toBe(true);
    expect(index.entries.get('post')!.abstract).toBe(true);
  });

  it('knows the template and dataset inside a folder at any depth', () => {
    expect(templatesInside(index, 'pt').map((entry) => entry.uuid).sort()).toEqual(['article', 'post']);
    expect(templatesInside(index, 'st').map((entry) => entry.uuid)).toEqual(['teaser']);
  });

  it('answers the filter with the id path of every name or UID that matches', () => {
    expect(searchPaths(index, 'pos')).toEqual([['pt', 'blog', 'post']]);
    expect(searchPaths(index, '  ')).toEqual([]);
    expect(idPath(index, 'post')).toEqual(['pt', 'blog', 'post']);
    expect(idPath(index, 'gone')).toEqual([]);
  });

  it('makes tree nodes: icon of the kind, UID only in developer mode, folders droppable, the fixed folders not draggable', () => {
    const dev = childNodes(index, 'pt', { dev: true });
    expect(dev.map((node) => [node.label, node.icon, node.secondary ?? null, node.droppable])).toEqual([
      ['Blog', 'folder', null, true],
      ['Article', 'web', 'article', false],
    ]);
    expect(childNodes(index, 'pt', { dev: false }).find((node) => node.id === 'article')!.secondary).toBeNull();
    const top = childNodes(index, null, { dev: false });
    expect(top.every((node) => node.draggable === false)).toBe(true);
    expect(top[0].hasChildren).toBe(true);
    expect(top[1].hasChildren).toBe(true);
  });

  it('builds an entry from a summary alone (the open template\'s delete)', () => {
    expect(entryOfSummary({ uuid: 'x', uid: 'x', assetType: 'SECTION_TEMPLATE', displayName: 'X' })).toMatchObject({ kind: 'section', name: 'X', usedByCount: null, channels: [] });
  });
});

describe('Templates folder helpers', () => {
  it('finds the chain of folders down to a folder, and the breadcrumb above it without the wrapper', () => {
    const chain = folderChain(TREE, 'blog');
    expect(chain.map((folder) => folder.uuid)).toEqual(['all', 'pt', 'blog']);
    expect(folderTrail(chain.slice(0, -1), 'acme', 'all')).toEqual([
      { id: 'pt', label: 'Page Templates', link: ['/p', 'acme', 'templates'], queryParams: { folder: 'pt' } },
    ]);
    expect(folderChain(TREE, 'gone')).toEqual([]);
  });

  it('lists a folder\'s subtree for the move dialog and keeps only folders', () => {
    expect(folderSubtree(TREE, 'pt')).toEqual(['pt', 'blog', 'archive']);
    expect(folderSubtree(TREE, 'gone')).toEqual([]);
    const typed: FolderView[] = [{ uuid: 'a', type: 'FOLDER', children: [{ uuid: 'b', type: 'PAGE_TEMPLATE' }] }];
    expect(foldersOnly(typed)).toEqual([{ uuid: 'a', type: 'FOLDER', children: [] }]);
  });

  it('reads the open template from the URL', () => {
    expect(templateUuidFromUrl('/p/acme/templates/0b9c3a8e?x=1')).toBe('0b9c3a8e');
    expect(templateUuidFromUrl('/p/acme/templates?folder=pt')).toBeNull();
    expect(templateUuidFromUrl('/p/acme/pages/abc')).toBeNull();
  });
});
