# M22 — Incremental build insight

**Spec:** Extends §18.2 (PLAN stage — incremental expansion over `asset_reference`
reverse edges, including the "navigation-affecting changes expand to all pages that
render that structure" rule that is not implemented today), §18.5 (generation run
record), §20.2 (REST API — generation endpoints) and §24 (generation UX). Not part of the
original §27 roadmap; inserted the same way `M8`–`M15` were.

## Goal

An incremental build today is a black box. `BuildPlanner.plan` computes a set of
changed assets (`changedAssets` → `AssetVersionRepository.findAssetIdsChangedSince`),
expands it with a breadth-first walk (`affectedPages`: payload `templateRef` /
`bodies.*[].templateRef` indexes plus `asset_reference` reverse edges), and returns a
flat `BuildPlan(incremental, revision, entries, changedAssets)`. The *reason* a page
landed in the plan is thrown away the moment the BFS finishes, nothing about the plan is
stored on the `GenerationRun`, and there is no way to see what a build *would* do before
starting it. When a one-line media change rebuilds 3,000 pages, nobody can tell why.

This milestone makes every build explainable, before and after the fact:

1. **Reason chains.** For every plan entry the planner records the shortest chain from
   the entry back to the change that caused it, e.g.
   `page:about ← section_template:teaser (bodies.main[2].templateRef) ← media:hero (changed in rev 1842)`.
   A FULL build, or an incremental request that falls back to FULL, records that fact
   as its root reason instead of a chain.
2. **Stored per run.** The plan and its reason chains are persisted with each
   `GenerationRun`, so a past run can still be explained after later edits.
3. **Dry run.** `POST /generations/plan` returns the exact plan a real run started with
   the same request would produce, without rendering, writing, or taking the per-project
   run lock. The generation dialog shows it before the user presses *Generate*.
4. **Asset impact.** `GET /assets/{uuid}/impact` answers the reverse question for any
   asset: "if this changes, which pages rebuild, and through what path?"

It also fixes incremental-build correctness gaps found while planning. Build insight
would otherwise explain wrong output: an incremental run publishes only the re-rendered
pages, the sitemap and search index are built from the partial plan, and the "last
successful revision" ignores the target.

## Exit criteria (epic is done when)

- [ ] Every plan entry (dry run and real run) carries a reason: a root kind
      (`FULL_BUILD`, `INCREMENTAL_FALLBACK_FULL`, `EXPLICIT_SCOPE`, `ASSET_CHANGED`,
      `ASSET_DELETED`, …) plus, for change-driven entries, the shortest ordered chain of
      edges back to the changed asset, including the change's revision.
- [ ] The §18.2 navigation rule is implemented and explained: a navigation-affecting
      change rebuilds every page that renders the affected navigation, with reason
      edge `NAVIGATION`.
- [ ] The plan (entries + reasons) is stored per `GenerationRun` and readable via
      `GET /generations/{runId}/plan` (paged, filterable by reason kind and channel)
      after the run finishes, including for FAILED runs that got past PLAN.
- [ ] `POST /generations/plan` returns the same entries and reasons that a real run
      started immediately afterwards with the same request produces. This is proven by
      an integration test comparing the two, not by inspection.
- [ ] `GET /assets/{uuid}/impact` lists the pages (× channels) that would rebuild if the
      asset changed, each with its chain, computed by the same expansion code the planner
      uses (one implementation, not a copy).
- [ ] UI: the generation dialog previews the plan (counts by reason, expandable chains,
      a visible warning when incremental falls back to full); run details show a
      "Rebuilt pages" tab; the template editor, media detail drawer and page editor show
      an "Impact" panel.
- [ ] Incremental runs publish a complete site: unchanged outputs from the previous
      successful build for the same target are carried forward, and sitemap and search
      index are built from the full site page list, not from the incremental plan.
- [ ] The incremental baseline ("last successful revision") is per target.
- [ ] The reason model is open for the asset types and edges added by `M17`–`M21`
      (global sets, processed media, datasets/records, parent templates, pagination
      sources). Each of those epics adds its reason edges by extending the model, not
      by changing it.
- [ ] `./gradlew build` and `ui` `npm run build` are green; affected `npm test` specs
      pass, or their failure is shown to be the known `templateUrl` tooling issue
      (see `M15` exit criteria).
