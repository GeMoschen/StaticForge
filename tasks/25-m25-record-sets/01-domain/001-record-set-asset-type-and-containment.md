---
id: M25.1.1
status: todo
depends: []
epic: m25-record-sets
feature: domain
area: backend
---

# M25.1.1 — `RECORD_SET` asset type, containment rules, `RecordSetService`

## Context

`M19.1.1` added `AssetType.DATASET`/`RECORD` and `FolderScope.CONTENT` (`content_root`); a record's parent
is any Content folder and its dataset is chosen per record (`CreateRecordCommand(projectId, datasetUuid,
folderUuid, …)`), mirrored into `asset_version.template_asset_id`. `FolderScope.requiredFor(AssetType)`
enforces store membership; `FolderService.delete(uuid, cascade, ctx)` blocks non-empty folders unless
`cascade`. Epic decisions 1, 2 and 7 are binding here.

## Goals

- Add `AssetType.RECORD_SET` (`FolderScope.requiredFor` → `CONTENT`). Payload
  `{datasetRef, query{where, sort, limit, offset}}` (query fields optional; empty query = all records,
  default order `_displayName`, `_uid`). Mirror `datasetRef` into `template_asset_id` via the create
  command, and add repository queries `findCurrentSetsOfDataset(projectId, datasetAssetId)` and the
  revision-pinned counterpart.
- Containment, enforced in `AssetServiceImpl` for create, move **and restore** (one place, reused by
  services and import):
  - `RECORD` parent must **always** be a `RECORD_SET` whose `datasetRef` equals the record's `datasetRef`
    — never `content_root`, never a Content folder (epic decision 2);
  - `RECORD_SET` parent must be a `FOLDER` in `CONTENT` (incl. `content_root`), never another set;
  - nothing but records may be created in or moved into a set.
  Violations use the existing `FolderScope` violation error shape (new `SF-DOM-*` code, next free number).
- `RecordSetService` (+ `Impl`, `RecordSetView`, commands) in `asset/dataset`: `create(projectId,
  folderUuid, datasetUuid, uid?, displayName, query)`, `update(uuid, displayName, query,
  expectedRevision)`, `delete(uuid, cascade)`, `find(projectId, uuid, revision)`, `list(projectId,
  datasetUuid?)` incl. live record counts (one grouped count query, no N+1). Writes require EDITOR.
  Dataset is immutable (update has no dataset field). Delete without `cascade` on a non-empty set →
  `409` with `recordCount`; with `cascade` the set and its records are soft-deleted in one revision and a
  restore of the set restores them (reuse the folder cascade mechanics, don't re-implement them).
- `RecordService.create` takes `recordSetUuid` instead of `datasetUuid` + `folderUuid`; the dataset is read
  from the set. `CreateRecordCommand` changes accordingly (breaking — callers in API/tests updated here).
- `DatasetService.delete` stays blocked while the dataset has live records **or live sets**
  (`SF-DOM-0121` payload gains `setCount`).
- `RecordView`/snapshot record index gain `_recordSet` (set uid); `_folderPath` becomes the Content folder
  path of the record's **set**.
- Extend or explicitly default every `switch`/`if` over `AssetType`: `AssetServiceImpl` (create scope hint,
  softDelete, move, changeUid), `FolderServiceImpl` (tree — sets are tree nodes with a `recordCount`, their
  records are *not* tree nodes), `Snapshot`, `GenerationService`, `BuildPlanner`, `AssetCopyStage`,
  `DiffServiceImpl` labels, search indexer (`M23.1.2`: index a set by display name + dataset name).
- Usages: a set's usages list pages/templates referencing it; a record's usages unchanged.

## Acceptance criteria

- [ ] Integration test: create set in a Content subfolder → create 3 records in it → move one to another
      set of the same dataset (ok) → move to a set of another dataset / to a folder (rejected, error
      shape asserted) → create a set inside a set (rejected).
- [ ] Creating a record without a set, in `content_root` or in a Content folder, is rejected with the
      containment error; restoring a record whose set is soft-deleted is rejected too (restore the set,
      whose cascade restore brings its records back).
- [ ] Delete non-empty set without cascade → `409` + `recordCount`; with cascade → one revision; restore
      of the set restores its records; time-travel read at the pre-delete revision still shows them.
- [ ] `template_asset_id` readers filter by `asset_type` (grep list in Notes when done); a test proves
      "pages using template X" and "records of dataset X" never include sets.
- [ ] Dataset delete blocked by a live empty set.
- [ ] `./gradlew :server:sf-domain:test` and the ArchUnit / `@RevisionAware` gates green.

## Out of scope

- Any migration, conversion or self-heal of records that already sit directly in the Content store (epic
  decision 8) — existing dev databases are reset.
- Query validation and rename rewrite (`M25.1.2`), REST (`M25.3.1`), rendering
  (`M25.2.*`), export/import (`M25.4.1`).

## Notes / hazards

- `M19` tests and fixtures (golden `records.json` stubs, `DatasetBenchmark`, journey tests) create records
  straight into folders; they will fail once containment is enforced. Update them to create a set first
  (a small test fixture helper) — don't loosen the rule and don't add a compatibility path.
- Folder `tree` payloads feed the UI tree and the export picker — keep the `recordCount` cheap.
- `RecordRenameMigration` iterates "current records of the dataset" — unaffected, records still carry
  `datasetRef`.
