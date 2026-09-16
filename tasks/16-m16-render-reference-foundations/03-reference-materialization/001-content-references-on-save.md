---
id: M16.3.1
status: done
depends: []
epic: m16-render-reference-foundations
feature: reference-materialization
area: backend
---

# M16.3.1 — Content + template-usage references written on save, previous rows closed

## Context

These classes insert `AssetVersion` rows today (grep for `setValidToRevision`):
- `AssetServiceImpl`: `close` + `insertVersion` (~l.458–474), used by `createInternal`, `update`,
  `softDelete`, `restore`, `move`, `changeUid`
- `TemplateServiceImpl` (~l.408)
- `FolderServiceImpl` (~l.357)
- `ProjectExportImportServiceImpl` (~l.702)
- `ProjectRestoreService.restoreTo` (~l.72)

`PageServiceImpl.update` and the body/section operations delegate to `AssetServiceImpl.update`.
`ContentReferenceService.materialize` (`asset/content/ContentReferenceService.java`) scans a payload
and records:
- `MEDIA_REF` and `ASSET_REF` values
- internal / media `link` values
- catalog card `templateRef` (as `CONTENT_REF`)

It writes deduplicated rows but never closes old ones. Page → page-template (`payload.templateRef`)
and body section → section-template (`bodies.*[].templateRef`) edges are not written at all.
`BuildPlanner.indexPages` derives them from payloads, and `ReferenceKind.TEMPLATE` is unused.

## Goals

- Add `asset/reference/ReferenceMaterializer` (sf-domain, `@RevisionAware`, so it may save).
  Its method `replaceOutgoing(long projectId, long fromAssetId, long revisionId, AssetType type, JsonNode payload)`:
  1. closes every open row `from_asset_id = fromAssetId AND valid_to_revision IS NULL` with
     `valid_to_revision = revisionId`;
  2. computes the new edge set from the payload (content refs via `ContentReferenceService`'s scanner,
     refactored into a pure `extract(...)` + a persisting wrapper, plus `TEMPLATE` edges for
     `templateRef` and body section `templateRef`s);
  3. inserts the new rows with `valid_from_revision = revisionId`.
  - If the edge set is unchanged, it may keep the open rows untouched. This is an optimization;
    document the choice.
  - Soft delete closes all outgoing rows and inserts none.
  - Rows closed and inserted in the same revision are removed instead, so compound revisions
    (`M15`) that touch an asset twice don't leave zero-length intervals.
- Call it from **every** version-writing path listed in Context, inside the same transaction and
  with the revision returned by `allocate`/`allocateOrJoin`.
- Decide and document whether to add `ReferenceKind.NAV` (spec §5.4) for `PAGE_REFERENCE` → page
  edges (`PageReferenceServiceImpl`), or keep them as `CONTENT_REF`. Recommended: add `NAV`. It lets
  `M22` explain "rebuilt because navigation changed" without re-deriving the edge's meaning.
- Add a guard test (ArchUnit or a reflective integration test) that fails if a class calls
  `AssetVersionRepository.save` for a payload-carrying version without calling `ReferenceMaterializer`.
  An allow-list for folder-only moves is acceptable.

## Acceptance criteria

- [x] Page save with a media value → one open `MEDIA_REF` row. Saving it again with the media removed
      → that row is closed at the new revision and no open row remains.
- [x] Page create → open `TEMPLATE` row to its page template. Adding a section → `TEMPLATE` row to
      the section template (`source_path` `bodies.<name>[i].templateRef`). Catalog card → `CONTENT_REF`
      as today.
- [x] Soft delete closes all outgoing rows. Asset restore (`AssetServiceImpl.restore`) and project
      restore (`ProjectRestoreService`) re-open the edge set derived from the restored payload.
- [x] Import (`ProjectExportImportServiceImpl`) writes edges for every imported asset in the import's
      revision.
- [x] A compound revision (`M15` project creation, template rename cascade) that rewrites N page
      payloads writes N edge sets in that one revision.
- [x] `ContentReferenceServiceTest` is adapted to the pure `extract` + persisting split. The guard
      test is in place.
- [x] `./gradlew :server:sf-domain:test` green; `RevisionInvariantsTest` green.

