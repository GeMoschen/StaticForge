---
id: M25.1.2
status: todo
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

- [ ] Unit tests: valid query; unknown field; render-scope reference rejected; unsortable field; negative
      limit; string literal containing a field name survives a rename untouched.
- [ ] Integration test: dataset `team` with sets A (`where "role == 'lead'"`, `sort "-joined"`) and B;
      schema renames `role → position` → one revision contains the dataset, the rewritten records and
      set A with `where "position == 'lead'"`.
- [ ] Removing `joined` from the schema → dataset save 200 with `brokenRecordSets` naming A; `find(A)`
      reports `queryValid: false`; rendering A yields empty output + warning.
- [ ] The evaluator is shared: an ArchUnit/grep-style test or code review note confirms the grid, render
      and planner call `RecordSetQueries`.

## Out of scope

- A set query editor UI (`M25.5.1`); query-aware planner edges (`M25.2.3` consumes `select`/`maySelect`).

## Notes / hazards

- Localizable fields (`M24`): `where`/`sort` on a localizable field evaluate against the render locale
  (generation fans out per locale) and against the default locale in the grid unless the grid passes a
  locale — same behaviour as `$CMS_FOR(dataset:…)$` today; document, don't invent a new rule.
