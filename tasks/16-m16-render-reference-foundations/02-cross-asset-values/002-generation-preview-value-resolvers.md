---
id: M16.2.2
status: todo
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

- [ ] Generation integration test: page A's template uses `$CMS_VALUE(page:b.headline)$`. Generating
      renders B's headline. Editing B and running INCREMENTAL rebuilds A.
- [ ] Preview test: the same template in live preview shows B's current headline. Time-travel
      preview at an older revision shows B's headline as of that revision.
- [ ] A soft-deleted target renders empty with a warning, consistent with §16.4 ("a soft-deleted
      target degrades to an empty render with a warning").
- [ ] Media projection test: `$CMS_VALUE(media:logo.altText)$` and `.width` render.
- [ ] One `assetTypeForRef` implementation remains (grep proves it); `GenerationRendererNavigationTest`
      and the navigation golden tests are green.
- [ ] `./gradlew :server:sf-generate:test :server:sf-domain:test` green.

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
