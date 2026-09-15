---
id: M19.3.2
status: todo
depends: [M19.3.1, M19.1.2, M16.2.2, M16.3.2]
epic: m19-content-store
feature: query-octl
area: backend
---

# M19.3.2 — `$CMS_FOR(… : dataset:uid, …)$`, `record:` values, record references, incremental edges

## Context

`OctlRenderer.renderFor` / `resolveForList` handle two sources: `nav:uid` →
`BlockResolver.resolveNavigationChildren(uuid, args)`, and otherwise `resolve()` over loop vars,
`$CMS_SET` vars, `CMS_PAGE.*` and content values (must be a JSON array). Loop scope exposes
`_index/_first/_last/_count/_depth`; iteration is capped by `MAX_LOOP_ITERATIONS` (SF-TPL-0131).
The compile-time `ReferenceResolver` maps a prefix via `AssetType.valueOf(upper)`, with `nav` special-
cased, in three duplicated places: `GenerationRenderer.assetTypeForRef`,
`PageRenderService.assetTypeForRef`, `TemplateServiceImpl.referenceResolver`. `M16.2` makes
`$CMS_VALUE(type:uid.path)$` resolve for real; `M16.3.2` writes template OCTL reference rows on
template save. `BuildPlanner.affectedPages` walks reverse edges (`references.findByToAssetId`) plus
payload indexes for templates. The `reference` editor stores `{type:"ASSET_REF", uuid, assetType}`
and restricts pickers with `assetTypes [..]`.

## Goals

- **Prefixes:** `dataset` → `DATASET`, `record` → `RECORD` in all three resolvers (dedupe into one
  shared helper if not already done by `M17.3.1`).
- **Loop source:** `$CMS_FOR(x : dataset:uid, where=…, sort=…, limit=…, offset=…, folder=…)$`:
  - Compile: resolve the dataset UID (SF-TPL-0110 if unresolvable), parse args with
    `DatasetQueryParser`, validate fields against the dataset's compiled definition when available.
  - `BlockResolver` gains `resolveDatasetRecords(UUID dataset, DatasetQuery q)` → JSON array of
    record objects (`content` fields + `_uuid/_uid/_displayName/_folderPath/_changedAt`).
  - Generation impl: build a **per-snapshot index** `datasetUuid → List<RecordView>` once (lazy,
    thread-safe — renders run on virtual threads) from `Snapshot.assetsOfType(RECORD)`; never scan all
    snapshot assets per loop.
  - Preview impl: current (or time-travel revision) records via the `M19.1.1` repository query.
  - Loop items behave like list items: `$CMS_VALUE(x.name)$`, `$CMS_REF(x.website)$`,
    `$CMS_IF(x._first)$`, nested `$CMS_FOR(tag : x.tags)$`.
- **Record values:** `$CMS_VALUE(record:jane_doe.name)$` through the `M16.2` `AssetValueResolver`
  for `RECORD` (content-rooted path + `_` meta fields).
- **Reference dereference:** a `reference` editor value pointing at a `RECORD` can be traversed:
  `$CMS_VALUE(author.name)$` resolves the record's `name`. New optional CDL attribute on
  `reference`: `dataset "team"` (restricts the picker and validation to that dataset's records);
  update `docs/editors/reference.md` in `M19.5.1`.
- **Dependencies / incremental:**
  - Rendering a dataset loop records a render dependency on the **dataset** asset; a record value or
    dereference records a dependency on the **record**.
  - `M16.3.2` template reference rows gain `dataset:`/`record:` edges from the template.
  - `BuildPlanner.affectedPages`: a changed `RECORD` expands to (a) its reverse edges and (b) its
    dataset's reverse edges (via `datasetRef`/`template_asset_id`), including soft-deleted and newly
    created records; a changed `DATASET` schema expands to its reverse edges.
- **Golden files:** add `render/for-dataset-where-sort/`, `render/for-dataset-nested-list/`,
  `render/record-value-and-reference/` (+ a Markdown-channel case) — extend `GoldenFileRenderTest`
  with an optional stub `BlockResolver`/value resolver loaded from a `records.json` fixture
  (coordinate the runner change with `M20.1.2`, which also needs a stub resolver).

## Acceptance criteria

- [ ] Golden-file cases above pass; generation (`GenerationRendererTest`-style) and preview
      (`PageRenderService` test) produce byte-identical output for the same fixture.
- [ ] Template save with `where="x.nope == 1"` on a dataset without `nope` → diagnostic; with an
      unknown dataset UID → SF-TPL-0110; save is rejected like any other OCTL error.
- [ ] `BuildPlanner` test: pages P1 (loops `dataset:team`), P2 (references record `jane`), P3
      (unrelated). Change `jane` → {P1, P2}; add a new team record → {P1}; change dataset schema →
      {P1}; P3 never rebuilt.
- [ ] Loop over 5,000 records × 500 pages uses the snapshot index (assert via a counter/spy that the
      index is built once per snapshot) and meets the §18.6 budget in the generation benchmark.
- [ ] `MAX_LOOP_ITERATIONS` still enforced for dataset loops.
- [ ] Soft-deleted records never appear in loops; time-travel preview shows records as of that revision.

## Out of scope

- Pagination over datasets (`M21`), localized record values (`M24.3.3`), query-aware dependency
  pruning, cross-dataset joins, search indexing (`M23`).

## Notes / hazards

- **Granularity trade-off (accepted):** page → dataset dependency means any record change in the
  dataset rebuilds every page looping it. Keep reason data (record X → dataset Y → page) available
  for `M22.1.1` rather than collapsing it.
- **Cycles:** record A references record B references A — dereference depth must be bounded (reuse
  the `M16.5.1` guard/limits), and rendering must not recurse into record *templates* (records have
  none).
- Virtual-thread safety of the lazily built snapshot index: use a `ConcurrentHashMap.computeIfAbsent`
  or build eagerly in the plan stage; do not use unsynchronized memoization.
- `RenderPipeline.dependenciesByPage` is a `put`-per-entry map (overwrite hazard noted for `M21`);
  make sure dataset dependencies are *added* to the page's set, not replacing it.
