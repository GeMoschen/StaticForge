---
id: M9.1.1
status: todo
depends: []
epic: m9-project-scoped-uuids
feature: uuid-scope-schema
area: backend
---

# M9.1.1 — Composite `(project_id, uuid)` unique constraint

## Context

`server/sf-app/.../db/changelog/v1.0/002-assets.xml` declares `uuid` with
`unique="true"` as a single-column constraint (`server/sf-domain/.../asset/Asset.java`
mirrors it with `@Column(name = "uuid", nullable = false, unique = true)`). That's
strictly server-wide uniqueness — stricter than the product needs, since every caller
already knows the project before it resolves a UUID.

## Goals

- New Liquibase changelog `015-project-scoped-uuid.xml` (next free number after
  `014-url-registry.xml`): drop the existing single-column unique constraint on
  `asset.uuid`, add a composite unique constraint on `(project_id, uuid)`, and add an
  index on `uuid` alone if the existing single-column constraint's index is being
  dropped (queries that still filter by UUID alone during a migration window, or any
  legitimately-global lookup identified in `M9.2`, need it to stay fast).
- Update `Asset.java`: replace the single-column `unique = true` on the `uuid`
  `@Column` with a `@Table(uniqueConstraints = @UniqueConstraint(columnNames =
  {"project_id", "uuid"}))` (or equivalent), matching how any other composite-key
  entity in this codebase already expresses it (check `UrlRegistryEntry`'s
  `uq_url_registry_tuple` from `M8.2.1` for the established pattern).
- Confirm `dbms`-agnostic changeset (no JSON columns involved) needs no
  postgresql/h2 split, matching `014-url-registry.xml`'s precedent.

## Acceptance criteria

- [ ] Migration applies cleanly against the current schema (existing data has no
      duplicate `uuid`s globally today, so the new composite constraint is trivially
      satisfied on upgrade — confirm this with a query before writing the changeset, not
      after).
- [ ] Inserting two assets with the same `uuid` in two different `project_id`s
      succeeds; inserting two with the same `uuid` in the *same* `project_id` still
      fails at the DB level.
- [ ] `Asset` entity round-trips correctly through Hibernate with the new constraint
      (existing `AssetRepository` tests still pass unmodified).

## Out of scope

- Repository API changes (`M9.1.2`).
- Any caller migration (`M9.2`).

## Notes / hazards

- This changes a constraint on a table every other module writes to — run the full
  backend test suite after this task, not just the `asset` module's, since a caller
  that (incorrectly) relied on global uniqueness as an implicit invariant will surface
  as a flaky or failing test elsewhere, which is exactly the signal `M9.2`'s audit
  needs.
