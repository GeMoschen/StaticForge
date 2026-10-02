import { describe, expect, it, vi } from 'vitest';
import { buildSections, parseQuery, SEARCH_CAP, type PaletteGroup, type PaletteItem, type PaletteSources } from './palette-model';

const item = (id: string, group: PaletteGroup, label: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
  id,
  group,
  label,
  icon: 'x',
  run: vi.fn(),
  ...extra,
});

function sources(over: Partial<PaletteSources> = {}): PaletteSources {
  return {
    actions: [item('a-build', 'actions', 'Build now'), item('a-theme', 'actions', 'Switch to dark theme')],
    navigate: [item('n-pages', 'navigate', 'Pages'), item('n-media', 'navigate', 'Media'), item('n-pub', 'navigate', 'Publishing')],
    settings: [item('s-general', 'settings', 'General'), item('s-lang', 'settings', 'Languages')],
    projects: [item('p-lumen', 'projects', 'Lumen Coffee')],
    recent: [item('r-1', 'recent', 'Spring harvest')],
    favorites: [item('f-1', 'favorites', 'Espresso blends')],
    search: [],
    searchTotal: 0,
    ...over,
  };
}

const groups = (raw: string, s: PaletteSources) => buildSections(raw, s).map((section) => section.group);

describe('parseQuery', () => {
  it('reads the mode prefix and the rest', () => {
    expect(parseQuery('> build')).toEqual({ mode: 'actions', rest: 'build' });
    expect(parseQuery('#lang')).toEqual({ mode: 'settings', rest: 'lang' });
    expect(parseQuery('@')).toEqual({ mode: 'projects', rest: '' });
    expect(parseQuery('pages')).toEqual({ mode: 'all', rest: 'pages' });
  });
});

describe('buildSections', () => {
  it('shows actions, recent, favorites and the screens for an empty query', () => {
    expect(groups('', sources())).toEqual(['actions', 'recent', 'favorites', 'navigate']);
  });

  it('caps the actions of an empty query at five', () => {
    const many = Array.from({ length: 8 }, (_, i) => item(`a${i}`, 'actions', `Action ${i}`));
    const [actions] = buildSections('', sources({ actions: many }));
    expect(actions.rows).toHaveLength(5);
    expect(actions.more).toBe(3);
  });

  it('filters fuzzily across groups and drops the groups without a match', () => {
    const result = buildSections('pag', sources());
    expect(result.map((s) => s.group)).toEqual(['navigate']);
    expect(result[0].rows.map((r) => r.item.id)).toEqual(['n-pages']);
    expect(result[0].rows[0].match?.ranges).toEqual([[0, 3]]);
  });

  it('lists the settings pages under Navigate while typing', () => {
    const [navigate] = buildSections('lang', sources());
    expect(navigate.group).toBe('navigate');
    expect(navigate.rows.map((r) => r.item.id)).toEqual(['s-lang']);
  });

  it('narrows to one group with a prefix', () => {
    expect(groups('>', sources())).toEqual(['actions']);
    expect(groups('# gen', sources())).toEqual(['settings']);
    expect(groups('@lum', sources())).toEqual(['projects']);
    expect(buildSections('>', sources())[0].rows).toHaveLength(2);
  });

  it('adds the search results after the local groups, capped, with the rest counted', () => {
    const hits = Array.from({ length: 6 }, (_, i) => item(`h${i}`, 'search', `Harvest ${i}`, { matched: true }));
    const result = buildSections('harvest', sources({ search: hits, searchTotal: 12 }));
    const search = result.at(-1)!;
    expect(search.group).toBe('search');
    expect(search.rows).toHaveLength(SEARCH_CAP);
    expect(search.more).toBe(12 - SEARCH_CAP);
    expect(result.map((s) => s.group)).toContain('recent');
  });

  it('ranks the better match first within a group', () => {
    const result = buildSections('set', sources({ navigate: [item('n1', 'navigate', 'Site settings'), item('n2', 'navigate', 'Settings')] }));
    expect(result[0].rows.map((r) => r.item.id)).toEqual(['n2', 'n1']);
  });
});
