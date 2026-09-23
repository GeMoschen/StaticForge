---
id: M25.4.1
status: done
depends: [M25.1.1, M25.2.1]
epic: m25-record-sets
feature: export-import
area: fullstack
---

# M25.4.1 — Record sets in export/import

## Context

`ProjectExportImportServiceImpl` (protocol `6`, `ProjectExportImportService.PROTOCOL_VERSION`) writes
`manifest.json`, `assets.json`, `assets/<uuid>.json`, `settings.json`, `blobs/<sha>`. `M19.1.3` orders
`DATASET` before `RECORD`, adds a record's dataset as *implicit*, remaps the fixed `datasets` /
`content_root` folders, falls back to an existing target dataset for `templateAssetId`, and reports
`ConflictType.RECORD_DATASET_MISSING` (blocking). The UI maps conflict types to icons in
`project-settings-import.component.ts` and scopes/folders in the export picker
(`project-settings-export.component.ts`). Epic decisions 2 and 8 are binding: records outside a set
are never migrated.

## Goals

- **Export:** `RECORD_SET` exported like other assets, `templateUuid` = its dataset. Order
  `DATASET → RECORD_SET → RECORD`. Implicit provenance: a selected record pulls in its set, the set its
  dataset (and each one's ancestor folders). Selecting a set explicitly includes its records (container
  semantics, like selecting a folder); `fullStores: CONTENT` includes all sets. Dataset `channelTemplates`
  travel in the dataset payload (no shape change).
- **Import:** create sets before records; resolve a set's dataset from the archive or fall back to an
  existing target dataset with the same uid (as records do today). New blocking conflicts:
  - `RECORD_SET_DATASET_MISSING` — a set whose dataset is neither in the archive nor the target;
  - `RECORD_SET_MISSING` — a record whose set is neither in the archive nor the target (only reachable
    with hand-edited archives, but must be reported, not NPE);
  - `RECORD_SET_DATASET_MISMATCH` — the record's `datasetRef` differs from its set's dataset.
  - `RECORD_OUTSIDE_RECORD_SET` — see below.
  Existing `RECORD_DATASET_MISSING` stays. The set's stored query is re-validated against the (possibly
  existing) target dataset; an invalid query imports but is flagged (`queryValid: false`) and reported as
  a warning in `analyze`.
- **Records outside a set:** a record whose archive parent is `content_root` or a Content folder
  (every pre-`M25` archive with records, protocol ≤ 6) → blocking conflict `RECORD_OUTSIDE_RECORD_SET`,
  reported by `analyze` and enforced by import. The rest of the archive (pages, templates, datasets,
  media, …) still imports. No grouping, no auto-created sets.
- Bump `PROTOCOL_VERSION` 6 → 7 (the containment rule changes how an archive must be read) and document
  why in the class Javadoc.
- **UI:** export picker lists sets under their folders in the Content scope (a set is a selectable leaf;
  its records are not listed individually); import conflict icon map covers the four new conflict types.

## Acceptance criteria

