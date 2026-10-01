import type { components } from '../../core/api/generated/schema.d.ts';

export type ProjectSummary = components['schemas']['ProjectSummary'];

export interface SwitcherGroup {
  id: 'favorites' | 'recent' | 'all' | 'results';
  projects: ProjectSummary[];
}

function matches(project: ProjectSummary, query: string): boolean {
  return (project.name ?? '').toLowerCase().includes(query) || (project.key ?? '').toLowerCase().includes(query);
}

const byName = (a: ProjectSummary, b: ProjectSummary): number =>
  (a.name ?? a.key ?? '').localeCompare(b.name ?? b.key ?? '', undefined, { sensitivity: 'base' });

/**
 * The project switcher's lists. Without a query: favorites, recent (not already favorites) and all projects by name.
 * With a query: one flat list of the matches — a name or key that contains it, case-insensitive. Keys the user starred or
 * opened that they can no longer reach are left out. Pure.
 */
export function switcherGroups(
  projects: readonly ProjectSummary[],
  favorites: readonly string[],
  recents: readonly string[],
  query: string,
): SwitcherGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle !== '') {
    return [{ id: 'results', projects: projects.filter((p) => matches(p, needle)).sort(byName) }];
  }
  const byKey = new Map(projects.map((project) => [project.key, project]));
  const pick = (keys: readonly string[], skip: ReadonlySet<string> = new Set()): ProjectSummary[] =>
    keys.filter((key) => !skip.has(key)).flatMap((key) => byKey.get(key) ?? []);
  const favorite = pick(favorites);
  const recent = pick(recents, new Set(favorites));
  const groups: SwitcherGroup[] = [];
  if (favorite.length > 0) {
    groups.push({ id: 'favorites', projects: favorite });
  }
  if (recent.length > 0) {
    groups.push({ id: 'recent', projects: recent });
  }
  groups.push({ id: 'all', projects: [...projects].sort(byName) });
  return groups;
}

/** The favorites after starring or unstarring `key`. */
export function toggleFavorite(favorites: readonly string[], key: string): string[] {
  return favorites.includes(key) ? favorites.filter((existing) => existing !== key) : [...favorites, key];
}