- [ ] Performance: planning with reasons for the 5,000-page benchmark fixture adds
      < 10 % to the PLAN stage and stays within §18.6 incremental targets.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 4 | [incremental-correctness](04-incremental-correctness/README.md) | backend | — **(do first:** verified bug, incremental runs publish an incomplete site; the reason and dry-run work must not mask it) |
| 1 | [planner](01-planner/README.md) | backend | `M16.3.3` (revision-aware, correctly closed reference rows; reasons over stale edges would explain the wrong thing), 4 (baseline/fallback rule) |
| 2 | [api](02-api/README.md) | backend | 1, 4 |
| 3 | [ui](03-ui/README.md) | frontend | 2 |
| 5 | [docs-e2e](05-docs-e2e/README.md) | qa | 3, 4 |

Feature 4 keeps its number (skeleton IDs are binding) but is listed first because it
has no dependencies and everything else builds on it.

## Dependencies

- `M4:generation` (`GenerationService`, `BuildPlanner`, `SnapshotService`,
  `GenerationRun`, `GenerationController`, target writers).
- `M16:reference-materialization` (`M16.3.1`–`M16.3.3`): reference rows are written on
  save, closed when superseded, queried revision-aware, and generation no longer
  inserts them. **Hard dependency.** Today `BuildPlanner.affectedPages` follows
  `references.findByToAssetId(id)` with no revision filter over rows that are never
  closed and duplicated on every run, so reasons would be over-approximated and
  unreproducible.
- `M16:channel-path-settings` (`M16.4.1`): output paths in stored plans must match what
  generation writes. Soft; stored paths are whatever the resolver returns.

## Notes

- **Reason model extensibility (lights up later, no hard dependency):**

  | Epic | New reason content | How it plugs in |
  |---|---|---|
  | `M17` global store | `global_set:site` changed → pages reading `$CMS_GLOBAL.site…$` | an `OCTL_VALUE` reference edge; the UI label comes from the asset type |
  | `M18` parsable text media | a processed media file is itself a plan entry (not a page); its reason chain can start at a global set or page it references | entries are keyed by `(assetUuid, channel, outputPath)`, never by "page" only |
  | `M19` content store | `record:jane` changed → `dataset:team` membership → pages looping over the dataset | new edge kind `DATASET_MEMBERSHIP` |
  | `M20` template inheritance | `page_template:base` changed → child template → its pages | new edge kind `PARENT_TEMPLATE` (`TEMPLATE` reference rows child → parent) |
  | `M21` pagination | source folder/dataset changed → paginated page, all N entries | new edge kind `PAGINATION_SOURCE`; entries carry a page number |

  The enums (`RebuildRootKind`, `RebuildEdgeKind`) must be serialized by name and
  unknown names tolerated when reading, so a stored plan written by a later build still
  deserializes. Each later epic owns adding its edge kind and a planner unit test for
  it; this epic ships the kinds it can produce today plus the extension points.
- **Liquibase numbering:** the changelog directory
  (`server/sf-app/src/main/resources/db/changelog/v1.0/`) currently ends at
  `014-url-registry.xml`. `M16`–`M21` run first and may take the next numbers. Assign
  the number when the task is implemented, not now, and follow the paired
  `dbms="postgresql"` (JSONB) / `dbms="h2"` (JSON) changeset convention.
- **Incremental publish is broken today (found while planning).**
  `FilesystemTargetWriter.stage` writes only the files handed to it into a fresh
  `{root}/builds/{runId}/`, and `publish` flips `current` to it. An incremental run
  therefore publishes a site containing only the re-rendered pages plus the copied media.
  `S3TargetWriter` diffs against the previous manifest and may be less affected; verify
  during `M22.4.1`. This is in scope here (feature 4) because a "why was this rebuilt"
  view on top of a publish that drops every page not rebuilt would be misleading.
- **`lastRevision` ignores target, channels and scope.**
  `GenerationService.executeRun` takes `runs.findRecentSuccesses(projectId).findFirst()`.
  A scoped run (`folderPath`/`assetUuids`) or a run against another target moves the
  baseline for everything. Feature 4 makes the baseline per target and excludes
  scoped/channel-subset runs from it (or records coverage). The dry run must use the
  identical rule.
- Section templates rendered through `$CMS_INCLUDE` only reach a page via render
  dependencies (`OCTL_INCLUDE`/`OCTL_REF` rows). Once `M16.3.2` writes template→template
  include rows, the chain can show `page ← page_template:x ← (include) section_template:y`.