- [x] Round trip: dataset (with `html`+`md` record templates) + 2 sets (with queries) + 5 records in
      nested Content folders into an empty project — payloads, queries, `datasetRef`s, parents, folder
      paths, references (incl. a page's reference editor → set) intact; generated output identical to the
      source project.
- [x] Selecting one record exports its set and dataset as *implicit*; "skip implicit existing" (`M11`)
      skips them in a project that has them.
- [x] Each new conflict type appears in `analyze` and blocks the affected assets on import.
- [x] A protocol-6 archive fixture with records (checked into test resources): `analyze` lists one
      `RECORD_OUTSIDE_RECORD_SET` per record; import creates none of them, everything else imports.
- [x] `ProjectExportImportIntegrationTest` green; UI specs for the icon map / picker updated and green.

## Out of scope

- CSV import/export of records.

## Notes / hazards

- Import into a project that already has a set with the same uid but another dataset → uid-collision
  handling as for other assets; never merge records into a set of a different dataset.
- The uncommitted edits in `ProjectExportImportServiceImpl.java` / `UidGenerator.java` at the time this
  epic was written (git status 2026-09-23) must be committed or resolved before starting.

## Implementation notes (2026-09-23)

- **Export** (`ProjectExportImportServiceImpl.resolveIncludedAssetIds`): a picked `RECORD_SET` is a container
  pick — the set and its live records (matched by parent id, since records share the set's folder path) are
  explicit. A picked record pulls in its set as an implicit pick, and every included record or set its dataset;
  ancestor folders follow as before. A folder pick / `fullStores: CONTENT` already covers sets and records by path.
  `channelTemplates` travel in the dataset payload unchanged. This matches the UI of `M25.5.3` (set uuid in
  `assetUuids`).
- **Import.** Order `DATASET → RECORD_SET → RECORD` (from `M25.1.1`). A record may join a set that is not in the
  archive but live in the target (resolved like a skipped asset). Placement is judged with
  `RecordSetContainment.violation` against the parent *as the import will find it* (`placement`: the archive's
  copy, or the target's current version when that one is skipped as an existing implicit pick or absent).
- **Conflicts** (`ConflictType`): `RECORD_SET_DATASET_MISSING` (replaces `RECORD_DATASET_MISSING` for sets;
  records keep `RECORD_DATASET_MISSING`), `RECORD_SET_MISSING` (no parent anywhere, or a soft-deleted target set),
  `RECORD_SET_DATASET_MISMATCH` (record vs. its set, **and** a set that would overwrite a target set of another
  dataset — a set's dataset is immutable), `RECORD_OUTSIDE_RECORD_SET` (parent is the Content root or a folder).
  New warning **`RECORD_SET_QUERY_INVALID`**: the set's stored query is re-validated with `RecordSetQueries.compile`
  against the dataset it gets in the target (archive payload, or the reused existing dataset); the set imports with
  its query untouched and reads `queryValid: false`.
- **Decision — per-asset blocking.** The task wants `RECORD_OUTSIDE_RECORD_SET` blocking *and* "everything else
  imports" (epic decision 8). `ConflictType` gained `rejectsAssetOnly()` / `blocksImport()`; only
  `RECORD_OUTSIDE_RECORD_SET` rejects its own asset only. `importProject` refuses on `blocksImport` conflicts and
  skips rejected assets; such a record gets no other conflict (it is never written). `ConflictReport.blocksImport()`,
  `ImportConflict.blocksImport()`. The other three new types block the whole import, like their M19/M10 siblings
  (`RECORD_DATASET_MISSING`, `MISSING_PARENT_FOLDER`) — they only occur with hand-edited archives.
- **REST:** `ConflictReportView.blocksImport` and `ImportConflictView.blocksImport` (new fields; `hasBlocking` is
  unchanged). **OpenAPI changes; `ui/src/app/core/api/generated/schema.d.ts` was not regenerated.**
- **UI follow-up (not changed here):** the import screen disables Proceed on any `BLOCKING` conflict
  (`project-settings-import.component.ts` `hasBlocking`), so a pre-M25 archive with records can't be committed
  from the UI although the server accepts it. It should gate on `blocksImport` (after regenerating
  `schema.d.ts`) and present `RECORD_OUTSIDE_RECORD_SET` as "will not be imported". `RECORD_SET_QUERY_INVALID` has
  no icon yet (falls back to `info`).
- **Protocol** `PROTOCOL_VERSION` 6 → 7, reason documented on the constant and in the class Javadoc. Protocol ≤ 6
  archives are still read; their records yield `RECORD_OUTSIDE_RECORD_SET` through the same containment check (no
  version-specific code, no migration).
- **Fixture:** `server/sf-app/src/test/resources/exportimport/protocol-6-records-outside-sets/` — the unpacked
  entries (manifest, settings, `assets/<uuid>.json`) of a real export in the M14 per-file shape, turned into the
  pre-M25 shape (set entries removed, records re-parented to Content folder `People` / the Content root, protocol
  6): dataset `team`, records Ada/Bob/Cy, page template with a `dataset:` loop, page whose reference editor points
  at Ada. Zipped at test time by the new `ArchiveFixtures` (also `editAsset`, `withoutEntry`).
- **Tests.** `ProjectExportImportIntegrationTest` (59): new `recordSetsRoundTripIntoAnEmptyProjectAndGenerateIdenticalOutput`
  (html+md record templates, 2 sets with queries, 5 records in `People`/`People/Leads`, page reference editor →
  set; payloads, queries, dataset links, sets, folder paths, `CONTENT_REF` row; FULL generation of both projects,
  html+md files byte-identical), `pickingARecordSetExportsItsRecordsAndItsDatasetImplicitly`,
  `aRecordWhoseSetIsMissingIsABlockingConflictUnlessTheTargetHasTheSet`,
  `aRecordOrSetOfAnotherDatasetThanItsSetIsABlockingConflict`,
  `aSetWhoseUidIsTakenByASetOfAnotherDatasetImportsUnderADerivedUid` (hazard note),
  `aSetQueryThatDoesNotFitTheTargetSchemaImportsFlaggedWithAWarning` (archive dataset and reused target dataset),
  `aProtocol6ArchiveRejectsItsRecordsOutsideSetsAndImportsEverythingElse`; changed
  `aSingleRecordExportCarriesItsSetAndDatasetImplicitly` (set implicit and skipped),
  `aRecordAndItsSetWithoutTheirDatasetAreBlockingConflicts`, protocol 7 in `manifestReportsTheCurrentProtocolVersion`.
  The class got a `@DynamicPropertySource` output root for the generation comparison. `ProjectImportAnalyzeApiTest`
  (+1: fixture → `hasBlocking` true, `blocksImport` false, commit `200` with 4 assets; `blocksImport` asserted on
  the existing blocking test). UI specs of `M25.5.3` (`project-settings-import/export.component.spec`) re-run green.
