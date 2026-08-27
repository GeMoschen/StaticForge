# M14 — Per-asset export archive files

**Spec:** Extends §26.5 (`Project export/import (ZIP: assets JSON + blobs + manifest)
as a portability and migration path`). Not part of the original §27 roadmap —
inserted the same way `M10`–`M13` were, as a format-quality follow-up to the
selective-export/import work rather than new user-facing capability.

## Goal

Every export archive today writes exactly one `assets.json` entry — a single JSON
array holding every exported asset (`ExportArchive(protocolVersion, List<ExportedAsset>
assets)`, written in one `writeJson` call in `ProjectExportImportServiceImpl.exportSelection`).
For a project with a large or even moderate number of assets, that means the whole
archive's asset payload is one big, undifferentiated JSON blob: the exporter must hold
the full serialized array in memory to write it, the importer must fully parse the
whole array before it can look at a single asset, and a human (or a diff tool, or
version control) unzipping an archive to inspect or compare its contents finds one
enormous file instead of something browsable per-asset.

This milestone splits that one file into many: each exported asset gets its own
`assets/<uuid>.json` entry in the ZIP (mirroring the existing `blobs/<sha256>` entry
convention already used for media blobs), while `manifest.json` and the optional
`settings.json` stay exactly as they are today. Import must keep reading archives
written by every prior milestone (`M10`–`M13`, `PROTOCOL_VERSION` 2) unchanged — this is
a structural format change, not an additive field, so `PROTOCOL_VERSION` bumps to 3 and
the reader branches on which shape an archive actually contains.

## Exit criteria (epic is done when)

- [ ] Exporting a project produces one `assets/<uuid>.json` entry per exported asset
      (each holding exactly the `ExportedAsset` that asset would have occupied inside
      the old `assets.json` array) instead of a single `assets.json` entry — verified by
      listing the ZIP's entries, not just by re-parsing content.
- [ ] `manifest.json`, `settings.json` (when present), and every `blobs/<sha256>` entry
      are byte-for-byte unaffected by this change — only how assets are laid out
      changes.
- [ ] `PROTOCOL_VERSION` is 3; a freshly-exported archive round-trips through import
      identically to today's behavior (same assets, same folder structure, same
      explicit/implicit provenance, same conflict detection) — this milestone changes
      the archive's *file layout*, not any asset data, selection, or conflict-detection
      semantics already shipped by `M10`–`M13`.
- [ ] Importing an archive written by any pre-`M14` server (`PROTOCOL_VERSION` ≤ 2,
      single `assets.json` entry) still works, byte-for-byte-equivalent in outcome to
      importing the same content in the new per-file shape — proven by a test, not just
      by inspection, mirroring how `M9.3.2`/`M11.2.1` proved their own backward-compat
      claims with a hand-constructed legacy archive rather than assuming it.
- [ ] The full existing export/import test suite (`ProjectExportImportIntegrationTest`
      and any other test touching `assets.json` directly, e.g. via the `parseAssets`
      helper) passes against the new format — this is a real, in-place format change to
      already-tested code, not new functionality bolted on beside it.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [archive-format](01-archive-format/README.md) | backend | `M10.1` (`ExportedAsset`, `ProjectExportImportServiceImpl`), `M11.2.1` (`explicit` provenance, the most recent field added to `ExportedAsset`) |
| 2 | [backward-compatible-import](02-backward-compatible-import/README.md) | backend | 1 |

## Dependencies

Touches `server/sf-domain/.../exportimport/ProjectExportImportServiceImpl.java`
(`exportSelection`'s zip-writing loop, `readArchive`, `writeJson`), `ExportArchive`
(the current `assets.json` wrapper record — repurposed, not deleted, since it's still
needed to read pre-`M14` archives), `ExportedAsset` (unchanged in shape — only *how
many files* its instances get written into, never its own fields), and
`ProjectExportImportIntegrationTest.java`'s `parseAssets`/`zipEntryNames` test helpers,
which read the archive's raw ZIP entries directly and will need to understand both
shapes.

## Notes

- `cms-specification.md` §26.5 only says "assets JSON" — it doesn't mandate a single
  file, so no spec correction is needed; as with `M8`/`M10`/`M11`/`M13`, a documentation
  follow-up describing the per-asset layout explicitly is a later doc task, not tracked
  here.
- Every asset's `uuid` field is already the archive-wide, collision-free identity every
  other part of this format keys off (`UuidRemapper`, `IdMaps`, the existing
  `blobs/<sha256>` content-addressing precedent) — reuse it verbatim as the filename,
  don't invent a second naming scheme or a manifest-side index of "which files exist."
  The ZIP's own entry list is already that index; keeping a second, hand-maintained one
  in `manifest.json` would just be a second thing that could drift from the truth.
- This is a pure archive-layout change with zero effect on any asset's data, on
  selection (`ExportSelection`/`fullStores`), on provenance (`explicit`), or on
  conflict detection (`ConflictReport`) — none of those need to change, and no task in
  this epic should touch them beyond what's necessary to serialize/deserialize
  `ExportedAsset` one-at-a-time instead of as array elements.
- Nothing above the archive layer needs to change: `ProjectExportController`/
  `ProjectImportController` already treat the archive as an opaque `byte[]`, and the
  frontend's export/import panel (`M10.3`/`M11.3`) never inspects the ZIP's internal
  shape — this epic is backend-only.
