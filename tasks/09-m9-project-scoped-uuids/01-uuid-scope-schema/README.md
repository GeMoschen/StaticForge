# Feature: UUID scope schema change

**Spec:** Revises the physical implementation of §6.1 identity (the schema-level
uniqueness scope was never actually specified as server-wide — it's an implementation
choice being corrected here).

## Goal

Move `asset.uuid` from a single-column server-wide unique constraint to a composite
`(project_id, uuid)` unique constraint, and update the JPA entity + repository surface
to match, so the rest of the codebase (`M9.2`) has a real project-scoped lookup to
migrate onto.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-composite-unique-migration.md](001-composite-unique-migration.md) | — |
| 2 | [002-repository-project-scoped-finder.md](002-repository-project-scoped-finder.md) | 1 |

## Feature exit criteria

- [ ] `asset.uuid` has no server-wide unique constraint; `(project_id, uuid)` does.
- [ ] `AssetRepository` exposes a project-scoped `findByProjectIdAndUuid(long, UUID)`
      (or equivalent) as the primary lookup API going forward.

## Dependencies

`M1`'s original `asset` table (`002-assets.xml`) and `Asset` entity.
