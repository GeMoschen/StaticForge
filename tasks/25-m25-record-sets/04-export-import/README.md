# Feature: Export/import — record sets in archives

**Spec:** Extends §26.5 (export/import), `M10` (selective export), `M11` (coverage & provenance), `M14`
(per-asset files).

## Goal

Record sets travel in archives with correct implicit provenance (record → set → dataset), import in
dependency order, and records outside a record set (every pre-`M25` archive with records) are rejected
with a blocking conflict — never migrated.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-record-sets-in-archives.md](001-record-sets-in-archives.md) | `M25.1.1`, `M25.2.1` |

## Feature exit criteria

- [ ] Round-trip, selective export, conflicts and pre-`M25` archive rejection covered by `ProjectExportImportIntegrationTest`.
- [ ] Export picker and import conflict UI updated.

## Dependencies

`M25.1.*`, `M25.2.1` (record templates are part of the dataset payload), `M19.1.3` (dataset/record archive
handling — the pattern to extend).
