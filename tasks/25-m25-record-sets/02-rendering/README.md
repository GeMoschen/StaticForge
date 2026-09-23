# Feature: Rendering — record templates, `recordset:` values and loops, incremental planning

**Spec:** Extends §13/§16.2 (templates per channel, OCTL instructions), §16.4 (reference resolution),
§16.5 (scopes), §18.2 (incremental planning), §19 (preview).

## Goal

Give datasets per-channel record templates, make `$CMS_VALUE(recordset:uid)$` and
`$CMS_VALUE(refEditor)$` render a set through them, make sets a `$CMS_FOR` source, and teach the planner
exactly which pages a record, set or record-template change affects.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-dataset-record-templates.md](001-dataset-record-templates.md) | `M25.1.1` |
| 2 | [002-octl-record-set-values-loops-and-references.md](002-octl-record-set-values-loops-and-references.md) | 1, `M25.1.2` |
| 3 | [003-incremental-planning-and-insight.md](003-incremental-planning-and-insight.md) | 2 |

## Feature exit criteria

- [ ] Datasets carry compiled per-channel record templates.
- [ ] All four render forms (value/loop × accessor/reference editor) produce identical output in preview
      and generation; golden files green.
- [ ] `BuildPlanner` rebuilds exactly the affected pages, with `M22` reasons.

## Dependencies

`M25.1.*`, `M19.3.2` (dataset loops, `AssetValueResolver.datasetRecords`, snapshot record index,
`DatasetLoopImpact`), `M16.2`/`M16.3.2` (cross-asset values, template reference rows), `M20` (compile
chain / cache — record templates are standalone, they cannot `$CMS_EXTENDS$`).
