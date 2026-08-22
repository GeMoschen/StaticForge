---
id: M0.3.1
status: done
depends: [M0.2.1]
epic: m0-skeleton
feature: database-liquibase
area: backend
---

# M0.3.1 — Liquibase scaffold & baseline schema

## Context

Liquibase owns the schema — Hibernate never creates it (§21.6, §22.4). Stand up the
changelog structure and the first versioned changesets.

## Goals

- Create `sf-app/src/main/resources/db/changelog/` exactly per §22.4: `v1.0/`
  numbered changesets, a `v1.1/` (empty placeholder), `data/` contexts.
- Write `db.changelog-master.xml` using `includeAll` for version dirs and context-scoped
  `include` for `demo`/`test` data files.
- Land the **baseline** v1.0 changesets needed by M1 (logical DDL from §22.2): for now
  at minimum the `project` and `app_user` tables plus the `asset`/`asset_version` core
  with the dbms-scoped `payload` column and the composite unique on `(project_id,
  asset_type, uid)`.
- Demonstrate the dbms-scoped column pattern (`dbms="postgresql"` → JSONB, else CLOB)
  and the `varchar_pattern_ops` split for partial indexes.
- Follow the §22.4 rules: immutable changesets, explicit `id`/`author`, `preConditions`
  guards, context usage.

## Acceptance criteria

- [ ] `liquibase update` runs clean on PostgreSQL and H2 (compat mode).
- [ ] `db.changelog-master.xml` matches §22.4 structure.
- [ ] A dbms-scoped `payload` JSONB/CLOB changeset is present and correct.
- [ ] `liquibase status` reports no unexpected drift.

## Out of scope

- The full v1.0 table set (revision, members, blobs, references…) — those arrive with
  the entities that need them in M1. Leave a clear place for subsequent changesets.

## Notes / hazards

- Keep changeset ids stable/unique; no `validCheckSum` (§22.4 rule 1).
- Destructive ops need `<rollback>` blocks where automatic rollback is impossible.
