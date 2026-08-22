---
id: M1.7.2
status: done
depends: [M1.7.1, M1.4.3]
epic: m1-identity-revisions
feature: revision-invariants
area: qa
---

# M1.7.2 — Property-based revision invariants

## Context

Implement the §25.5 property suite — the proof that revision safety actually holds.

## Goals

- Write jqwik generators that produce random sequences of create/update/delete/restore
  operations on a project.
- Assert the five invariants (§25.5): consecutive gapless revisions; exactly 0 or 1 valid
  version per revision; byte-identical repeat reads at R; restore-then-read matches;
  concurrent writers produce a total order with no lost updates (each commit = fresh
  revision or `409`).
- Add a concurrency harness using 16 virtual threads.

## Acceptance criteria

- [ ] All five invariants hold across many generated sequences.
- [ ] The concurrency harness proves no lost updates / no revision gaps under parallelism.

## Out of scope

- Golden-file render tests (M2).

## Notes / hazards

- These are the critical safety net; keep them fast (< 60 s ideal) but exhaustive.
