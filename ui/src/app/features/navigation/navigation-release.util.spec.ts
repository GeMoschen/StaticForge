import { describe, expect, it } from 'vitest';
import { buildNavIndex } from './navigation-tree.util';
import { navReleaseChoices, withNavDescendants } from './navigation-release.util';
import type { NavTreeView } from './navigation.service';

const TREE: NavTreeView[] = [
  {
    uuid: 'root',
    uid: 'navigation_root',
    type: 'FOLDER',
    displayName: 'All Navigation',
    protectedFolder: true,
    children: [
      {
        uuid: 'f',
        uid: 'f',
        type: 'FOLDER',
        displayName: 'Company',
        release: { '': { status: 'CHANGED' } },
        children: [
          { uuid: 'a', uid: 'a', type: 'PAGE_REFERENCE', displayName: 'About', label: 'About us', release: { de: { status: 'NEW' }, en: { status: 'PUBLISHED' } }, children: [] },
          {
            uuid: 'g',
            uid: 'g',
            type: 'FOLDER',
            displayName: 'Careers',
            release: { '': { status: 'PUBLISHED' } },
            children: [{ uuid: 'j', uid: 'j', type: 'PAGE_REFERENCE', displayName: 'Jobs', label: 'Jobs', release: { '': { status: 'UNPUBLISHED' } }, children: [] }],
          },
        ],
      },
      { uuid: 'b', uid: 'b', type: 'PAGE_REFERENCE', displayName: 'Blog', label: 'Blog', release: { '': { status: 'PUBLISHED' } }, children: [] },
    ],
  },
] as unknown as NavTreeView[];

const index = buildNavIndex(TREE);
const entry = (uuid: string) => index.entries.get(uuid)!;

describe('navReleaseChoices', () => {
  it('collects a folder and everything inside it recursively, each entry once', () => {
    expect(withNavDescendants(index, [entry('f'), entry('a')]).map((e) => e.uuid)).toEqual(['f', 'a', 'g', 'j']);
  });

  it('offers what has something to release, all ticked, named after the entry', () => {
    const choices = navReleaseChoices(index, [entry('f')], null, (code) => code.toUpperCase());
    expect(choices.map((c) => [c.assetUuid, c.locale])).toEqual([
      ['f', ''],
      ['a', 'de'],
      ['j', ''],
    ]);
    // Careers is released already; Jobs (unpublished) can be released again.
    expect(choices.every((c) => c.checked)).toBe(true);
    expect(choices[1].label).toBe('About us · DE (DE) — New');
    expect(choices[0].assetType).toBe('FOLDER');
    expect(choices[1].assetType).toBe('PAGE_REFERENCE');
  });

  it('is empty when nothing is waiting', () => {
    expect(navReleaseChoices(index, [entry('b')], null, (code) => code)).toEqual([]);
  });
});
