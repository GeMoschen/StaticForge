import { describe, expect, it } from 'vitest';
import {
  AdminProjectRow,
  NO_PROJECT_FILTERS,
  filterProjects,
  projectFiltersActive,
  projectFiltersFromQuery,
  projectFiltersToQuery,
  projectKeyProblem,
} from './admin-projects.util';

const projects: AdminProjectRow[] = [
  { key: 'acme', name: 'ACME Website', description: 'Main site', archived: false },
  { key: 'old', name: 'Old Campaign', archived: true },
];

describe('project filters', () => {
  it('hides archived projects unless asked, and matches key, name and description case-insensitively', () => {
    expect(filterProjects(projects, NO_PROJECT_FILTERS).map((p) => p.key)).toEqual(['acme']);
    expect(filterProjects(projects, { q: '', archived: true }).map((p) => p.key)).toEqual(['acme', 'old']);
    expect(filterProjects(projects, { q: 'MAIN', archived: false }).map((p) => p.key)).toEqual(['acme']);
    expect(filterProjects(projects, { q: 'old', archived: true }).map((p) => p.key)).toEqual(['old']);
  });

  it('round-trips through the query parameters and only carries what is set', () => {
    expect(projectFiltersToQuery(NO_PROJECT_FILTERS)).toEqual({ q: null, archived: null });
    const filters = { q: 'coffee', archived: true };
    const query = projectFiltersToQuery(filters) as Record<string, string>;
    expect(query).toEqual({ q: 'coffee', archived: '1' });
    expect(projectFiltersFromQuery((name) => query[name] ?? null)).toEqual(filters);
    expect(projectFiltersActive(NO_PROJECT_FILTERS)).toBe(false);
    expect(projectFiltersActive(filters)).toBe(true);
  });
});

describe('projectKeyProblem', () => {
  it('says nothing while the key is empty or fine', () => {
    expect(projectKeyProblem('', [])).toBeNull();
    expect(projectKeyProblem('lumen-2', ['acme'])).toBeNull();
  });

  it('tells upper case from a wrong format, and a taken key', () => {
    expect(projectKeyProblem('Lumen', [])).toBe('keyLower');
    expect(projectKeyProblem('1lumen', [])).toBe('keyFormat');
    expect(projectKeyProblem('a', [])).toBe('keyFormat');
    expect(projectKeyProblem('lu men', [])).toBe('keyFormat');
    expect(projectKeyProblem('acme', ['acme'])).toBe('keyTaken');
  });
});
