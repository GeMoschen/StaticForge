---
id: M25.2.3
status: todo
depends: [M25.2.2]
epic: m25-record-sets
feature: rendering
area: backend
---

# M25.2.3 — Incremental planning and build insight for record sets

## Context

`BuildPlanner.affectedPages` walks reverse reference edges; `M19.3.2` added query-aware pruning for
dataset loops (`plan.DatasetLoopImpact`, `DatasetQueryEvaluator.maySelect`,
`CompiledTemplate.datasetQueries(uid)`, previous versions via
`AssetVersionRepository.findValidAtRevisionByAssetIdIn`). `M22` stores a rebuild reason per plan entry
(`PlanEntryRecord`). `RenderPipeline.dependenciesByPage` must *add*, not replace, dependencies.

## Goals

- Dependencies recorded at render time: a loop over a set → the set (and the dataset's schema, as
  `dataset:` loops do); the **value form** additionally → the dataset's record template (it renders
  through it, a loop does not); a reference editor pointing at a set → the set (reference rows already
  exist via payload materialization — verify).
- Planner expansion:
  - changed/created/deleted/moved **record** → pages reading its set(s) (old and new set on a move) **only
    if** the set query may select the record before or after the change (reuse `maySelect` with the
    set's stored query — always prunable, it cannot read the render scope), then AND-ed loop `where` of
    the reading template when present; plus the existing `dataset:` loop and direct-reference paths.
  - changed **set** (query, display name, uid) → every page reading it.
  - changed **dataset**: schema → readers of the dataset and of all its sets; record template only →
    value-form readers of its sets (channel granularity only if the planner already works per channel —
    don't invent it).
- `M22` reasons: "record *jane* in record set *leadership* changed", "record set *leadership* query
  changed", "record template of dataset *team* changed".

## Acceptance criteria

- [ ] `BuildPlanner` test: P1 renders `recordset:leads` (`where "role == 'lead'"`), P2 loops
      `recordset:staff` (no set `where`), P3 renders `$CMS_VALUE(featured)$` with the reference editor
      `featured` → `staff`, P4 loops `dataset:team`, P5 unrelated. Edit a lead → {P1, P4}; edit a
      non-lead in `leads` → {P4}; add a record to `staff` → {P2, P3, P4}; move a lead `staff → leads` →
      {P1, P2, P3, P4}; change `leads` query → {P1}; change the `html` record template → {P1, P3};
      P5 never rebuilt.
- [ ] Insight reasons asserted for the cases above.
- [ ] `DatasetBenchmark` (`SF_PERF=1`) extended: 5,000 records in 10 sets × 500 pages rendering sets —
      FULL and a single-record INCREMENTAL numbers recorded in this file; no regression > 10 % vs. the
      `M19.3.2` numbers for dataset loops.

## Out of scope

- Per-channel dependency granularity if the planner doesn't have it today.

## Notes / hazards