## Out of scope

- OCTL references from template channel sources (`M16.3.2`).
- Switching readers (usages, delete guard, `BuildPlanner`) to revision-aware queries, and removing
  generation's inserts (`M16.3.3`).
- A broken-link report.

## Notes / hazards

- `ContentReferenceService.materialize` currently resolves each UUID with
  `assets.findByProjectIdAndUuid`, one query per reference. On a large compound import, batch the
  lookup (one `findByProjectIdAndUuidIn`) to avoid N+1.
- Dangling UUIDs (target not found) are skipped today. Keep that. The broken-link report is a
  separate concern.
- Until `M16.3.3` lands, generation still inserts its own rows alongside these. That is harmless for
  correctness (readers over-approximate) but adds duplicates. Land `M16.3.3` soon after.

### Implementation notes

- `asset/reference/ReferenceMaterializer` (`@RevisionAware`) with `replaceOutgoing(...)`,
  `closeOutgoing(...)`, a convenience `materialize(Asset, AssetVersion)` (deleted version → close)
  and a no-write `extract(projectId, type, payload)` returning resolved `ReferenceEdge`s. Edges per
  type: `PAGE` → `TEMPLATE` (`templateRef`, `bodies.<name>[i].templateRef`) + content refs rooted at
  `content` / `bodies.<name>[i].content`; `PAGE_REFERENCE` → `NAV` (`target`); `MEDIA`/`FOLDER` →
  none; templates → none yet (M16.3.2). The `switch` is exhaustive over `AssetType`, so a new type
  must decide its edges.
- **Per-edge diff instead of close-all/insert-all** (the documented optimization): unchanged edges
  keep their open row, removed edges are closed (or deleted when opened in the same revision),
  new edges are inserted — and an edge closed earlier in the *same* revision is re-opened instead
  of duplicated. Folder moves and other payload-neutral writes therefore write no reference rows.
- **`NAV` added** to `ReferenceKind` for `PAGE_REFERENCE` → target edges (`M22` can say "navigation
  changed" without re-deriving). `CONTENT_REF` stays for content links and catalog cards.
- `ContentReferenceService` split into a pure `extract(content, rootPath)` (new `ExtractedReference`
  record) and the persisting `materialize` wrapper (still used by generation until M16.3.3). Target
  UUIDs are resolved with one `AssetRepository.findByProjectIdAndUuidIn` per asset write (no N+1).
- Wired into every version writer: `AssetServiceImpl` (create/update/softDelete/restore/move via its
  `insertVersion`), `FolderServiceImpl` (subtree move/delete), `TemplateServiceImpl` (editor-rename
  cascade, template folder migration), `ChannelServiceImpl.seedFrom` (not listed in Context but writes
  template versions), `ProjectExportImportServiceImpl` and `ProjectRestoreService`. Import and project
  restore materialize in a second pass after all versions are written, so edges resolve against the
  finished project state.
- Guard: `ReferenceMaterializationGuardTest` (ArchUnit 1.3.0, new `libs.archunit` test dependency of
  sf-domain) — any class calling `save*` on `AssetVersionRepository`/`MediaVersionRepository` must
  depend on `ReferenceMaterializer`. Allow-list: `MediaServiceImpl` (only sets mime/size columns on the
  version `AssetService.create` just wrote). Verified it fails (5 violations) when pointed at a class
  the writers don't use.
- Tests: `ReferenceMaterializerTest`, `ContentReferenceServiceTest` (extract cases),
  `ReferenceMaterializationIntegrationTest` (sf-app: media add/remove, page/section/catalog edges, NAV,
  soft delete + asset restore + project restore, import revision, editor-rename cascade writing both
  pages' edge sets in the one batch revision). `sf-domain`, `sf-generate`, `sf-api`, `sf-app` test
  suites green (incl. `RevisionInvariantsTest`, `ConcurrentWritersTest`).
- Observed, not changed: `ProjectRestoreService.restoreTo` reads "current" via
  `findCurrentByProject`, which excludes deleted rows, so an asset whose open version is a tombstone
  is not closed before the restored row is inserted. Out of scope here; the integration test restores
  a payload edit rather than a delete for that reason.
