# Feature: Backward-compatible import

**Spec:** Extends §26.5's import path so it reads both the new per-asset archive shape
(`M14.1`) and every archive already produced by `M10`–`M13` (`PROTOCOL_VERSION` ≤ 2,
single `assets.json`).

## Goal

`ProjectExportImportServiceImpl.readArchive` currently reads exactly one shape: a
single `assets.json` entry deserialized as `ExportArchive`. Make it read either shape,
detected unambiguously by which entry names are actually present in the ZIP (a
top-level `assets.json` entry means the legacy single-file shape; one or more
`assets/<uuid>.json` entries means the new per-file shape) — never by trusting the
archive's own `manifest.protocolVersion` claim alone, since that's metadata about the
archive, not proof of what's actually inside it. Every existing test that reads an
archive's assets (via `ProjectExportImportIntegrationTest`'s `parseAssets` helper)
migrates to the new default shape, and a new test proves a hand-repacked legacy-shape
archive still imports correctly — the same "prove it, don't assume it" bar `M9.3.2`
and `M11.2.1` already held their own backward-compat claims to.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-shape-aware-archive-reader.md](001-shape-aware-archive-reader.md) | — |
| 2 | [002-legacy-archive-and-existing-test-migration.md](002-legacy-archive-and-existing-test-migration.md) | 1 |

## Feature exit criteria

- [ ] `readArchive` correctly parses an archive written by `M14.1.1`'s new exporter
      (per-file) and an archive written by any pre-`M14` server (single `assets.json`,
      `protocolVersion` ≤ 2) into the same `List<ExportedAsset>` shape internally —
      every downstream step (`importProject`, `analyzeImport`, `detectConflicts`) is
      completely unaware of which shape the archive it received actually was.
- [ ] A hand-repacked legacy-shape archive (built from a freshly-exported project's own
      asset data, re-packed into the old single-`assets.json` layout) imports with
      identical results to importing that same project's normally-exported (per-file)
      archive.
- [ ] Every existing test that previously parsed `assets.json` directly now goes
      through the shape-aware reader and keeps passing.

## Dependencies

`M14.1` (the new write shape this reads). `ExportArchive` (kept, now read-only, for the
legacy shape). `ImportOptions`, `ConflictReport`/`detectConflicts` (`M10.2`/`M11.2.2`,
unchanged — they consume whatever `readArchive` hands them, same as always).
