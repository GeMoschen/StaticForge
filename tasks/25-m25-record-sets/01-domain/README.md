# Feature: Domain — `RECORD_SET` asset type, stored queries

**Spec:** Extends §3, §5.1–§5.4, §6 (UID per asset type), §12.3 (CDL-change migration), §15
(compound revisions).

## Goal

Introduce `RECORD_SET` so it behaves like every other asset (identity/state split, revisions, soft
delete/restore, move, UID change, usages, diff, time travel), make it the mandatory parent of every
`RECORD` (records never live directly in the Content store; existing records are not migrated), and
give it a validated stored query that follows dataset schema renames.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-record-set-asset-type-and-containment.md](001-record-set-asset-type-and-containment.md) | — |
| 2 | [002-record-set-query-and-schema-migration.md](002-record-set-query-and-schema-migration.md) | 1 |

## Feature exit criteria

- [ ] `AssetType.RECORD_SET` exists; records can only live in sets, sets only in Content folders.
- [ ] `RecordSetService` covers create/update/delete(cascade)/restore/find/list with EDITOR/VIEWER roles;
      `RecordService.create` takes a set instead of dataset + folder.
- [ ] Set queries are validated, rewritten by `renamedFrom`, and flagged when a field disappears.
- [ ] No write path can leave a record outside a set; no migration code for pre-`M25` records exists.

## Dependencies

`M19.1.*` (dataset/record services, `template_asset_id` mirroring, `RecordRenameMigration`), `M19.3.1`
(`DatasetQueryParser`/`DatasetQueryEvaluator`), `M15` batch mechanism, `M24.2` (localizable values).
