---
id: M0.3.2
status: done
depends: [M0.3.1]
epic: m0-skeleton
feature: database-liquibase
area: backend
---

# M0.3.2 — Hibernate/JPA mapping strategy

## Context

Map the schema to entities using the §22.5 conventions and the §5.3 JSON payload
strategy, ready for M1 to adapt entity trees onto them.

## Goals

- Configure persistence (`spring.jpa.*`) per §21.6: `ddl-auto: validate`,
  `open-in-view: false`, batch settings (`batch_size` 50, `order_inserts`).
- Establish the Hibernate 6 JSON mapping approach: `@JdbcTypeCode(SqlTypes.JSON)` onto
  a `JsonNode` column (§5.3), portable across Postgres JSONB and H2 CLOB.
- Define the conventions for `LAZY` associations, DTO-projection queries for lists,
  and the fact that the revision interval (not `@Version`) is the concurrency token.
- Add a representative entity pair (e.g. `Project` ↔ `Asset`) + repository to prove the
  mapping works end to end.

## Acceptance criteria

- [ ] `ddl-auto: validate` passes against the Liquibase-produced schema.
- [ ] A JSON payload round-trips through a `@JdbcTypeCode(SqlTypes.JSON)` field on both
      H2 and Postgres (dialect test).
- [ ] List queries use projections (no entity graphs over collections).

## Out of scope

- Full domain entity set (M1).
- Second-level cache (deliberately disabled, §22.5).

## Notes / hazards

- `open-in-view: false` means all lazy access must happen inside transactions — keep
  that in mind for services in later epics.
