# Feature: Build planner

**Spec:** §18.1 (trigger/scope), §18.2 (SNAPSHOT + PLAN), §18.5 (run record).
**Area:** backend. **Epic:** M4.

## Goal

Implement run orchestration: the queued run model, revision-pinned snapshot, and the
full/incremental plan over `asset_reference`.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-generation-service-queue.md](001-generation-service-queue.md) | M1.4.2 |
| 2 | [002-snapshot-plan.md](002-snapshot-plan.md) | 1, M2.2.3 |

## Feature exit criteria

- [ ] One active run per project; a second request returns `409` with the running id.
- [ ] Snapshot pins a revision; plan computes full vs incremental (transitive reference
      expansion incl. navigation-affecting changes).

## Dependencies

`M1:revision`, `M2:content-validation` (asset_reference reverse edges).
