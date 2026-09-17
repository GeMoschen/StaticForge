# Feature: Planner reason chains + persistence

**Spec:** Extends §18.2 (PLAN stage) and §18.5 (generation run record).

## Goal

Make `BuildPlanner` explain itself, and store the explanation with the run.

Today `BuildPlanner.affectedPages(snapshot, changedAssets)` runs a BFS over asset ids
with a `visited` set and returns a `Set<UUID>` of pages; `plan(...)` then emits one
`PlanEntry(pageUuid, channel, outputPath)` per page × channel. The BFS already visits
nodes in shortest-distance order from the changed roots, so recording a **parent
pointer** (the node and edge through which each node was first reached) is enough to
reconstruct a shortest reason chain for every entry, with no second traversal.

The expansion logic is extracted into one reusable, repository-reading but otherwise
pure component (working name `RebuildExpansion`). `BuildPlanner` (real and dry-run
plans) and the asset impact endpoint (`M22.2.2`) both use it, so all three can never
disagree.

Plans are stored per run in a compact, normalized shape (nodes with parent pointers +
entries pointing at nodes), not one full chain JSON per entry. Thousands of entries
typically share one chain suffix.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-reason-chains.md](001-reason-chains.md) | `M16.3.3`, `M22.4.1` |
| 2 | [002-run-plan-persistence.md](002-run-plan-persistence.md) | 1 |

## Feature exit criteria

- [x] `BuildPlan` exposes a reason for every entry; FULL, fallback-to-FULL, explicit
      scope and change-driven entries are distinguishable.
- [x] Change-driven reasons reconstruct to the shortest chain, chosen deterministically
      (same snapshot + baseline ⇒ byte-identical reasons).
- [x] The §18.2 navigation-affecting rule is implemented with its own edge kind.
- [x] Plans are persisted per run and survive later edits; old plans are pruned by a
      retention rule.

## Dependencies

`M4:generation` (`BuildPlanner`, `BuildPlan`, `PlanEntry`, `Snapshot`,
`GenerationService`, `GenerationRun`), `M16.3.3` (revision-aware reference queries —
the edges the reasons are built from).
