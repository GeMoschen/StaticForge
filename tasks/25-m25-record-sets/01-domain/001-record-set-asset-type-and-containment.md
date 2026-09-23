---
id: M25.1.1
status: done
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

- [x] Integration test: create set in a Content subfolder → create 3 records in it → move one to another
      set of the same dataset (ok) → move to a set of another dataset / to a folder (rejected, error
      shape asserted) → create a set inside a set (rejected).
- [x] Creating a record without a set, in `content_root` or in a Content folder, is rejected with the
      containment error; restoring a record whose set is soft-deleted is rejected too (restore the set,
      whose cascade restore brings its records back).
- [x] Delete non-empty set without cascade → `409` + `recordCount`; with cascade → one revision; restore
      of the set restores its records; time-travel read at the pre-delete revision still shows them.
- [x] `template_asset_id` readers filter by `asset_type` (grep list in Notes when done); a test proves
      "pages using template X" and "records of dataset X" never include sets.
- [x] Dataset delete blocked by a live empty set.
- [x] `./gradlew :server:sf-domain:test` and the ArchUnit / `@RevisionAware` gates green.

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

## Implementation notes (2026-09-23)

- **Type & payload.** `AssetType.RECORD_SET` (`FolderScope.requiredFor` → `CONTENT`), payload
  `{datasetRef, query{where, sort, limit, offset}}` — `RecordSetQuery` stores only the parts that are set; the
  empty query is `RecordSetQuery.ALL`. `datasetRef` is mirrored into `template_asset_id` through the create
  command's `templateUuid`. `CreateAssetCommand` gained an optional `uid` (explicit uid on create: format,
  reserved `SF-DOM-0102`, taken `SF-DOM-0101` — the checks `changeUid` already made, now one helper).
- **Containment:** `asset.folder.RecordSetContainment` — pure rules (`violation(childType, childPayload,
  parentType, parentPayload, parentDeleted)`), `422 SF-DOM-0104` (new; the `FolderScope` violation shape with its
  own code). `AssetServiceImpl` calls it on create, move and restore; `FolderServiceImpl` rejects a set as the
  parent of a new or moved folder with it; `RecordServiceImpl.create` rejects a missing set/folder/deleted set with
  it. Import (`M25.4.1`) calls the same pure method to turn a violation into its conflict.
- **Decision — a record's `folder_path` is its set's folder path** (the set is its `folder_id`, not a path
  segment). `_folderPath`, `folder=` filters, folder subtree moves/deletes and folder export picks work unchanged;
  a set move (or a restore that puts a set into another folder) rebases the set's live records in the same
  revision (`AssetServiceImpl.rebaseRecords`). A restored record takes its set's current path.
