---
id: M25.1.2
status: done
depends: [M25.1.1]
epic: m25-record-sets
feature: domain
area: backend
---

# M25.1.2 — Stored set query: validation, evaluation, schema-rename rewrite, broken-query flags

## Context

`M19.3.1` built `DatasetQuery` / `DatasetQueryParser` / `DatasetQueryEvaluator` (`sf-template/.../query`);
the record grid already evaluates `RecordListQuery.where` over **bare field names**
(`RecordServiceImpl.list`). `DatasetServiceImpl.update` applies `renamedFrom` hops to every record in one
compound revision (`RecordRenameMigration`). Epic decision 3 is binding.

## Goals

- **Parse & validate** a set query on create/update against the dataset's compiled definition: `where`
  (bare fields; any reference to `CMS_PAGE`, `$CMS_SET` vars or an unknown root is `SF-TPL-0141`/`0140`),
  `sort` (`SF-TPL-0142` for unorderable editor types), `limit`/`offset` ≥ 0. Failure → `422` with
  diagnostics (line/column into the field), nothing written.
- **One evaluator entry point** `RecordSetQueries.select(records, query, locale)` used by preview,
  generation, the record grid "apply set query" mode and the planner (`maySelect`) — no second
  implementation. Order: `where` → `sort` (then `_displayName`, `_uid`) → `offset` → `limit`.
- **Schema rename:** when `DatasetServiceImpl.update` applies `renamedFrom`, rewrite the field names inside
  the `where`/`sort` of every current set of the dataset in the **same compound revision** (AST-based
  rewrite + re-print, not string replace — a field name can occur inside a string literal).
- **Removed/retyped field:** the dataset save succeeds; its response lists affected sets as warnings
  (`brokenRecordSets: [{uid, diagnostics}]`). A set whose stored query no longer validates is marked
  (`queryValid: false` in `RecordSetView`, computed on read against the current schema), renders empty
  with a new `SF-GEN-*` warning in generation and a preview warning — it is **never** rendered
  unfiltered. Re-saving the set with a valid query clears it.

## Acceptance criteria

- [x] Unit tests: valid query; unknown field; render-scope reference rejected; unsortable field; negative
      limit; string literal containing a field name survives a rename untouched.
- [x] Integration test: dataset `team` with sets A (`where "role == 'lead'"`, `sort "-joined"`) and B;
      schema renames `role → position` → one revision contains the dataset, the rewritten records and
      set A with `where "position == 'lead'"`.
- [ ] Removing `joined` from the schema → dataset save 200 with `brokenRecordSets` naming A; `find(A)`
      reports `queryValid: false`; rendering A yields empty output + warning.
- [x] The evaluator is shared: an ArchUnit/grep-style test or code review note confirms the grid, render
      and planner call `RecordSetQueries`.

## Out of scope

- A set query editor UI (`M25.5.1`); query-aware planner edges (`M25.2.3` consumes `select`/`maySelect`).

## Notes / hazards

- Localizable fields (`M24`): `where`/`sort` on a localizable field evaluate against the render locale
  (generation fans out per locale) and against the default locale in the grid unless the grid passes a
  locale — same behaviour as `$CMS_FOR(dataset:…)$` today; document, don't invent a new rule.

## Implementation notes (2026-09-23)

