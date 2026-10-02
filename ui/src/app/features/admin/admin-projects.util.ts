import type { components } from '../../core/api/generated/schema.d.ts';

export type AdminProjectRow = components['schemas']['AdminProjectRow'];

/** A project key: starts with a lower case letter, then lower case letters, digits and dashes (2–32 characters). */
export const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export interface ProjectFilters {
  /** Matches the key, the name or the description, case-insensitively. */
  readonly q: string;
  /** Archived projects are listed too. */
  readonly archived: boolean;
}

export const NO_PROJECT_FILTERS: ProjectFilters = { q: '', archived: false };

/** The filters from the query parameters (`q`, `archived=1`). */
export function projectFiltersFromQuery(get: (name: string) => string | null): ProjectFilters {
  return { q: get('q') ?? '', archived: get('archived') === '1' };
}

/** The filters as query parameters; a filter that is off is `null`, so the URL only carries what is set. */
export function projectFiltersToQuery(filters: ProjectFilters): Record<string, string | null> {
  return { q: filters.q.trim() === '' ? null : filters.q, archived: filters.archived ? '1' : null };
}

export function projectFiltersActive(filters: ProjectFilters): boolean {
  return filters.q.trim() !== '' || filters.archived;
}

export function filterProjects(projects: readonly AdminProjectRow[], filters: ProjectFilters): AdminProjectRow[] {
  const q = filters.q.trim().toLowerCase();
  return projects.filter(
    (p) =>
      (filters.archived || !p.archived) &&
      (q === '' || [p.key, p.name, p.description].some((value) => (value ?? '').toLowerCase().includes(q))),
  );
}

/**
 * Why a new project key is wrong, as a message key under `admin.projects.dialog`; `null` while it is empty (nothing to
 * say yet) or fine.
 */
export function projectKeyProblem(key: string, taken: readonly string[]): 'keyLower' | 'keyFormat' | 'keyTaken' | null {
  if (key === '') {
    return null;
  }
  if (!PROJECT_KEY_PATTERN.test(key)) {
    return key !== key.toLowerCase() ? 'keyLower' : 'keyFormat';
  }
  return taken.includes(key) ? 'keyTaken' : null;
}
