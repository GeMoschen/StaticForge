---
id: M0.3.3
status: done
depends: [M0.3.1]
epic: m0-skeleton
feature: database-liquibase
area: backend
---

# M0.3.3 — H2 test harness

## Context

Tests run against H2 in PostgreSQL compatibility mode with the real Liquibase changelog
(§22.3, §25.2). Build the harness that every slice test in later epics reuses.

## Goals

- Provide `application-test.yml` exactly as §25.2 (fresh in-memory H2 per test class via
  `${random.uuid}`, POSTGRESQL mode, `DATABASE_TO_LOWER`, `DB_CLOSE_DELAY=-1`,
  `ddl-auto: validate`, Liquibase `contexts: test`).
- Ensure Liquibase executes in tests (schema never created by Hibernate).
- Add a `test` context changeset loading reference fixtures (per §25.2: one project, one
  user per role, a page template, two section templates, three media files) — this
  fixture content will be elaborated in M1 but the wiring is set up now.
- Wire a base `@DataJpaTest`/`@SpringBootTest` config shared across modules.

## Acceptance criteria

- [ ] A slice test boots the app against isolated H2, runs the changelog, and passes.
- [ ] Tests are order-independent and parallelizable (fresh DB per class).
- [ ] A mapping/changelog drift fails immediately (via `validate`).

## Out of scope

- Full fixture *content* (M1 builds the domain before the fixtures can be complete).
- Testcontainers/Postgres nightly job (M7, §22.3).

## Notes / hazards

- Keep `Testcontainers` out of the fast path; H2 is the fast path, Postgres is nightly.
