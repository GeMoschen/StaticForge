---
id: M25.2.3
status: done
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

- [x] `BuildPlanner` test: P1 renders `recordset:leads` (`where "role == 'lead'"`), P2 loops
      `recordset:staff` (no set `where`), P3 renders `$CMS_VALUE(featured)$` with the reference editor
      `featured` → `staff`, P4 loops `dataset:team`, P5 unrelated. Edit a lead → {P1, P4}; edit a
      non-lead in `leads` → {P4}; add a record to `staff` → {P2, P3, P4}; move a lead `staff → leads` →
      {P1, P2, P3, P4}; change `leads` query → {P1}; change the `html` record template → {P1, P3};
      P5 never rebuilt.
- [x] Insight reasons asserted for the cases above.
- [x] `DatasetBenchmark` (`SF_PERF=1`) extended: 5,000 records in 10 sets × 500 pages rendering sets —
      FULL and a single-record INCREMENTAL numbers recorded in this file; no regression > 10 % vs. the
      `M19.3.2` numbers for dataset loops.

## Out of scope

- Per-channel dependency granularity if the planner doesn't have it today.

## Notes / hazards

## Implementation notes (2026-09-23)

- **Render-time dependencies — verified, no change.** `OctlRenderer.recordSetSource` records the set and its dataset
  for every form (value, loop, `reference` editor value, root value object); the value form's nested record-template
  renders merge their own dependencies into the page's. The record template lives *in* the dataset asset
  (`channelTemplates`), so "→ the dataset's record template" is the dataset dependency already recorded. A
  `reference` editor value → set is a `CONTENT_REF` row from the page's payload (`ReferenceMaterializer`); the
  planner test proves it (P3 is reached only over that row; its rename reason is a `REFERENCE` step). The planner
  walks `asset_reference` rows, not render dependencies (those drive media copy and manifests).
- **`CompiledTemplate.recordSetReads(uid)` → `RecordSetReads{loops, valueReads}`** (sf-template): the narrowing of
  every `$CMS_FOR(x : recordset:uid, …)$` (nested included; found by the uid as spelled, so it works on a template
  compiled without a resolver, like `datasetQueries(uid)`), and whether the set is read any other way — the value
  form, a path (`recordset:uid._count`, `.records`), a condition, a `$CMS_SET`, another loop's `where`.
  `ReferenceUseCollector.valueReads` is the reference-use AST walk with the path-less loop source excluded.
