# Feature: Domain — `DATASET` + `RECORD` asset types

**Spec:** Extends §3, §5.1–§5.4, §6 (UID per asset type), §12.3 (CDL-change migration), §26.5
(export/import).

## Goal

Introduce the two asset types and everything the domain layer needs so they behave like every other
asset: identity/state split (`Asset` / `AssetVersion`), revisions, soft delete/restore, move, UID
change, usages, diff, export/import.

- `DATASET` lives in the Templates store, fixed folder `datasets` (`payload.templateKind =
  "DATASET"`, `protected: true`), provisioned in project creation's compound revision and
  self-healed for existing projects the same way `page_templates`/`section_templates` are.
- `RECORD` lives in the new `FolderScope.CONTENT` store under protected root `content_root`, with
  ordinary user folders below it.
- Schema changes with `renamedFrom` migrate all records of the dataset in one compound revision.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-dataset-record-asset-types.md](001-dataset-record-asset-types.md) | — |
| 2 | [002-dataset-record-services.md](002-dataset-record-services.md) | 1, `M16.3.1`, `M16.5.2` |
| 3 | [003-export-import-usages-diff.md](003-export-import-usages-diff.md) | 2 |

## Feature exit criteria

- [ ] `AssetType.DATASET` / `AssetType.RECORD`, `FolderScope.CONTENT`, root `content_root` and the
      fixed `datasets` folder exist and are provisioned for new and existing projects.
- [ ] `DatasetService` / `RecordService` cover create/update/delete/restore with role checks
      (schema = DEVELOPER, records = EDITOR), server-side validation, reference materialization and
      the rename migration.
- [ ] Export/import, usages and diff handle both types.

## Dependencies

`M16.3.1` (references written on save), `M16.5.2` (server-side `ContentValidator`), `M15` batch
mechanism (`RevisionService.beginBatch` / `allocateOrJoin`), `M13` fixed template folders.
