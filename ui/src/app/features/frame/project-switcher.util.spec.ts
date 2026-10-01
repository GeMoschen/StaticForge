import { describe, expect, it } from 'vitest';
import { switcherGroups, toggleFavorite, type ProjectSummary } from './project-switcher.util';

const projects: ProjectSummary[] = [
  { key: 'zeta', name: 'Zeta Shop' },
  { key: 'acme', name: 'Acme Website' },
  { key: 'blog', name: 'Company Blog', archived: true },
  { key: 'docs', name: 'Docs' },
];

const keys = (group: { projects: ProjectSummary[] } | undefined) => group?.projects.map((p) => p.key);

describe('switcherGroups', () => {
  it('lists all projects by name when there is nothing starred or recent', () => {
    const groups = switcherGroups(projects, [], [], '');
    expect(groups.map((g) => g.id)).toEqual(['all']);
    expect(keys(groups[0])).toEqual(['acme', 'blog', 'docs', 'zeta']);
  });

  it('puts favorites first in their own order, then recents without the favorites, then all', () => {
    const groups = switcherGroups(projects, ['zeta', 'acme'], ['docs', 'acme', 'blog'], '');
    expect(groups.map((g) => g.id)).toEqual(['favorites', 'recent', 'all']);
    expect(keys(groups[0])).toEqual(['zeta', 'acme']);
    expect(keys(groups[1])).toEqual(['docs', 'blog']);
    expect(groups[2].projects).toHaveLength(4);
  });

  it('leaves out starred or recent keys the user can no longer reach', () => {
    const groups = switcherGroups(projects, ['gone'], ['gone', 'docs'], '');
    expect(groups.map((g) => g.id)).toEqual(['recent', 'all']);
    expect(keys(groups[0])).toEqual(['docs']);
  });

  it('searches names and keys, case-insensitively, as one flat list', () => {
    expect(keys(switcherGroups(projects, ['zeta'], [], 'COMP')[0])).toEqual(['blog']);
    const byKey = switcherGroups(projects, [], [], ' ac ');
    expect(byKey.map((g) => g.id)).toEqual(['results']);
    expect(keys(byKey[0])).toEqual(['acme']);
    expect(switcherGroups(projects, [], [], 'nothing')[0].projects).toEqual([]);
  });
});

describe('toggleFavorite', () => {
  it('adds a project at the end and removes it again', () => {
    expect(toggleFavorite(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleFavorite(['a', 'b'], 'a')).toEqual(['b']);
  });
});
