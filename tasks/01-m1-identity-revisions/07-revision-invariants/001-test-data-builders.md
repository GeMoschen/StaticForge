---
id: M1.7.1
status: done
depends: [M1.4.2, M1.5.1]
epic: m1-identity-revisions
feature: revision-invariants
area: qa
---

# M1.7.1 — Test data builders (fixtures)

## Context

Create the fluent fixture builders of §25.3 that every later test reuses.

## Goals

- Implement `fixtures.project("acme_site")`, `fixtures.sectionTemplate(...).cdl(...)
  .channel(...)`, `fixtures.page(...).template(...).section(...)`, etc.
- Builders allocate revisions through the **real** services (§25.3), not by bypassing the
  revision machinery.
- Seed the `test` Liquibase context fixtures (§25.2): one project, one user per role, a
  page template, two section templates, three media files.

## Acceptance criteria

- [ ] A test can construct a populated project via builders with valid UIDs + revisions.
- [ ] Builders route through `RevisionService` (asserted).

## Out of scope

- CDL/OCTL content in builders (M2 extends them).

## Notes / hazards

- Keep builders in `java-test-fixtures` so all modules share them.
