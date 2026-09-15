---
id: M16.3.1
status: todo
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

- [ ] Page save with a media value → one open `MEDIA_REF` row. Saving it again with the media removed
      → that row is closed at the new revision and no open row remains.
- [ ] Page create → open `TEMPLATE` row to its page template. Adding a section → `TEMPLATE` row to
      the section template (`source_path` `bodies.<name>[i].templateRef`). Catalog card → `CONTENT_REF`
      as today.
- [ ] Soft delete closes all outgoing rows. Asset restore (`AssetServiceImpl.restore`) and project
      restore (`ProjectRestoreService`) re-open the edge set derived from the restored payload.
- [ ] Import (`ProjectExportImportServiceImpl`) writes edges for every imported asset in the import's
      revision.
- [ ] A compound revision (`M15` project creation, template rename cascade) that rewrites N page
      payloads writes N edge sets in that one revision.
- [ ] `ContentReferenceServiceTest` is adapted to the pure `extract` + persisting split. The guard
      test is in place.
- [ ] `./gradlew :server:sf-domain:test` green; `RevisionInvariantsTest` green.

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
