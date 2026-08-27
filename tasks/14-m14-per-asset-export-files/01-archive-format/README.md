# Feature: Archive format

**Spec:** Extends §26.5's ZIP archive shape so exported assets are written one file
per asset instead of one combined `assets.json` array.

## Goal

Change `ProjectExportImportServiceImpl.exportSelection`'s zip-writing step so each
`ExportedAsset` in the (already-computed, already-sorted-by-uuid) `assets` list is
written as its own `assets/<uuid>.json` entry, replacing today's single
`writeJson(zip, ASSETS_ENTRY, new ExportArchive(PROTOCOL_VERSION, assets))` call.
`PROTOCOL_VERSION` moves from 2 to 3 to mark this as a structural shape change (not the
kind of additive, ignorable field `M11.2.1` could ship without a bump). Nothing about
*which* assets get exported, *why* (`explicit`/`implicit`), or in what order they're
computed changes — only how the already-final list gets serialized into the ZIP.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-per-asset-write-format.md](001-per-asset-write-format.md) | — |
| 2 | [002-export-format-tests.md](002-export-format-tests.md) | 1 |

## Feature exit criteria

- [ ] Exporting a project with N live assets produces N `assets/<uuid>.json` ZIP
      entries and zero `assets.json` entry.
- [ ] Each `assets/<uuid>.json` entry deserializes (via `objectMapper`) to exactly the
      `ExportedAsset` that uuid would have held as an element of the old array — same
      fields, same values, including `explicit`/`isExplicit()`.
- [ ] `manifest.json` reports `protocolVersion: 3`; `settings.json`
      (when present) and every `blobs/<sha256>` entry are unaffected.

## Dependencies

`ExportedAsset`, `ExportSelection`, `resolveIncludedAssetIds` (`M10.1`/`M11.1`/`M11.2`,
unchanged by this feature — it consumes their output, doesn't touch their logic).
`ProjectExportImportService.PROTOCOL_VERSION`.