- **Shared entry point: `template.query.RecordSetQueries` (sf-template)**, next to `DatasetQueryEvaluator`, so
  sf-domain (grid, preview, `PageRenderService`) and sf-generate (renderer, planner) reach the same code — the
  module layering allows no other place.
  - `compile(RecordSetQuery, ContentDefinition) → Compiled{source, query, diagnostics}` (`valid()`), and
    `isValid(query, definition)` — the cheap "is this set broken?" check for `M25.2.2`. A `null` definition
    checks the grammar only.
  - `select(records, compiled, localeChain)` — `where` → `sort` (then `_displayName`, `_uid`) → `offset` →
    `limit`; records are resolved for the chain first and strings collate in its first language (the
    `$CMS_FOR(dataset:…)$` rule of M24.3.3). An **invalid query selects nothing**. The overload
    `select(records, compiled, chain, narrowing, scope)` implements decision 5 (a loop's / the grid's `where` is
    AND-ed, a non-empty `sort` re-sorts stably — ties keep the set's order —, `offset`/`limit` slice the set's
    result) so `M25.2.2`'s loop narrowing and the grid share it.
  - `count(records, compiled, chain)` (match count before slicing), `maySelect(record, compiled, narrowing,
    localeChains)` for `M25.2.3` — true when the set's `where` (and the narrowing, when given) passes for at
    least one of the project's locale chains (empty list: project without languages); `false` for an invalid
    query.
  - `rename(query, Map<from, to>)` — rewrites accessor roots on the parsed `where` and re-prints it with the new
    `OctlExpressions.print(Expr)` (the inverse of `parse`, round-trip tested); sort keys are rewritten per key.
    String literals, paths below the root, filters, asset references and meta fields are untouched; an
    unparsable part is left as is; nothing renamed → the same instance.
  - `invalidQueryWarning(setUid, compiled)` — the render warning `M25.2.2` emits.
- **Validation rules** (epic decision 3): `where` over bare fields; any `CMS_*` root (`CMS_PAGE`,
  `CMS_PAGINATION`, `CMS_LOCALES`, …) and asset references (incl. the `CMS_GLOBAL.x` shorthand) are
  `SF-TPL-0140`; any other root that is not a declared editor or meta field — a `$CMS_SET` variable included — is
  `SF-TPL-0141`; `sort` unknown field `0141`, unorderable editor `0142`, malformed `0140`; negative
  `limit`/`offset` `0140`. Findings are `RecordSetQueryDiagnostic{field, severity, code, message, line, column}`
  with the position **inside the field's text** (1-based; parser column for syntax errors, a best-effort scan
  that skips string literals and `||` for field roots — the AST has no positions; `0` for `limit`/`offset`).
- **Save:** `RecordSetServiceImpl.validatedQuery` (create and update) checks against the dataset's current
  schema; failure is `422 SF-API-0422` with `diagnostics` (the list above) before any revision is allocated.
- **Read:** `RecordSetView` gained `queryValid` + `queryDiagnostics`, computed on every read (`find`, `list`,
  create/update responses) against the dataset schema **of the same revision** (current for current reads —
  a time-travel read checks against the schema of that revision, so an old revision of a set that was valid
  then reads as valid).
- **Schema rename:** new `RecordSetQueryMigration.migrate` (called from `DatasetServiceImpl.update` inside the
  existing batch, *before* `RecordRenameMigration`, which clears the persistence context) rewrites every current
  set of the dataset whose query changes, via `AssetService.update` in the batch revision — one revision holds
  the dataset, the rewritten sets and the rewritten records. Sets whose query doesn't mention a renamed field are
  not written.
