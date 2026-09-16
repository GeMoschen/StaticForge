---
id: M16.2.2
status: done
depends: [M16.2.1]
epic: m16-render-reference-foundations
feature: cross-asset-values
area: backend
---

# M16.2.2 — Snapshot + live `AssetValueResolver` implementations

## Context

Contexts are built in these places:
- Generation: `GenerationRenderer.render` (page context, meta `uid, uuid, displayName, path, revision, channel, projectKey`)
  and `renderSection` (section context).
- Preview: `PageRenderService` (~l.167 meta, ~l.205–260 resolvers).

Both already implement `UrlResolver` and `BlockResolver` over their data source:
`Snapshot.assetByUuid(uuid)` → `SnapshotAsset(uuid, assetId, type, uid, displayName, folderPath, payload, deleted)`
for generation, and live or time-travel `AssetVersion` lookups for preview. The asset-type mapping
helper `assetTypeForRef` is duplicated in `GenerationRenderer`, `PageRenderService` and
`TemplateServiceImpl.referenceResolver`.

## Goals

- Add `SnapshotAssetValueResolver` (sf-generate) over `Snapshot`. Add `LiveAssetValueResolver`
  (sf-domain, preview) over the version valid at the preview revision (live or time travel), using
  the same revision `PageRenderService` already renders at.
- Both build the "root value object" per asset type exactly as documented in `M16.2.1`. Put that
  mapping in **one** shared pure helper in sf-domain (e.g. `asset/content/AssetValueProjection`) that
  takes `(type, uid, displayName, payload)`, so generation and preview can never disagree. Deleted
  assets → `MissingNode`.
- Wire the resolvers into every `RenderContext` built for pages, sections, catalog cards and
  includes, in both pipelines.
- Deduplicate the three copies of `assetTypeForRef` into one sf-domain helper next to `FolderScope`
  (which already owns `navigationReferenceUid`). `M17`/`M19` will add prefixes there, so this becomes
  the single place to register a new prefix.
- Generation dependencies: the target UUID is already in `RenderedFile.dependencies()` through
  `noteReference`. Confirm `BuildPlanner.affectedPages` rebuilds the page when the *target* changes.
  Today that goes through reference rows written by generation. After `M16.3.3` it goes through
  rows valid at the revision; add a test either way.

## Acceptance criteria

- [x] Generation integration test: page A's template uses `$CMS_VALUE(page:b.headline)$`. Generating
      renders B's headline. Editing B and running INCREMENTAL rebuilds A.
- [x] Preview test: the same template in live preview shows B's current headline. Time-travel
      preview at an older revision shows B's headline as of that revision.
