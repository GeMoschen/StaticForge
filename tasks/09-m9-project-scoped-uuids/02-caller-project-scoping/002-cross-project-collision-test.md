---
id: M9.2.2
status: todo
depends: [M9.2.1]
epic: m9-project-scoped-uuids
feature: caller-project-scoping
area: qa
---

# M9.2.2 — Cross-project UUID collision test

## Context

The whole point of this epic is that two different projects can each hold an asset
with the same UUID without interfering with each other. That needs one integration
test proving it end-to-end, not just unit tests per call site.

## Goals

- New integration test (alongside existing suites like
  `server/sf-app/src/test/java/.../RevisionInvariantsTest.java` or
  `ConcurrentWritersTest.java` — match whichever module's test infrastructure fits):
  create two projects, force-create an asset with the identical UUID in each (via
  direct repository access, since normal creation always mints a fresh UUIDv7 and
  won't naturally collide until `M10`'s cross-project import exists), then verify for
  *both* projects independently:
  - The asset resolves correctly via its owning service (page/media/template lookup).
  - Revision history for each project shows only its own asset's changes.
  - Template resolution (`BlockResolver`/`OctlRenderer`) renders each project's own
    content, not the other's.
  - Generation and preview render each project's page correctly.
  - The URL registry (`urlregistry`) assigns/records independent entries per project
    for the shared UUID (its table is already keyed by `(project_id, ..., uuid, area)`
    per `M8.2.1`, so this should already be correct — this test just confirms it).

## Acceptance criteria

- [ ] The test fails if run against the pre-`M9` schema/code (i.e., it's a real
      regression guard, not a tautology) — confirm by temporarily reverting `M9.1`/`M9.2.1`
      locally and seeing it fail, then restoring.
- [ ] The test passes cleanly against the completed `M9.1`+`M9.2.1` state.

## Out of scope

- Exercising the actual export/import path (`M10`) — this test forces the collision
  directly at the repository level, since natural cross-project import doesn't exist
  until `M10` ships.

## Notes / hazards

- This test's value is in being a durable regression guard, not a one-off validation —
  keep it in the permanent suite, not a throwaway script.
