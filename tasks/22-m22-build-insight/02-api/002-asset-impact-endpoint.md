---
id: M22.2.2
status: done
depends: [M22.1.1, M16.3.3]
epic: m22-build-insight
feature: api
area: backend
---

# M22.2.2 — `GET /assets/{uuid}/impact`

## Context

The only "who depends on this" view today is one hop inbound:
`AssetServiceImpl.usages()` → `AssetController.usages` (`GET /assets/{uuid}/usages`,
`UsageView(uuid, uid, type, kind, sourcePath)`). Its only UI consumer is
`ui/src/app/features/media/media-detail-drawer.component.ts`.

`UidChangeResult` lists templates that contain an old UID literally, but no pages.
After `M22.1.1`, `RebuildExpansion` turns seed assets into affected entry assets plus
parent pointers. That is exactly the transitive "impact" of a hypothetical change.

## Goals

- **`GET /api/v1/projects/{projectKey}/assets/{uuid}/impact`** (VIEWER):
  - Query: `channel?`, `page`, `size`, `q?`.
  - Seeds `RebuildExpansion` with the single asset against a snapshot at the current
    revision (`SnapshotService.snapshot(projectId, null)`).
  - Expands to entries over the project's enabled channels (or `channel`) and resolves
    output paths the same way generation does.
  - Response:
    `{asset:{uuid,type,uid}, revision, entryCount, pageCount, byFirstEdge, entries:{content:[PlanEntryView], page}}`,
    reusing `PlanEntryView` from `M22.2.1`, with root kind `ASSET_CHANGED` and root =
    the asset.
  - If the asset is a page, it is its own first entry (chain length 0).
  - If it is deleted or unknown: 404.
- **No duplicated walk:** `AssetServiceImpl.usages` stays one-hop inbound. Impact is a
  separate endpoint backed by `RebuildExpansion`. If module layering prevents
  `sf-api`/`sf-domain` from reaching the `sf-generate` planner, put the endpoint on a
  controller that may depend on `sf-generate` (as `GenerationController` does). Don't
  copy the BFS into `sf-domain`.
- **Tests:**
  - media referenced by 2 pages → 2 × channels entries with `MEDIA_REF` edges
  - section template → pages via `SECTION_TEMPLATE`
  - navigation page reference → all pages rendering that navigation (`NAVIGATION`)
  - unreferenced media → 0 entries
  - page → itself
  - cross-project 404
  - consistency: for a real edit to asset X, the entries of the next incremental dry
    run ⊇ `impact(X)` entries (equal when X is the only change)

## Acceptance criteria

- [x] Endpoint returns transitive affected entries with shortest chains for every
      asset type the planner knows today.
- [x] Implemented on top of `RebuildExpansion`; no second traversal implementation
      exists (reviewed; grep for BFS over `findByToAssetId`).
- [x] Consistency test with the dry run passes.
- [x] OpenAPI + `schema.d.ts` regenerated; `docs/api.md` updated.
- [x] `./gradlew build` green.

## Out of scope

- "Impact of a pending, unsaved edit" (diffing a draft payload). Impact is for the
  asset as a whole.
- UI (`M22.3.2`).
- Historical impact at a past revision (possible later via a `revision` param; not
  needed now).

## Notes / hazards

- Impact of a template or navigation root on a large site can be the whole site.
  Always page the result and return `entryCount` up front; never serialize 10,000
  chains in one response.
- Snapshot cost: a full snapshot per impact request is heavy. Measure it with the
  5,000-page fixture. If it's too slow for an interactive panel, add a
  project-and-revision keyed snapshot cache shared with the dry run in this task,
  documented and bounded (e.g. one entry per project, evicted on a new revision), and
  write the measurement here.
- Reference rows must be current (`M16.3.3`). Otherwise impact reflects the last
  generation run, not the current content.
