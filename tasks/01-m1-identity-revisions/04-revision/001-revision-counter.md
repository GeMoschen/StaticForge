---
id: M1.4.1
status: done
depends: [M1.3.1]
epic: m1-identity-revisions
feature: revision
area: backend
---

# M1.4.1 — Revision record & counter repository

## Context

Implement the §7.2 revision record and the §7.3 gapless counter with its two-portable
repository implementations.

## Goals

- Implement `revision` entity mirroring §7.2 (composite PK `(project_id, revision_id)`,
  change_type enum, comment, summary JSON) with Liquibase changesets.
- Implement `project_revision_counter` + `RevisionCounterRepository` with:
  - PostgreSQL: single `UPDATE … RETURNING` statement (§7.3),
  - H2: `SELECT … FOR UPDATE` + `UPDATE` pair (§7.3 note),
  behind one interface, covered by a shared contract test.
- Ensure allocation is inside the mutating transaction and a rollback leaves no gap.

## Acceptance criteria

- [ ] Both counter impls pass the same contract test (gapless, concurrency-safe).
- [ ] A rolled-back transaction does not burn a revision id.
- [ ] `revision` `summary` JSON denormalizes touched assets per §7.2.

## Out of scope

- `RevisionService.allocate/appendSummary` orchestration (next task).

## Notes / hazards

- The row lock serializes writers per project only (§7.3); verify via a concurrency test.
