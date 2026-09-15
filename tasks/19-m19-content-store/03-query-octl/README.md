# Feature: Query model + OCTL integration

**Spec:** Extends §16.2 (`$CMS_FOR` sources), §16.4 (reference syntax — `dataset:uid`,
`record:uid`), §16.5 (loop scope), §16.9 (expression grammar reused for `where`), §16.11
(diagnostics), §18.2 (incremental planning), §25.4 (golden-file tests). Resolves Appendix C Q7.

## Goal

1. A **pure, engine-level query model** (`sf-template`, no Spring, no DB): parse and validate
   `where` / `sort` / `limit` / `offset` / `folder` at compile time, apply them to a list of record
   views at render time. Shared by OCTL rendering (generation + preview), the REST listing
   (`M19.2.1`) and later pagination (`M21.2.1`).
2. **OCTL integration:** `$CMS_FOR(x : dataset:uid, …)$`, `$CMS_VALUE(record:uid.field)$`, and
   dereferencing `reference` editor values that point at records — implemented for both
   `GenerationRenderer` (snapshot) and `PageRenderService` (live), with dependency edges that make
   incremental builds correct.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-dataset-query-model.md](001-dataset-query-model.md) | — |
| 2 | [002-octl-dataset-loops-and-record-values.md](002-octl-dataset-loops-and-record-values.md) | 1, `M19.1.2`, `M16.2.2`, `M16.3.2` |

## Feature exit criteria

- [ ] `DatasetQuery` parse/validate/apply is unit-tested in isolation (operators, types, nulls,
      stable multi-key sort, limit/offset bounds).
- [ ] Dataset loops and record values render identically in generation and preview, backed by
      golden-file cases.
- [ ] `BuildPlanner` rebuilds pages depending on a changed record (directly or via its dataset).

## Dependencies

`M16.2.2` (cross-asset value resolution in both render paths), `M16.3.2` (template OCTL references
written on template save), `M16.1.1` (compile cache — query args are compiled once), `M19.1.2`.
