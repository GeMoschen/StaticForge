---
id: M25.2.2
status: done
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

- [x] Golden cases above pass; for the same fixture preview (`PageRenderService`) and generation produce
      byte-identical output (`M19ContentStoreJourneyIntegrationTest`-style test).
- [x] Template save: unknown set uid → `SF-TPL-0110`; `folder=` on a set loop → `SF-TPL-0140`; loop `where`
      on an undeclared field of the set's dataset → `SF-TPL-0141`.
- [x] CDL: `reference x { assetTypes [RECORD_SET] dataset "team" }` compiles; `assetTypes [PAGE] dataset
      "team"` → `SF-CDL-0104`; saving a page whose value points at a set of dataset `faq` → `ERROR` finding.
- [x] Soft-deleted records never render; time-travel preview renders the set (query, membership and
      record values) as of that revision.
- [x] A self-referencing set renders a cycle diagnostic within the budget; `MAX_LOOP_ITERATIONS` still
      applies to set loops and to value-form rendering.
- [x] `M24`: a localizable field renders per locale in the record template; a `where` on it filters per
      locale.

## Out of scope

- Planner edges (`M25.2.3`), UI, pagination over sets.

## Notes / hazards

- The generation snapshot index from `M19.3.2` is keyed by dataset; add a per-set view on top of it
  (`setUuid → records`) built in the same single pass — never scan the snapshot per render.
- Record sets must be added to the snapshot (`Snapshot.assetsOfType(RECORD_SET)`) so generation can read
  the stored query at the snapshot revision.

## Implementation notes (2026-09-23)

- **Design — the renderer renders sets, the pipelines supply data.** Instead of two `BlockResolver.renderRecordSet`
  implementations (the task text), both pipelines provide only what differs between them, and `OctlRenderer` does the
  selection, looping and nested rendering once — so generation and preview are identical by construction:
  - `AssetValueResolver.recordSet(UUID)` → new `template.render.RecordSetSource{uuid, uid, displayName, datasetUuid,
    datasetUid, query (RecordSetQueries.Compiled), datasetDefinition, records}` — the set's live records unselected;
    `null` for a missing/soft-deleted set.
  - `BlockResolver.recordTemplate(UUID dataset)` → the compiled record template for the render's channel, or `null`.
  - Generation: `SnapshotAssetValueResolver.recordSet` (memoized per set and build; a `set → records` view built in
    the **same single pass** as the dataset index — `recordIndexBuilds()` stays 1; the stored query compiles against
    `memo.definition(dataset, cdl)`, the instance the record template compiles with); `GenerationRenderer.recordTemplate`
    → `memo.compileRecordTemplate(...)`. Preview: `LiveAssetValueResolver.recordSet` (set version, dataset schema and
    set membership as of the preview revision — the dataset's records are loaded once and grouped by `folder_id`);
    `PageRenderService.compileRecordTemplate` → `compiledTemplateCache.compileRecordTemplate(...)` with the dataset
    version valid at the revision. Never compiled per record.
- **Value form** `$CMS_VALUE(recordset:uid)$` / `$CMS_VALUE(refEditor)$` (value `ASSET_REF` with `assetType
  RECORD_SET`): `RecordSetQueries.select` with the render's locale chain, then each record renders through the record
  template in a context nested in the current one (`RenderContext.toBuilder()` — same resolvers, locale, page values
  and budget; the values are the record item plus `_index`, `_first`, `_last`, `_count` = position in the selected
  list). Filters apply to the concatenated output **without re-escaping it** (it is rendered markup; `| html` etc.
  still work as filters); a missing/empty set still runs its filters (`| default("…")`). A path-less
  `recordset:` value is no longer `SF-TPL-0111`; `$CMS_REF(recordset:x)$` is `SF-TPL-0105` like dataset/record.
- **Root value object** (documented in `AssetValueResolver`): `{records:[items], _count, _meta{uid, displayName,
  dataset}}`, built by the renderer (it depends on the render language) for `recordset:uid.path` and for a
  reference value's path (`featured._count`, `featured.records`, `featured._meta.uid` dereference like a record
  reference; `featured.uuid`/`assetType` keep reading the stored value). Selections are memoized per render.
