# Feature: Index lifecycle

**Spec:** New. Extends §21.4 (transactions and consistency: indexing is an after-commit side
effect) and §26.5 (backup and recovery: the index is derived and rebuildable, not backed up).

## Goal

Keep each project's index equal to the current database state without putting search on the
write path:

1. **Incremental, after commit.** Every revision already records the assets it touched in
   `revision.summary.assets`. `RevisionServiceImpl.appendSummary` → `AssetChange(uuid, assetType,
   uid, action, fields, onBehalf)`; after `M15` this also holds for compound revisions, project
   creation and restore. When a transaction that allocated a revision commits, the touched UUIDs
   are reindexed asynchronously from their now-current versions. Deleted assets are removed. A
   rolled-back transaction publishes nothing.
2. **Crash-safe catch-up.** Each Lucene commit stores the highest fully indexed revision
   (`M23.1.1`). On startup, and on demand, the lifecycle compares that stamp with the project's
   latest revision:
   - no index, a corrupt index, or an extractor/schema version change → full rebuild;
   - otherwise → replay `summary.assets` of the revisions after the stamp.
3. **Operations.** An admin reindex endpoint, and closing the index when a project is archived.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-after-commit-indexing.md](001-after-commit-indexing.md) | M23.1.2 |
| 2 | [002-revision-stamp-rebuild-reindex.md](002-revision-stamp-rebuild-reindex.md) | 1 |

## Feature exit criteria

- [x] Every mutation path that allocates a revision reaches the index after commit. This includes
      import (`ProjectExportImportServiceImpl`), project rollback (`ProjectRestoreService`),
      channel template edits (`ChannelServiceImpl`) and template rename cascades
      (`TemplateServiceImpl`). Proven by integration tests, not by inspection alone.
- [x] Rolled-back transactions never change the index.
- [x] Deleting the index directory, or simulating a crash between the DB commit and the index
      commit, recovers on the next start or the next indexing pass.
- [x] `POST /search/reindex` rebuilds while queries keep serving the previous index until the new
      one is swapped in.

## Dependencies

`M15` (compound revisions: `summary.assets` is complete for multi-asset operations), `M23.1.*`.
