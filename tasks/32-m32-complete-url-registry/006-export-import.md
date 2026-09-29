---
id: M32.6
status: done
depends: [M32.2]
epic: m32-complete-url-registry
feature: export-import
area: backend
---

# M32.6 — Export/import protocol 11

## Context

`ProjectExportImportService` (`QUALITY_AND_REDIRECTS_PROTOCOL = 10`), `ProjectExportImportServiceImpl`,
`ImportOptions`, `UuidRemapper`, import analysis / conflict entries (M11). Epic decision 9; user decision 15.

## Goals

- Protocol **11** (`URL_REGISTRY_PROTOCOL`): a full-project archive carries `url-registry.json` with every `GENERATED`
  row (target type/uuid, channel, locale, variant, page number, url, overridden). Selective exports carry the rows of
  the exported targets. `PREVIEW` rows are never exported.
- `ImportOptions` gains `UrlRegistryImportMode urlRegistryMode` (default `ARCHIVE_WINS`):
  - `ARCHIVE_WINS` — archive rows replace the target's computed rows; the target's overrides are kept and reported as
    non-blocking conflict entries;
  - `TARGET_WINS` — existing target rows stay; archive rows only fill gaps;
  - `REPLACE_ALL` — archive rows replace every clashing target row, overrides included.
- Target UUIDs re-minted on import follow the `UuidRemapper`; rows whose target isn't imported are skipped. A URL held
  by another target in the target project is a conflict entry and the row is skipped.
- `analyzeImport` reports what each mode would change.
- Imported changes are recorded in the change log (M32.5) so the next incremental build follows.
- Protocol ≤ 10 archives import without rows.

## Acceptance criteria

- [x] Round trip full and selective: identical GENERATED rows, overrides included; an imported site builds to the same
      URLs.
- [x] Each import mode against a target with computed rows, overrides and a URL clash behaves as specified; conflict
      entries listed.
- [x] Protocol-10 archive imports.
- [x] `./gradlew build` green.

## Out of scope

- UI of the import option (M32.8).
