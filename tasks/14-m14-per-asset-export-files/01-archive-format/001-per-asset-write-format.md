---
id: M14.1.1
status: todo
depends: []
epic: m14-per-asset-export-files
feature: archive-format
area: backend
---

# M14.1.1 — Write one `assets/<uuid>.json` entry per exported asset

## Context

`ProjectExportImportServiceImpl.exportSelection` (`server/sf-domain/.../exportimport/`)
currently writes the entire computed `assets` list in one call:
`writeJson(zip, ASSETS_ENTRY, new ExportArchive(PROTOCOL_VERSION, assets))`, where
`ASSETS_ENTRY = "assets.json"` and `ExportArchive` is `record ExportArchive(int
protocolVersion, List<ExportedAsset> assets)`. This task replaces that one call with a
loop writing one entry per asset, under a new `assets/` prefix — mirroring the
`BLOBS_PREFIX = "blobs/"` convention this same method already uses for media blobs a
few lines later in the same loop.

## Goals

- Add `private static final String ASSETS_PREFIX = "assets/";` alongside the existing
  `MANIFEST_ENTRY`/`SETTINGS_ENTRY`/`BLOBS_PREFIX` constants.
- Replace the single `writeJson(zip, ASSETS_ENTRY, ...)` call with a loop over the
  already-sorted `assets` list, calling `writeJson(zip, ASSETS_PREFIX + asset.uuid() +
  ".json", asset)` for each — writing the bare `ExportedAsset`, not wrapped in
  `ExportArchive` (there's no longer an array to wrap; `protocolVersion` already lives
  in `manifest.json` and doesn't need repeating per asset file).
- Bump `PROTOCOL_VERSION` from 2 to 3 on the `ProjectExportImportService` interface.
- `ASSETS_ENTRY`/`ExportArchive` stay in the codebase — they're still needed to *read*
  pre-`M14` archives (`M14.2.1`) — this task only stops *writing* them.

## Acceptance criteria

- [ ] `exportSelection`/`exportProject` no longer write an `assets.json` entry.
- [ ] Every exported asset gets its own `assets/<uuid>.json` entry, content identical
      (field-for-field) to what it would have held as an `ExportArchive.assets()`
      element before this change.
- [ ] `manifest.json`'s `protocolVersion` field reads `3`.
- [ ] Nothing else written by `exportSelection` (`manifest.json`, `settings.json`,
      `blobs/<sha256>` entries) changes.

## Out of scope

- Making import understand the new shape — `M14.2.1`.
- Any change to `ExportedAsset`'s own fields, to `resolveIncludedAssetIds`, or to
  selection/provenance semantics — untouched by this task.

## Notes / hazards

- `asset.uuid()` is already the archive-wide unique identity every other part of this
  format keys off (`UuidRemapper`'s remap map, `IdMaps`) — safe to use directly as a
  filename with no additional escaping (it's always a well-formed UUID string). Don't
  invent a second id/index scheme.
- Reuse the existing `writeJson(ZipOutputStream, String, Object)` helper as-is for each
  per-asset entry — this task is a change to *how many times* and *with what entry
  names* it's called, not a change to how JSON gets written into a ZIP entry.