- **Removed/retyped field:** the save succeeds; `DatasetView.brokenRecordSets` (`BrokenRecordSet{uuid, uid,
  displayName, diagnostics}`) lists every current set of the dataset whose query doesn't validate against the
  saved schema (`RecordSetQueryMigration.brokenSets`). Filled on the update response only (empty on
  create/find/list — a set's own view carries its state). The stored query is kept untouched; re-saving the set
  with a valid query clears the flag.
- **Record grid:** `RecordSetService.listRecords(projectId, setUuid, RecordListQuery, applySetQuery, locale,
  page, size)` — the set's live records (new `AssetVersionRepository.findCurrentRecordsOfSet`); with
  `applySetQuery` the stored query runs first and the request's `where`/`sort` narrow it (decision 5; without a
  request sort the set's order is kept), `q` filters display names last so it never shifts the set's
  `offset`/`limit` window; without it the grid lists every record of the set (default order), both through
  `RecordSetQueries.select` (the "all" query in the second case). A broken set lists nothing in apply mode.
  `folder` is ignored (the set is the scope). Language-dependent values compare in `locale`'s chain, the
  project default language's when `null`; rows show stored values like the dataset grid. The grid's request
  parsing and paging moved from `RecordServiceImpl` into the package-private `RecordGrid`, shared by both
  listings (dataset listing behaviour unchanged).
- **Preview:** `RecordSetService.previewQuery(projectId, setUuid, draft) → RecordSetQueryPreview{valid,
  diagnostics, matchCount, selectedCount}` (matchCount = `where` matches before slicing, selectedCount = what the
  set would show; default language) — `M25.3.1` exposes it as `POST /record-sets/{uuid}/preview-query`.
- **New diagnostic code:** `SF-GEN-0240` (`DiagnosticCodes.GEN_RECORD_SET_QUERY_INVALID`, in sf-template because
  preview in sf-domain raises it too), catalogued in `docs/api.md` and the template developer guide. Raised by
  `M25.2.2`'s renderer through `RecordSetQueries.invalidQueryWarning`.
- **Deviation — `RecordSetQuery` moved** from `asset.dataset` (sf-domain) to `template.query` (sf-template): the
  shared evaluator and the renderer in sf-template must read the stored query, and sf-template cannot depend on
  sf-domain. Imports updated (`RecordSetFixtures`, `RecordSetIntegrationTest`, `RecordSetContainmentTest`).
- **Deviation — "rendering A yields empty output + warning"** can't be exercised yet: `recordset:` rendering is
  `M25.2.2`. What this task proves: an invalid compiled query selects nothing (`RecordSetQueriesTest`), the grid
  in apply mode lists nothing for the broken set, the warning factory yields `SF-GEN-0240`
  (`RecordSetQueriesTest`). `M25.2.2` must add the render assertion (empty output + `SF-GEN-0240`, generation
  and preview).
- **Shared-evaluator guard:** `RecordSetQueryEvaluatorGuardTest` (sf-generate, ArchUnit — `archunit` added to
  sf-generate's test dependencies) fails when any class outside `template.query` calls `DatasetQueryEvaluator`
  other than the four dataset-level callers (`OctlRenderer` dataset loops, `RecordServiceImpl` dataset grid,
  `PaginationSource`, `DatasetLoopImpact`), and asserts the grid/preview (`RecordSetServiceImpl`) uses
  `RecordSetQueries`. Render (`M25.2.2`) and planner (`M25.2.3`) don't exist yet; the guard forces them through
  `RecordSetQueries` (verified: dropping an allow-list entry fails the test).
- Import (`M25.4.1`) writes set payloads without this validation; an imported set with a query that doesn't fit
  the target schema reads `queryValid: false` and renders nothing — no extra handling needed there.
- **No OpenAPI / `schema.d.ts` change** (REST exposure of `queryValid`, `brokenRecordSets`, `listRecords` and
  `previewQuery` is `M25.3.1`).
- **Tests:** `RecordSetQueriesTest` (sf-template, 24: validation incl. positions, render-scope/asset-reference/
  `$CMS_SET` rejection, unsortable, negative limit/offset; evaluation order, invalid → empty, narrowing, locale
  chains, `maySelect`; rename incl. string literal surviving, filters/paths/meta, unparsable; print round trip),
  `RecordSetQueryIntegrationTest` (sf-app, 5: 422 with diagnostics and no revision; `role → position` rename in
  one revision with set A rewritten and B untouched; removing `joined` → `brokenRecordSets` [A],
  `queryValid:false` on find/list, time travel valid, apply-mode grid empty, re-save clears; grid narrowing/q/
  paging; preview counts without writing), `RecordSetQueryEvaluatorGuardTest` (sf-generate, 2).