- **Planner (`plan.RebuildExpansion`)** — all in the one walk, so dry run, real plan and impact agree:
  - *Record visited* (changed or reached): `dataset:` loop readers as before (`DatasetLoopImpact`), **plus** the
    readers of the set it is in now (tested with the current version) and of the set it was in at the baseline
    (tested with the previous version) — a move tests each set only with the version that was in it. Readers are the
    set's reverse rows: templates (`OCTL_VALUE`), datasets (their record templates), processed media, and pages /
    records / global sets whose `reference` editor points at the set (`CONTENT_REF`). New `plan.RecordSetImpact`
    decides per reader with `RecordSetQueries.maySelect(record, setQuery, narrowing, localeChains)` — the set query
    compiled against the dataset schema from the build's compile memo (the instance generation renders with, so an
    invalid query selects nothing here either) and every project language's chain. A template's value read tests the
    set query alone; each loop AND-s its narrowing (a `where` reading the render scope stays conservative inside
    `maySelect`). Content readers and processed media test the set query alone: the template rendering the editor is
    not analysed, so the narrowing of `$CMS_FOR(x : editor, where=…)$` doesn't prune (conservative). A reader whose
    sources don't spell the set's current uid counts as a value reader. Edge `RECORD_SET_MEMBERSHIP`, source path =
    set uid. A set that changed itself, a deleted set, and a dataset that changed in more than its record templates
    skip this (they reach every reader themselves).
  - *Nested sets*: a record whose `reference` editor points at a set is a content reader of that set; once reached it
    is visited like any record, so the walk continues to the readers of *its* set (and its dataset's loops). This
    covers a set rendered inside a record template through a record's editor, and a set value/loop inside another
    dataset's record template (a `DATASET` reader).
  - *Changed set*: every referrer (display name, uid, move, query). When the stored query differs from the baseline's,
    the readers are discovered with the new edge `RECORD_SET_QUERY` (source path = the reference row's); otherwise
    over their normal `REFERENCE` rows.
  - *Changed dataset*: `Changes.recordTemplatesOnly` — record templates differ from the baseline while every other
    payload field, the display name and the uid don't → only the readers of its live sets that render the records
    through a record template: OCTL readers with a value read and every content reader (edge `RECORD_TEMPLATE`, source
    path = set uid). Set loops and `dataset:` loops are not rebuilt. Any other change → every referrer as before (its
    sets are referrers, so every reader of every set). A record changed in the same window as a record-template-only
    change is still pruned normally (the old "dataset is a root → skip" became `walksEveryReader`). No per-channel
    granularity: the planner has none today (out of scope).
  - *Reached dataset* (possible since `M25.2.1` gave datasets outgoing OCTL edges): its record templates' inputs
    changed — a media file / page / global set they read, or a `dataset:` loop in them that may select a changed
    record — so it walks the record-template path above instead of every referrer.
  - `DatasetLoopImpact` now scans datasets' record templates (record-template compile profile) for `dataset:` loops;
    before, a `DATASET` reader of a dataset fell into the "reads no records" default arm and was never rebuilt.
  - `BEFORE_TYPES` gained `RECORD_SET` and `DATASET` (baseline versions for the query / record-template comparisons).
  - Signature: `expand(snapshot, changes, pagination, definitions, locales)`; `BuildPlanner` passes the build memo and
    `paths.locales()`, `ImpactService` the same (its upper bound never prunes).
- **M22 reasons** (three new `RebuildEdgeKind`s; edges are strings in the API — no OpenAPI / `schema.d.ts` change;
  `PlanEntryView` Javadoc and `docs/api.md` list them): *record `jane` in record set `leads` changed* = root
  `RECORD jane`, step `RECORD_SET_MEMBERSHIP` with source path `leads`; *record set `leads` query changed* = root
  `RECORD_SET leads`, step `RECORD_SET_QUERY`; *record template of dataset `team` changed* = root `DATASET team`, step
  `RECORD_TEMPLATE` with the set's uid. **UI follow-up:** `ui/src/app/features/generation/insight/insight.util.ts`
  `EDGE_LABELS` has no labels for the three kinds yet (they show their raw names, as designed for unknown edges).
- **Docs:** template developer guide ("Rebuilds with record sets"), `docs/architecture.md` (plan paragraph),
  `docs/api.md` (edge list).
- **Tests.** sf-app `RecordSetIncrementalPlanIntegrationTest` (2): the acceptance scenario with exact page sets and
  reason chains — edit lead → {P1, P4}; edit non-lead → {P4}; add to staff → {P2, P3, P4}; move lead staff → leads →
  {P1, P2, P3, P4}; move a non-lead into leads → {P2, P3, P4}; leads query → {P1} (`RECORD_SET_QUERY`); staff rename →
  {P2, P3}; html record template → {P1, P3} (`RECORD_TEMPLATE`); record template + record edit in one window →
  {P1, P3, P4}; schema change → {P1, P2, P3, P4}; P5 never — and nested rendering: a staff record → the group record
  referencing staff → the page rendering `recordset:groups`; an alumni lead → the groups dataset's record-template
  `dataset:` loop → that page; an alumni dev → only the alumni loop; team's record template → the groups page, not
  the alumni loop. sf-template `RecordSetRenderTest.theReadsOfARecordSetAreListedByUid`. sf-generate
  `RecordSetQueryEvaluatorGuardTest.thePlannerUsesTheSharedEvaluator` (`RecordSetImpact` goes through
  `RecordSetQueries`, never `DatasetQueryEvaluator`). M19's `DatasetIncrementalPlanIntegrationTest` unchanged and green.
- **Benchmark** (`SF_PERF=true ./gradlew :server:sf-app:test --tests "*DatasetBenchmark" --rerun -Pfrontend.skip=true`,
  development machine, H2):
  - New `recordsInSetsRenderedByPages`: 5,000 records round-robin in 10 sets (each `where "role == 'lead'"`,
    `sort "-level,name"`, `limit 20`), 500 pages over 20 templates (value form / narrowed loop per set). FULL
    **909 ms** (503 files); INCREMENTAL after one lead edit **697 ms** (53 files — the 50 pages of its set); after a
    developer edit the set filters out **683 ms** (3 files — nothing rebuilt); after a record template edit **725 ms**
    (253 files — the 250 value-form pages). Record creation 17.2 s.
  - M19 dataset loops, same run: FULL **2,125 ms**, selected-record INCREMENTAL **2,018 ms** (503 files) vs. M19.3.2's
    2,448 / 2,182 ms — no regression. Unselected-record INCREMENTAL **619 ms** (3 files) vs. M19.3.2's 181 ms (2 files)
    is not caused by this task: the same benchmark at the pre-task `HEAD` (clean worktree) gives 676 ms / 3 files
    (FULL 2,020 ms, selected 1,958 ms). The fixed cost of an incremental run grew with later milestones (M22
    carry-forward stages the base build; one more file), not with the planner.
