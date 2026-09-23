---
id: M25.4.1
status: todo
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

- [ ] Round trip: dataset (with `html`+`md` record templates) + 2 sets (with queries) + 5 records in
      nested Content folders into an empty project — payloads, queries, `datasetRef`s, parents, folder
      paths, references (incl. a page's reference editor → set) intact; generated output identical to the
      source project.
- [ ] Selecting one record exports its set and dataset as *implicit*; "skip implicit existing" (`M11`)
      skips them in a project that has them.
- [ ] Each new conflict type appears in `analyze` and blocks the affected assets on import.
- [ ] A protocol-6 archive fixture with records (checked into test resources): `analyze` lists one
      `RECORD_OUTSIDE_RECORD_SET` per record; import creates none of them, everything else imports.
- [ ] `ProjectExportImportIntegrationTest` green; UI specs for the icon map / picker updated and green.

## Out of scope

- CSV import/export of records.

## Notes / hazards

- Import into a project that already has a set with the same uid but another dataset → uid-collision
  handling as for other assets; never merge records into a set of a different dataset.
- The uncommitted edits in `ProjectExportImportServiceImpl.java` / `UidGenerator.java` at the time this
  epic was written (git status 2026-09-23) must be committed or resolved before starting.
