---
id: M23.2.1
status: done
depends: [M23.1.2]
epic: m23-global-search
feature: index-lifecycle
area: backend
---

# M23.2.1 — After-commit incremental indexing from revision summary

## Context

The codebase has no domain event or after-commit hook today: no `ApplicationEventPublisher` or
`@TransactionalEventListener` usage in `server/*/src/main`.

All mutations allocate through `RevisionServiceImpl.allocate` / `beginBatch` / `allocateOrJoin`,
and each touched asset is recorded via `appendSummary(projectId, revisionId, AssetChange)`. Callers:

- `AssetServiceImpl`: CREATE/UPDATE/DELETE/RESTORE/UID_CHANGE/MOVE
- `FolderServiceImpl`: MOVE/DELETE
- `TemplateServiceImpl`: rename cascade
- `ChannelServiceImpl`: `channelTemplates`
- `ProjectServiceImpl`
- `ProjectRestoreService`
- `ProjectExportImportServiceImpl`

The final `summary.assets` array is therefore the authoritative list of assets a committed revision
touched.

## Goals

- **Registration.** In `RevisionServiceImpl.allocate` (the single allocation point; `beginBatch`
  and `allocateOrJoin` delegate to it), register exactly one post-commit notification per allocated
  revision: publish a `RevisionCommittedEvent(projectId, revisionId)` consumed by a
  `@TransactionalEventListener(phase = AFTER_COMMIT)`. Joining an open batch (`allocateOrJoin` with
  `openRevision`) must not register a second one.
- **Listener.** `SearchIndexingListener` hands the event to `SearchIndexer` on a dedicated executor
  (virtual threads; bounded queue) and never blocks the request thread. It works per project and
  serially, so two revisions of the same project are applied in revision order.
- **`SearchIndexer.apply(projectId, revisionId)`:**
  - Loads the committed `Revision` and reads `summary.assets[].uuid` + `type` + `action`.
  - For each touched UUID, loads the **current** version, not the version at `revisionId`, because
    later revisions may already have changed it.
  - If the asset is current and not deleted, extract (`M23.1.2`) and `upsert`; if deleted or
    missing, `delete`.
  - Deduplicates UUIDs within the revision.
  - Commits with `indexedRevision = max(stamp, revisionId)` only when every earlier revision is
    also applied (see hazard on ordering).
- **Cascades not in the summary.** A template's `ContentDefinition` change alters how its pages are
  extracted (e.g. an editor switched from `text` to `json`). When a touched asset is a
  `PAGE_TEMPLATE`/`SECTION_TEMPLATE` (and, once they exist, `GLOBAL_SET` schema or `DATASET`
  schema), enqueue reindexing of the pages/records using it:
  - pages via `payload.templateRef` / `bodies.*[].templateRef`;
  - records via `datasetRef`.

  Reuse the payload index `BuildPlanner.affectedPages` already builds, or the revision-aware
  reference queries from `M16.3.3`. Do not add a third implementation.
- **Failure handling.** An extraction or index failure for one asset is logged with project,
  revision and uuid, and counted as a metric (`sf.search.index.failures`). It does not block the
  other assets. The stamp is not advanced past a revision that had failures, so the next catch-up
  (`M23.2.2`) retries it.
- **Metrics:** `sf.search.index.lag` (latest revision minus stamp, gauge per project) and
  `sf.search.index.duration` (timer), next to the existing `sf.revision.allocate` counter.

## Acceptance criteria

- [x] Integration tests (Spring context, H2, `sf.search.directory=memory`), each asserting the
      index state after the async work settles (await with a timeout, not a sleep):
  - [x] Creating a page with a unique word in a rich-text value makes it searchable.
  - [x] Updating the word replaces it (the old word no longer matches).
  - [x] Soft delete removes the page; restore brings it back.
  - [x] Renaming a UID updates `uid` field matches.
  - [x] Project creation (one compound revision) indexes its assets without duplicates.
  - [x] Project rollback (`ProjectRestoreService.restoreTo`) reflects the restored content.
  - [x] Import (`ProjectExportImportServiceImpl`) makes imported pages searchable.
  - [x] A media metadata update (alt text) is searchable.
  - [x] A section-template CDL change that removes an editor re-extracts pages using it (the removed
        editor's text no longer matches).
- [x] A transaction that allocates a revision and then throws leaves the index unchanged, and the
      listener is never invoked (test with a forced exception after `appendSummary`).
- [x] A compound revision (`beginBatch` + several `allocateOrJoin` joins) triggers exactly one
      indexing pass (verified via spy/counter).
- [x] The request thread never waits on indexing. A test with a deliberately slow extractor shows
      the save returns before indexing completes.
- [x] `./gradlew :server:sf-domain:test :server:sf-app:test` green; `ConcurrentWritersTest` and
      `RevisionInvariantsTest` unchanged and green (`ConcurrentWritersTest` is known to be flaky; rerun before attributing a failure).

## Out of scope

- Startup catch-up, full rebuild, reindex endpoint, archive handling (`M23.2.2`).
- Query endpoint (`M23.3.1`).
- Indexing historical revisions (search is current-revision only).

## Notes / hazards

- **Ordering vs. stamp.** Revisions of one project commit in counter order in practice, but
  after-commit callbacks of concurrent transactions can arrive out of order. Serializing per
  project in the executor is not enough on its own. Advance the stamp only to the highest revision
  R such that every revision ≤ R has been applied or confirmed absent (gapless counter, ADR-0002).
  Otherwise a crash could skip one. Upserting from the *current* version keeps document content
  correct regardless of order; only the stamp needs this care.
- **Lost events.** An app crash after the DB commit but before indexing loses the in-memory event.
  This is expected and is exactly what `M23.2.2`'s stamp catch-up repairs. Do not add a durable
  outbox table for it.
- **Visibility.** The listener runs outside the original transaction. It must open its own
  read-only transaction to load current versions, never reuse the committed session.
- Keep `@RevisionAware`/ArchUnit gates intact. The indexer only reads repositories and never
  writes them.
- Payload templates are compiled through the `M16.1.1` cache. A template change must invalidate
  that cache before the cascade re-extracts (ordering within the listener).
