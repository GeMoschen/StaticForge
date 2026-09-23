---
id: M25.2.2
status: todo
depends: [M25.2.1, M25.1.2]
epic: m25-record-sets
feature: rendering
area: backend
---

# M25.2.2 — `$CMS_VALUE(recordset:uid)$`, `$CMS_VALUE(refEditor)$`, set loops, reference editor

## Context

`OctlRenderer.renderValue` special-cases `CATALOG` values (`isCatalog` → `BlockResolver.renderCatalog`).
A path-less cross-asset `$CMS_VALUE(page:about)$` is warning `SF-TPL-0111`. Dataset loops are compiled by
`OctlCompiler.compileDatasetLoop` and fed by `AssetValueResolver.datasetRecords(uuid)` (generation: index
built once per snapshot; preview: records valid at the preview revision). A `reference` editor stores
`{type:"ASSET_REF", uuid, assetType}`; `OctlRenderer.resolveSub` dereferences `RECORD` refs. The CDL
`reference` editor has `assetTypes [...]` and `dataset "uid"` (records of one dataset only). Epic decisions
1, 4, 5 and 6 are binding.

## Goals

- **Prefix:** `recordset` → `RECORD_SET` in `AssetReferencePrefixes` (the single shared helper).
- **Value form:** a path-less `$CMS_VALUE(recordset:uid)$` is **not** `SF-TPL-0111`; it renders the set:
  `BlockResolver.renderRecordSet(UUID set)` → the set's selected records (`RecordSetQueries.select`), each
  rendered with the dataset's record template for the current channel and locale, concatenated. Loop meta
  (`_index`, `_first`, `_last`, `_count`) refer to the position in the selected list. Implement in
  `GenerationRenderer` and `PageRenderService`; filters on the value form (`|…`) apply to the concatenated
  output like any other value.
  - Missing record template for the channel → empty + warning (reuse `SF-GEN-0210` semantics, new code if
    the message differs); set with invalid query → empty + the `M25.1.2` warning; deleted set →
    `SF-TPL-0112`.
- **With a path:** `recordset:uid` root value object = `{records:[…selected items…], _count, _meta{uid,
  displayName, dataset}}` so `$CMS_VALUE(recordset:uid._count)$` and `$CMS_IF(recordset:uid._count > 0)$` work.
  Document in `AssetValueResolver`'s type list.
- **Loop form:** `$CMS_FOR(x : recordset:uid [, where, sort, limit, offset])$` — set query first, loop
  args narrow (decision 5); `folder=` → `SF-TPL-0140`; field checks against the set's dataset at save time
  (`ReferenceResolver` gains `recordSetDataset(uid)`). Items are the same objects a dataset loop binds.
- **Reference editor → set:**
  - CDL: `assetTypes` accepts `RECORD_SET`; `dataset "uid"` also restricts sets to that dataset when
    `RECORD_SET` is allowed (if `assetTypes` is given it must include `RECORD` or `RECORD_SET` —
    `SF-CDL-0104` otherwise). Server validation (`M16.5.2` `ContentValidator`): a set of another dataset →
    `ERROR` finding code `dataset`.
  - `$CMS_VALUE(refEditor)$` whose value is an `ASSET_REF` with `assetType RECORD_SET` renders the set
    (same path as the value form; dependency on the set collected like `collectDeps`).
  - `$CMS_FOR(x : refEditor [, args])$` iterates the referenced set; when the editor declares
    `dataset "uid"`, loop `where`/`sort` fields are checked at save time, otherwise at render time
    (unknown field → warning, record skipped — mirror how `M19` treats unresolvable dataset fields).
  - `$CMS_VALUE(refEditor._count)$` / `.records` read the root value object.
- **Recursion guard:** a record template may itself render a set (a record with a reference to a set);
  bound the depth with the existing `RenderBudget`/include guard; a set rendering itself is a cycle error,
  not a stack overflow.
- **Golden files:** `render/recordset-value/`, `render/recordset-loop-narrowing/`,
  `render/recordset-reference-editor/`, `render-md/recordset-value-markdown/` (stub resolver fixture
  extended with `recordSets` + record templates).

## Acceptance criteria

- [ ] Golden cases above pass; for the same fixture preview (`PageRenderService`) and generation produce
      byte-identical output (`M19ContentStoreJourneyIntegrationTest`-style test).
- [ ] Template save: unknown set uid → `SF-TPL-0110`; `folder=` on a set loop → `SF-TPL-0140`; loop `where`
      on an undeclared field of the set's dataset → `SF-TPL-0141`.
- [ ] CDL: `reference x { assetTypes [RECORD_SET] dataset "team" }` compiles; `assetTypes [PAGE] dataset
      "team"` → `SF-CDL-0104`; saving a page whose value points at a set of dataset `faq` → `ERROR` finding.
- [ ] Soft-deleted records never render; time-travel preview renders the set (query, membership and
      record values) as of that revision.
- [ ] A self-referencing set renders a cycle diagnostic within the budget; `MAX_LOOP_ITERATIONS` still
      applies to set loops and to value-form rendering.
- [ ] `M24`: a localizable field renders per locale in the record template; a `where` on it filters per
      locale.

## Out of scope

- Planner edges (`M25.2.3`), UI, pagination over sets.

## Notes / hazards

- The generation snapshot index from `M19.3.2` is keyed by dataset; add a per-set view on top of it
  (`setUuid → records`) built in the same single pass — never scan the snapshot per render.
- Record sets must be added to the snapshot (`Snapshot.assetsOfType(RECORD_SET)`) so generation can read
  the stored query at the snapshot revision.
