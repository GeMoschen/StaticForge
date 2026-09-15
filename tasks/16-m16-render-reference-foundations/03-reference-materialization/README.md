# Feature: Reference materialization

**Spec:** Implements §5.4 (reference integrity: "`asset_reference` materializes the outgoing edges
of each **asset version**") and the §18.2 incremental rule ("reverse edges define what to rebuild").

## Goal

`asset_reference` should be maintained on the write path, not reconstructed by generation.

**Today:**
- `ContentReferenceService.materialize(projectId, fromAssetId, validFromRevision, content)` has one
  caller: `GenerationService.materializeReferences` (~l.411). That method also inserts one
  `MEDIA_REF` / `OCTL_REF` row per render dependency, with `validFromRevision = snapshot.revision`
  and an empty `source_path`.
- Rows are never closed (`AssetReference.setValidToRevision` has no caller), and each run
  inserts again.
- `AssetReferenceRepository` only has `findByToAssetId` / `findByFromAssetId`, with no revision
  filter.
- Consumers:
  - `AssetServiceImpl.softDelete` (~l.232) refuses deletion if any row exists, stale or not.
  - `AssetServiceImpl.usages` (~l.332) filters `validToRevision == null`, which is every row.
  - `BuildPlanner.affectedPages` (~l.138) walks every row ever written.
- Template OCTL references (`CompiledTemplate.references()`) are never persisted.
- Page → template and section → template edges are rebuilt from payloads inside `BuildPlanner.indexPages`.

**After this feature:**
- Every version write that carries a payload writes that version's outgoing edges in the same
  transaction and revision, and closes the previous version's edges.
- Template saves persist OCTL edges.
- Readers query "edges valid at revision R".
- The graph is then complete **transitively**: page → template (`TEMPLATE`), template → target
  (`OCTL_REF` / `OCTL_VALUE` / `OCTL_INCLUDE`), page → media/page (`CONTENT_REF` / `MEDIA_REF`).
  Generation no longer needs to record render dependencies to keep incremental builds correct.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-content-references-on-save.md](001-content-references-on-save.md) | — |
| 2 | [002-template-references-on-save.md](002-template-references-on-save.md) | 1 |
| 3 | [003-revision-aware-reference-queries.md](003-revision-aware-reference-queries.md) | 1, 2 |

## Feature exit criteria

- [ ] One `ReferenceMaterializer` is called from every code path that inserts an `AssetVersion` with
      a payload: create, update, restore, move/rename when the payload changes, import and project
      restore. A test or ArchUnit rule guards against a new write path skipping it.
- [ ] Reference rows follow version intervals: at most one open edge set per asset, and closed rows
      carry `valid_to_revision`.
- [ ] Usages, the delete guard and `BuildPlanner` query edges valid at a revision. Generation no
      longer writes rows. Legacy duplicate rows are cleaned up.
- [ ] `RevisionInvariantsTest` extends its invariants to reference rows: for every revision and
      asset, the edges valid at R equal the edges derived from the payload valid at R.

## Dependencies

`M1:revision` (version intervals, `RevisionContext`), `M15` (compound revisions:
`RevisionService.allocateOrJoin`; reference writes join the open revision), `M4:generation`
(`BuildPlanner`, `GenerationService`), `M11`/`M14` (import write path).