- **Loops.** `$CMS_FOR(x : recordset:uid, …)$` compiles its arguments like a dataset loop (shared
  `OctlCompiler.compileLoopQuery`); `folder=` is `SF-TPL-0140`; with the save-time resolver the fields are checked
  against the set's dataset (`ReferenceResolver.recordSetDataset(setUuid)` — takes the resolved uuid — then
  `datasetDefinition`; `ProjectReferenceResolver` implements it, `DatasetServiceImpl.savingResolver` delegates it).
  `$CMS_FOR(x : localValue, args)$`: arguments on a local (non-asset) loop now compile the same way (`folder=` →
  `0140`) and narrow the value **when it is a set reference**; on any other list they are ignored as before. When the
  accessor is a `reference` editor with `dataset "uid"`, fields are checked on save; otherwise at render time against
  the referenced set's dataset: an unknown field warns `SF-TPL-0141` (warning, once per loop and render) and reads as
  missing, so records filtered on it are skipped (M19's rule). Narrowing is decision 5 through
  `RecordSetQueries.select(records, compiled, chain, narrowing, scope)` (a `where` may read the render scope, like a
  dataset loop's). `CompiledTemplate.datasetQueries(uid)` now only lists `dataset:` loops (a `recordset:` loop with the
  same uid no longer leaks into M19's planner input).
- **Diagnostics.** Invalid stored query → empty + `SF-GEN-0240` (`RecordSetQueries.invalidQueryWarning`, once per
  render). **New `SF-GEN-0241`** (`DiagnosticCodes.GEN_RECORD_TEMPLATE_MISSING`): dataset has no record template for
  the channel → empty. Own code rather than `SF-GEN-0210`, because a page whose only findings are `0210` is skipped
  entirely by `RenderPipeline`. Deleted/missing set → `SF-TPL-0112`. All catalogued in `docs/api.md` and the template
  developer guide (`0111`/`0140` rows amended).
- **Recursion guard.** The value form pushes the set onto the page's `RenderBudget` with `withTemplate(setUuid,
  "recordset:uid")`: a record template that renders its own set (directly, or through a record's reference editor, or
  via other sets) is an `SF-TPL-0135` cycle (a render-limit failure of the page, like an include cycle), and the depth
  limit applies. Every rendered record counts as a loop iteration, so `MAX_LOOP_ITERATIONS` bounds the value form as
  well as set loops.
- **Dependencies** recorded at render: the set, its dataset, and whatever the record templates read (merged from the
  nested renders). Planner edges are `M25.2.3`.
- **Snapshot:** record sets were already in it (`findSnapshot` loads every type); no change.
- **Prefix:** `AssetReferencePrefixes` maps `recordset` → `RECORD_SET` (`RECORD_SET_PREFIX`); `record_set` stays
  rejected.
- **CDL / validation.** `dataset "uid"` is valid when `assetTypes` is empty or names `RECORD` or `RECORD_SET`
  (`SF-CDL-0104` otherwise). `ContentValidator.validateDataset`: records are allowed when `assetTypes` is empty or
  names `RECORD`, sets when it names `RECORD_SET`; a set (or record) of another dataset is an `ERROR` `dataset`
  finding. `RecordDatasets.forProject` (the `RecordDatasetLookup`) answers for live sets too (both carry
  `payload.datasetRef`).
- **Preview warnings.** `PagePreview` gained `warnings` (the page's and every nested section's render warnings,
  de-duplicated) — before, preview dropped all render warnings; this is how "preview warning" for `SF-GEN-0240` is
  observable. Not exposed over REST (the preview endpoint returns HTML; no OpenAPI / `schema.d.ts` change).
- **Fix (pre-existing M24 gap, found here):** body sections, includes and catalog cards were rendered **without the
  page's locale** in both pipelines (M24.3.1 intended to propagate it), so a record set — or any language-dependent
  value — inside a section rendered unresolved. `GenerationRenderer.renderSection` and
  `PageRenderService.renderSectionTemplate` now apply `LocaleRenderScope` with the page's locale (no switcher hrefs in
  sections); the unused locale-less `GenerationRenderer.blockResolver` overload was removed. Section link URLs are
  unchanged.
- **Golden files** (stub fixture `GoldenRecordFixture`, shared by both corpora: `records.json` datasets gain optional
  `schema`, `recordTemplates{channel: source}` and `recordSets{uid: {uuid, displayName, query, deleted}}`):
  `render/recordset-value`, `render/recordset-loop-narrowing`, `render/recordset-reference-editor`,
  `render/recordset-l10n` (extra: M24 — a localizable field per locale in the record template, set query and loop
  `where` on it evaluated in the render language), `render-md/recordset-value-markdown`.
- **Deviation — task text `BlockResolver.renderRecordSet(UUID)`:** replaced by the data hooks above (see Design);
  same behaviour, one implementation instead of two.
- **Left for later:** planner edges and insight reasons (`M25.2.3`); a section's `CMS_LOCALES` items have no hrefs
  (as in preview); UI (`M25.5.x`).
- **Tests.** sf-template: `RecordSetRenderTest` (16: `0111` not raised, `0110`, `0140` folder on set/reference
  loops, `0141`/`0142` on save via `recordSetDataset`, restricted vs unrestricted reference loops, `$CMS_REF` on a
  set, dataset-loop query listing, invalid query → empty + `0240`, missing template → `0241`, deleted set → `0112`,
  dependencies incl. record-template reads, reference value/count/loop, render-time `0141` warnings, self-rendering
  set and a record referencing its own set → `0135`, `MAX_LOOP_ITERATIONS` for value form and loop),
  `RecordSetReferenceCdlTest` (3), the golden corpora. sf-domain: `RecordSetReferenceValidationTest` (3). sf-generate:
  `GenerationRendererRecordSetTest` (5: snapshot rendering incl. soft-deleted record, `0240`, `0241` + `0112`, a set in
  a section per locale, one index build across 30 concurrent renders), `RecordSetQueryEvaluatorGuardTest` (+1: the
  renderer and both set sources depend on `RecordSetQueries`). sf-app: `RecordSetRenderIntegrationTest` (3: FULL
  generation == preview bytes for value form, narrowed loop and reference editor; soft delete, record edit, query
  change and a record moved into the set, each generated and previewed identically; time travel to before all of
  them; schema change breaking the query → empty + `SF-GEN-0240` in generation (run `PARTIAL`) and in
  `PagePreview.warnings`; template save `0110`/`0140`/`0141`; `SF-CDL-0104`; a page pointing at a set of dataset
  `faq` → `422` with an `ERROR` `dataset` issue).
