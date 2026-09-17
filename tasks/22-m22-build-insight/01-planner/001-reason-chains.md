---
id: M22.1.1
status: done
depends: [M16.3.3, M22.4.1]
epic: m22-build-insight
feature: planner
area: backend
---

# M22.1.1 — Reason chains in `BuildPlanner` (+ §18.2 navigation rule)

## Context

`server/sf-generate/src/main/java/com/acme/staticforge/generate/plan/BuildPlanner.java`:

- `plan(snapshot, mode, lastSuccessfulRevision, channels, scopeFolderPath, scopeAssetUuids, paths)`
  is incremental only when `mode == INCREMENTAL && lastSuccessfulRevision != null`.
  Otherwise it silently plans FULL.
- `changedAssets` maps `AssetVersionRepository.findAssetIdsChangedSince(projectId, since)`
  to UUIDs.
- `affectedPages` walks a BFS over asset ids:
  - `PAGE` adds itself.
  - `PAGE_TEMPLATE` / `SECTION_TEMPLATE` add pages from payload indexes (`indexPages`).
  - Every asset follows `references.findByToAssetId(id)`.
- `inScope` filters by `folderPath`/`assetUuids`.

The result is `BuildPlan(incremental, revision, entries, changedAssets)`, with no
reasons. The navigation rule of §18.2 is missing: a navigation change reaches only pages
that happen to have a reference row to the changed asset itself.

## Goals

- **Reason model** (sf-generate, `generate.plan`; records, serializable by name):
  - `RebuildRootKind`:
    - `FULL_BUILD` (mode FULL)
    - `INCREMENTAL_FALLBACK_FULL` (INCREMENTAL requested but no usable baseline; carries
      the fallback cause recorded by the per-target baseline rule from `M22.4.1`, e.g.
      `NO_COMPLETE_BUILD_FOR_TARGET`, `BASE_BUILD_MISSING`)
    - `EXPLICIT_SCOPE` (asset explicitly listed in `assetUuids` during a scoped FULL)
    - `ASSET_CHANGED`
    - `ASSET_DELETED`
  - `RebuildEdgeKind`:
    - `PAGE_TEMPLATE` (payload `templateRef`)
    - `SECTION_TEMPLATE` (payload `bodies.<body>[i].templateRef`)
    - `REFERENCE` (qualified by `ReferenceKind` and `source_path`)
    - `NAVIGATION`
  - `RebuildStep(assetUuid, assetType, uid, edge, referenceKind?, sourcePath?)`
  - `RebuildReason(rootKind, rootAssetUuid?, rootRevision?, steps)`. `steps` is ordered
    from the entry's asset back to the root. Empty for non-change roots.
  - `BuildPlan` gains `Map<PlanEntryKey, RebuildReason>`, or `PlanEntry` gains a
    `reason`. Pick one and keep `PlanEntry` usable as a key.
  - Entries are identified by `(assetUuid, channel, outputPath)` so later non-page
    entries (`M18` processed media, `M21` paginated pages) fit without a model change.
- **Extract expansion** into one component (working name `RebuildExpansion`):
  - Input: snapshot + seed assets. Output: affected entry assets + a parent-pointer map
    `assetId → (parentAssetId, edge)`.
  - Called by `BuildPlanner` here and by the impact endpoint (`M22.2.2`) later. No
    second copy.
- **Shortest, deterministic chains:**
  - Seed the frontier in a stable order (UUID order, same as `sorted(...)`).
  - Keep the first parent recorded (BFS distance order).
  - Iterate `findByToAssetId` results in a stable order (by `fromAssetId`, then kind,
    then `sourcePath`).
  - Record `rootRevision` from the version that opened after the baseline. Add a
    repository method returning `(assetId, validFromRevision)` pairs instead of bare ids
    if needed. For deleted assets, use the root kind `ASSET_DELETED`.
- **Count all causes:** each change-driven reason also carries `causeCount`, the
  number of distinct changed roots that reach the entry. The UI can then say "and 3
  other changes" without storing every chain.
- **§18.2 navigation rule:**
  - A navigation-affecting change expands to every page that renders that navigation
    structure, with edge `NAVIGATION`.
  - Navigation-affecting changes are: a `FOLDER` in the `NAVIGATION` scope or a
    `PAGE_REFERENCE` created, moved, deleted or relabelled; or a `PAGE` whose
    `displayName`, `uid` or output path changed and that is the target of a
    `PAGE_REFERENCE` (labels and hrefs fall back to it).
  - "Renders that structure" is defined via the pages' render-dependency reference rows
    to navigation folders (after `M16.3.*`) plus the changed asset's navigation-folder
    ancestry.
  - Document the chosen definition in the class Javadoc.
- **Unit tests** (`BuildPlannerTest` / new `RebuildExpansionTest`):
  - FULL
  - fallback FULL
  - explicit scope
  - page changed (chain length 0)
  - section template → page
  - media → page via `MEDIA_REF`
  - two-hop chain
  - two roots reaching one page (shortest chain wins, `causeCount == 2`)
  - deleted asset
  - navigation rule
  - determinism (plan twice ⇒ equal reasons)

## Acceptance criteria

- [x] Every entry in every `BuildPlan` has a non-null `RebuildReason`.
- [x] Change-driven reasons are the shortest chain, deterministic across repeated
      planning of the same snapshot/baseline (asserted by test).
- [x] Deleted roots and fallback-to-FULL are reported as their own root kinds, not as
      `FULL_BUILD`.
- [x] The navigation rule expands a relabelled `PAGE_REFERENCE` to every page rendering
      its navigation root, with edge `NAVIGATION`; covered by a test.
- [x] The expansion lives in exactly one class used by `BuildPlanner`; no BFS remains
      inline in `BuildPlanner`.
- [x] Existing planner/generation tests pass unchanged apart from the added reason
      assertions; the set of planned entries is identical to before for every existing
      test, except where the navigation rule legitimately adds pages.
- [x] `./gradlew :server:sf-generate:test` green.

## Out of scope

- Persisting reasons (`M22.1.2`), REST exposure (`M22.2.*`), UI (`M22.3.*`).
- Edge kinds for `M17`–`M21` asset types (`DATASET_MEMBERSHIP`, `PARENT_TEMPLATE`,
  `PAGINATION_SOURCE`, …). Those epics add them; leave a Javadoc note on the enum.
- Per-target baselines and carrying forward unchanged output. `M22.4.1` does these
  first; this task consumes its fallback cause.

## Notes / hazards

- Don't change the expansion's *results* while adding reasons, apart from the navigation
  rule. Start by adding parent-pointer recording to the existing traversal, prove the
  entry set is unchanged, then extract.
- The payload index edges (`PAGE_TEMPLATE`, `SECTION_TEMPLATE`) are not reference rows.
  Keep them as explicit edge kinds so the chain shows the JSON path, e.g.
  `bodies.main[2].templateRef`. Record the body name and index while indexing.
- Section instances inside a `catalog` editor reach the page via `CONTENT_REF` rows
  (`ContentReferenceService` uses `.templateRef` as `source_path`), not via
  `indexPages`. Test that the chain shows it.
- Memory: parent pointers are one entry per visited asset, not per page × channel.
  Keep them keyed by asset id; don't copy chains per entry.
- The navigation rule can make a small edit rebuild the whole site. That is correct
  per §18.2, and exactly what this epic is meant to make visible. Don't "optimize"
  it away here.
