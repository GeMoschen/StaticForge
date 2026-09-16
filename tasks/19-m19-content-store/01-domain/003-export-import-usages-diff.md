---
id: M19.1.3
status: done
depends: [M19.1.2]
epic: m19-content-store
feature: domain
area: backend
---

# M19.1.3 — Export/import, usages and diff for datasets and records

## Context

`ProjectExportImportServiceImpl` writes per-asset files (`M14`: `manifest.json`, `assets.json`,
`assets/<uuid>.json`, `settings.json`, `blobs/<sha>`). `ExportedAsset` carries `templateUuid`;
`ExportSelection` has `fullStores: Set<FolderScope>`; implicit vs explicit provenance (`M11`) pulls in
ancestor folders; fixed folders are remapped on import (`ensureNavigationRootFolder` etc., ~416–429);
a type mismatch raises a conflict (~515). `DiffServiceImpl` is type-agnostic (`JsonDiffer` over
payloads). `AssetServiceImpl.usages` lists inbound references.

## Goals

- Export: `DATASET` and `RECORD` exported like other assets; a record's `templateUuid` field carries
  its dataset (or a dedicated field if `M19.1.1` chose differently). Selecting a record implicitly
  includes its dataset (implicit provenance) and its ancestor Content folders; `fullStores` accepts
  `CONTENT`; selecting the `datasets` folder exports all schemas.
- Import: remap `content_root` and `datasets` fixed folders; import datasets before records; a record
  whose dataset is neither in the archive nor in the target project → new `ConflictType`
  (ERROR, e.g. `RECORD_DATASET_MISSING`) reported by `analyze` and enforced by import; a dataset UID
  collision with a different schema follows existing UID-collision handling.
- Usages: dataset usages list records (count, not 5,000 rows — paginate or summarize) plus templates
  that loop it (edges from `M16.3.2`/`M19.3.2`); record usages list pages/records/templates
  referencing it.
- Diff: confirm `JsonDiffer` output is meaningful for `RECORD` (content field changes) and `DATASET`
  (CDL source text diff); add type labels if the diff view keys off type.
- Bump `manifest.protocolVersion` only if the archive shape changes incompatibly (it should not —
  document why if not bumped).

## Acceptance criteria

- [x] Export/import round-trip test: dataset + 3 records in nested Content folders into an empty
      project; payloads, `datasetRef`, folder paths and references intact.
- [x] Selecting a single record exports its dataset as *implicit*; re-importing into a project that
      already has that dataset skips it when the "skip implicit existing" option is set (`M11`).
- [x] Missing-dataset conflict appears in `analyze` and blocks that record on import.
- [x] `GET /assets/{uuid}/usages` for a dataset and a record returns the expected rows.
- [x] `ProjectExportImportIntegrationTest` suite green; UI conflict icon map updated
      (`project-settings-export.component.ts`) for the new `ConflictType`.

## Out of scope

- UI export picker for the Content store (`M19.4.1` wires the store into the existing picker).
- CSV import/export of records.

## Notes / hazards

- Legacy archives (pre-`M19`) contain no new types — `M14`'s shape-aware reader must keep reading them
  unchanged; add a regression assertion.
- Import order matters: a record created before its dataset breaks validation (`M19.1.2`) — make the
  ordering explicit rather than relying on `assets.json` order.

## Implementation notes (2026-09-16)

- Export order puts DATASET before RECORD; exporting a record adds its dataset (and the dataset's ancestors) as
  implicit. Import remaps the fixed `datasets`/`content_root` folders, falls back to an existing target dataset
  for `templateAssetId`, and reports `ConflictType.RECORD_DATASET_MISSING` (blocking). Export protocol 4 → 5.
- Usages of a dataset list the templates that loop it, not its own records (TEMPLATE edges filtered).
- UI: import conflict icon and export picker (Content scope, `datasets` folder) updated.
- Tests: `ProjectExportImportIntegrationTest` (`contentStoreRoundTripsWithDatasetLinksFoldersAndReferences`,
  `aSingleRecordExportCarriesItsDatasetImplicitly`, `aRecordWithoutItsDatasetIsABlockingConflict`,
  `recordAndDatasetDiffsShowTheChangedFields`), `DatasetRecordIntegrationTest.datasetUsagesListLoopingTemplatesNotRecords`.