- [x] A soft-deleted target renders empty with a warning, consistent with §16.4 ("a soft-deleted
      target degrades to an empty render with a warning").
- [x] Media projection test: `$CMS_VALUE(media:logo.altText)$` and `.width` render.
- [x] One `assetTypeForRef` implementation remains (grep proves it); `GenerationRendererNavigationTest`
      and the navigation golden tests are green.
- [x] `./gradlew :server:sf-generate:test :server:sf-domain:test` green.

## Out of scope

- Writing reference rows on save (`M16.3.*`).
- New prefixes (`global:`, `dataset:`, `record:`).

## Notes / hazards

- Project scoping: resolve UUIDs only within the rendering project (`Snapshot` is per project; for
  live preview pass `projectId`). Never look up a UUID globally.
- Beware recursion: a value object never contains rendered output. Only raw payload JSON is
  exposed, so a cross-asset value cannot trigger another render.
- Payload exposure: `page` → `content` only. `nav`, `output` and `meta` stay hidden so internal
  payload structure doesn't become template API by accident.

### Implementation notes

- `AssetValueProjection` (sf-domain `asset/content`, pure): `project(type, uid, displayName, payload, deleted)` builds
  the root value object — `PAGE` → shallow copy of `payload.content`; `MEDIA` → `altText, caption, copyright, fileName,
  mimeType, sizeBytes, focalPoint` + `width, height, orientation, dominantColor` lifted from `payload.image` (blob hash,
  variants hidden); `PAGE_REFERENCE` → `label`; templates/folders → only `_meta`; always `_meta {uid, displayName}`;
  deleted → `MissingNode`. The stored payload is never mutated.
- `SnapshotAssetValueResolver` (sf-generate, one per `GenerationRenderer`/build, memoized per UUID in a
  `ConcurrentHashMap`) and `LiveAssetValueResolver` (sf-domain `preview`, one per page/section render, current version
  or `findAt(revision)`, project-scoped via `AssetRepository.findByProjectIdAndUuid`). Both also check the asset's type
  matches the accessor prefix. Wired into page and section contexts in both pipelines (includes, body sections and
  catalog cards all go through those two builders).
- `assetTypeForRef` now exists once: `AssetReferencePrefixes.assetTypeForRef` in `asset/folder` next to `FolderScope`;
  the copies in `GenerationRenderer`, `PageRenderService` and `TemplateServiceImpl.referenceResolver` are gone (grep
  shows only call sites plus the one definition).
- Soft-deleted target: preview resolves the reference through the (persisting) `Asset` row and renders empty (the
  `SF-TPL-0112` warning is produced but preview discards render warnings, as before). Generation renders empty with
  `SF-TPL-0112` (run `PARTIAL`) whenever the snapshot contains the deleted version — i.e. runs pinned to a revision
  (`findSnapshot` includes deleted versions). ~~**Hazard, unchanged here:** an unpinned run's current snapshot
  (`findCurrentSnapshot`) omits deleted assets, so a *page* template referencing a deleted asset still fails VALIDATE
  with `SF-TPL-0110`, exactly like `$CMS_REF`/`$CMS_INCLUDE` today.~~ **Fixed in `M16.6.1`:** `SnapshotService` pins
  an unpinned run to the project's head revision (`RevisionRepository.findHeadRevisionId`, previously the max
  `validFromRevision` of the live versions, which also ignored tombstone/channel revisions) and loads it with the same
  `findSnapshot` query, deleted versions included. Consumers audited: `Snapshot.pages()`, `SnapshotNavigationLookup`
  and the section-template lookup already skipped deleted assets; now also `BuildPlanner.plan` (a deleted page is still
  walked for its referrers but never planned), `AssetCopyStage` (deleted media are not copied),
  `GenerationRenderer.templateOf`/`OutputPathResolver.templateOf` (a deleted page template counts as missing, as
  before), and the uid index prefers a live asset over a deleted one sharing the uid. `$CMS_REF` to a deleted
  page/media/folder, `$CMS_INCLUDE` of a deleted section template and body/catalog sections of a deleted template
  render empty with the spec §16.4 warning **`SF-GEN-0220`** (`GenerationDiagnosticCodes.GEN_DELETED_REFERENCE`, once per
  target per page); values keep `SF-TPL-0112`. Test: `CrossAssetValueIntegrationTest.unpinnedRunsTreatSoftDeletedTargetsLikeAPinnedRun`
  (unpinned INCREMENTAL after deleting page B and an included section template: A rebuilt as `A[||]`, run `PARTIAL`
  with both warnings and no errors, revision = head; a FULL run does not publish B). Verified failing with the old
  `findCurrentSnapshot` path.
- BuildPlanner: the incremental rebuild is proven on observable behaviour only (A's output in the INCREMENTAL run's
  build dir carries B's new headline), independent of how reference rows are written.
- Tests: `AssetValueProjectionTest` (sf-domain, 4), `GenerationRendererCrossAssetValueTest` (sf-generate, 2: page +
  included section values, `_meta`, loop, condition, `media:logo.altText`/`.width`, deleted → empty + `SF-TPL-0112`),
  `CrossAssetValueIntegrationTest` (sf-app: FULL renders B's headline in A; edit B → INCREMENTAL rebuilds A; live
  preview shows the current and time-travel preview the older headline; soft-deleted target → empty in preview and in
  a pinned run with the warning).