- **Delete / restore.** `RecordSetService.delete` delegates to `FolderService.delete`, now accepting a record set:
  its subtree is the set plus its live records (they share the folder path, so the prefix can't be used); without
  `cascade` a non-empty set is `409 SF-DOM-0110` with `recordCount` (`RecordSetContainment.notEmpty`). The generic
  `AssetService.softDelete` refuses a non-empty set the same way. No folder cascade *restore* existed to reuse, so
  `AssetServiceImpl.restore` of a deleted set brings back, in its revision, the records whose live version was
  closed by the set's delete revision (`findLiveChildVersionsClosedAt`) — a record deleted on its own stays
  deleted. Like a folder delete, a set delete has no reference guard.
- **Dataset delete** (`SF-DOM-0121`) is blocked by live records *or* live sets; the problem carries
  `recordCount` and `setCount`.
- **`RecordSetService`** (+`Impl`, `RecordSetView`, `CreateRecordSetCommand`, `UpdateRecordSetCommand`):
  create/update/delete/find (record count at the revision)/list (one grouped `countCurrentRecordsPerSet` query,
  `ChildCount` projection). `RecordSetServiceImpl.validatedQuery` is the hook `M25.1.2` fills for create and update.
- **Records.** `CreateRecordCommand(projectId, recordSetUuid, displayName, content)`; the dataset is the set's.
  `RecordDetail` gained `recordSetUuid`/`recordSetUid`; `folderUuid`/`folderPath` are the set's Content folder.
  `RecordView` gained `_recordSet` (set uid; a 7-argument constructor), filled by `RecordValues.view` everywhere
  (`RecordValues.recordSetUids` batches the lookup; the snapshot resolves it through the new
  `SnapshotAsset.folderId`).
- **API (minimal, full work in `M25.3.1`).** `CreateRecordRequest{recordSetUuid, displayName, content, comment}`
  replaces `folderUuid`; `POST /datasets/{uuid}/records` rejects a set of another dataset (`SF-DOM-0104`).
  `FolderView` (the folder tree) gained `type` (`FOLDER`/`RECORD_SET`) and `recordCount`. **OpenAPI changes; I
  did not regenerate `ui/src/app/core/api/generated/schema.d.ts`** (the UI still sends `folderUuid` when creating
  a record — `M25.5.1`).
- **Switches over `AssetType`:** `ReferenceMaterializer` (set → dataset `TEMPLATE` edge), `AssetValueProjection`
  (identity only), `SearchIndexer.indexable` + new `RecordSetTextExtractor` (display name in the title, dataset
  name as text; a renamed dataset re-indexes its sets), `AssetReferencePrefixes` (the enum spelling `record_set` is
  rejected; `recordset` is registered by `M25.2.2`), the uid-literal scan (`recordset:`), export/import
  (`RECORD_SET` in the import order between `DATASET` and `RECORD`, a set's dataset is an implicit export pick, a
  set without its dataset is `RECORD_DATASET_MISSING`). Reviewed without change: `Snapshot`,
  `GenerationService`, `BuildPlanner`/`RebuildExpansion` (default arm: every referrer), `AssetCopyStage`,
  `DiffServiceImpl` (no per-type labels; a set diff is the generic payload diff of `datasetRef`/`query`),
  `LocalizationMigrationService`/`TranslationStatusService` (sets hold no values).
- **Folder tree:** `FolderNode` gained `type` and `recordCount`; the Content tree lists sets as leaf nodes of
  their folder (records are never nodes), counts from the one grouped query.
- **`template_asset_id` readers** (all filter on `asset_type`): `AssetVersionRepository`
  `findCurrentRecordsOfDataset`, `searchCurrentRecordsOfDataset`, `findRecordsOfDatasetAt`,
  `findCurrentRecordVersionIdsOfDataset`, `countCurrentRecordsOfDataset` (`RECORD`); `findCurrentSetsOfDataset`,
  `findSetsOfDatasetAt`, `countCurrentSetsOfDataset` (`RECORD_SET`); `findCurrentPagesOfTemplates` (`PAGE`);
  `PageServiceImpl.list` (pages only); `ProjectExportImportServiceImpl` implicit dataset pick and
  `RECORD_DATASET_MISSING` (`RECORD`/`RECORD_SET`); `RecordSetServiceImpl.list` (sets only). Every other use carries
  the column forward on a new version.
- **Tests:** `RecordSetIntegrationTest` (moves between sets / into another dataset's set / a folder / the root,
  nested sets and folders in sets, set in a Pages folder; create and restore outside a live set; cascade delete in
  one revision, restore, time travel; generic delete guard; dataset delete blocked by an empty set; the
  `template_asset_id` readers; explicit uid, update, list with counts, usages; Content tree nodes and set/folder
  moves rebasing records; `_recordSet` in a preview loop), `RecordSetContainmentTest` (pure rules, error shape,
  query JSON), `SearchTextExtractorsTest.aRecordSetIsFoundByItsNameAndItsDatasetName`, golden
  `render/for-dataset-where-sort` (`_recordSet` output and `where`), `GenerationRendererDatasetTest` (snapshot
  `_recordSet`). Every M19/M21/M24 test that created records straight into folders now creates a set first through
  the shared `RecordSetFixtures` (sf-app tests); the golden `records.json` stubs carry `recordSet`.
