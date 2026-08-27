---
id: M14.1.2
status: todo
depends: [M14.1.1]
epic: m14-per-asset-export-files
feature: archive-format
area: backend
---

# M14.1.2 — Export-side tests for the per-asset archive shape

## Context

`M14.1.1` changes what `exportSelection` writes; this task proves it, following the
same "assert on the archive's actual ZIP entries, not just on reparsed content" style
already used by `ProjectExportImportIntegrationTest`'s existing `zipEntryNames`/
`parseAssets` helpers.

## Goals

- New (or extended) test asserting that exporting a fixture project with a known
  number of live assets produces exactly that many `assets/<uuid>.json` entries and no
  `assets.json` entry — read via `zipEntryNames`, not by trusting the parser.
- New test asserting one specific known asset's `assets/<uuid>.json` entry
  deserializes to an `ExportedAsset` matching every field it would have held under the
  old array-based format (displayName, folderPath, `explicit`/`isExplicit()`, payload,
  etc.) — a direct field-by-field comparison against a freshly-`create`d asset's known
  values, not a snapshot diff.
- Test asserting `manifest.json`'s `protocolVersion` is `3`.
- Test asserting `settings.json` and `blobs/<sha256>` entries are unaffected (reuse
  existing settings/media-blob fixtures and assertions from `M10.1.2`/media-export
  tests as the pattern, don't invent a new fixture shape).

## Acceptance criteria

- [ ] All tests above pass against `M14.1.1`'s implementation.
- [ ] Every pre-existing `M10`–`M13` export-side test that only inspected
      *reparsed asset content* (not raw entry names) keeps passing unmodified — this
      task adds new entry-shape assertions, it doesn't need to touch tests that never
      cared about the shape.

## Out of scope

- Import-side backward compatibility and the existing `parseAssets`-based test suite's
  own migration to the new format — `M14.2.2`. This task only adds new,
  format-specific assertions on the export side; it does not yet change how existing
  tests parse an archive back into a `List<ExportedAsset>`.

## Notes / hazards

- Keep new tests additive at this stage — don't touch `parseAssets` itself yet even
  though it will need to change for every *other* existing test to keep passing once
  the default export format is per-file; that migration is `M14.2.2`'s job specifically
  because it's paired with proving the *reader* handles both shapes, not just the
  *writer* producing the new one. Doing it here would conflate "the writer changed" with
  "the reader now understands what the writer produces," which are the two different
  claims `M14.1`/`M14.2` are each responsible for proving separately.
