# Feature: Dashboard & project context

**Spec:** §23.4 (project context), §24.4 (nav rail), §24.5 (#2 dashboard).
**Area:** frontend. **Epic:** M3.

## Goal

Implement project selection and the per-project context store that feeds every other view.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-dashboard-project-picker.md](001-dashboard-project-picker.md) | M3.1.1 |
| 2 | [002-project-context-store.md](002-project-context-store.md) | 1 |

## Feature exit criteria

- [ ] Picker shows projects with name + last revision + role; search-first over 12.
- [ ] `projectContextStore` exposes active project, channels, folder tree, template
      catalogue, and `currentRevision()` (§23.4).

## Dependencies

`M3:auth-ui`.
