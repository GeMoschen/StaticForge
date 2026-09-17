---
id: M23.2.2
status: done
depends: [M23.2.1]
epic: m23-global-search
feature: index-lifecycle
area: backend
---

# M23.2.2 — Revision stamp catch-up, startup rebuild, admin reindex, archive

## Context

`M23.1.1` stores the highest fully indexed revision in Lucene commit user data. `M23.2.1` keeps the
index current while the app runs, but in-memory events are lost if the app stops between the DB
commit and the index commit. The index directory can also be deleted, corrupted, or come from an
older document model after an extractor change.

Projects are never hard-deleted today; `ProjectService.archive(key, ctx)` is the end of a project's
lifecycle. `LegacyOutputCleanupRunner` (sf-app `bootstrap`) is the precedent for startup work that
runs once the DB is up.

## Goals

- **Schema version.** Add `SearchSchemaVersion`, an integer constant stored in commit user data
  next to the revision stamp. Bump it whenever the field mapping or extractors change meaningfully.
  A mismatch forces a full rebuild.
- **Startup.** `SearchIndexCatchUpRunner` (sf-app `bootstrap`, `ApplicationRunner`) runs after the
  DB is up, for every non-archived project, on the indexing executor, without blocking application
  readiness:
  - No index, unreadable index (`CorruptIndexException`/`IndexFormatTooOldException`) or schema
    version mismatch: **full rebuild**.
  - Stamp < latest revision: **catch-up**. Replay the `summary.assets` UUIDs of revisions
    `(stamp, latest]` through `SearchIndexer`.

    Optimisation: if more than N revisions are missing (configurable
    `sf.search.catch-up-max-revisions`, default 5,000), do a full rebuild instead.
  - Stamp == latest: nothing to do.
- **Full rebuild without query downtime:**
  - Build into a sibling directory `{index-root}/{projectId}.rebuild-{ts}`, iterating current,
    non-deleted versions in pages (batch size configurable).
  - Stamp it with the latest revision *captured before the rebuild started*.
  - Atomically swap: close the old writer/searcher, rename the directories, reopen.
  - Then run a catch-up for revisions committed during the rebuild.
  - Delete leftover `*.rebuild-*` directories on startup.
- **Admin endpoint.** `POST /api/v1/projects/{projectKey}/search/reindex` (sf-api,
  `@PreAuthorize("@projectAuth.has(#projectKey, ProjectRoleExpr.PROJECT_ADMIN)")`) starts a full
  rebuild and returns `202` with a status resource.
  - `GET /api/v1/projects/{projectKey}/search/status` (VIEWER) returns `{indexedRevision,
    latestRevision, lag, state: READY|CATCHING_UP|REBUILDING|UNAVAILABLE, lastRebuildAt}`.
  - A second reindex while one is running returns `409` (mirrors `SF-GEN-0500`).
- **Archive.** When `ProjectService.archive` commits, close that project's writer/searcher.
  Search on an archived project follows whatever the project endpoints already do for archived
  projects. Index files remain on disk until a future hard delete (out of scope).
- Add a `/actuator/health` contributor that reports `UNAVAILABLE` (e.g. lock not obtained) as
  `DEGRADED`/`OUT_OF_SERVICE` detail, without failing the overall health.

## Acceptance criteria

- [x] Integration test: index a project, then append revisions directly without the listener
      (disable it, or clear its queue to simulate a crash). Restarting the runner catches up; the
      new content is searchable and the stamp equals the latest revision.
- [x] Integration test: delete the index directory (filesystem directory in a temp root). The runner
      rebuilds, and all current assets are searchable.
- [x] Integration test: a schema-version mismatch triggers a rebuild.
- [x] Integration test: queries succeed during `POST /search/reindex` and return the pre-rebuild
      index until the swap, then the rebuilt index. A concurrent second reindex returns `409`.
- [x] `GET /search/status` reflects `lag` and `state`. `reindex` requires PROJECT_ADMIN and returns
      `403` for EDITOR/VIEWER members and `404` for non-members (§8.4).
- [x] Archiving a project closes its index (no open file handles; verified via the service's
      open-index registry).
- [x] Startup with a locked index directory (a simulated second instance) logs the
      single-instance error, marks the search state `UNAVAILABLE`, and the app still starts.
- [x] OpenAPI regenerated; `ui/src/app/core/api/generated/schema.d.ts` updated
      (`npm run generate:api`).
- [x] `./gradlew build` green.

## Out of scope

- Multi-instance deployment (per-node indexes or a shared index store). Documented only
  (`M23.5.1`).
- Hard project deletion and index file removal.
- UI for reindex/status beyond what `M23.4.2` shows (an admin button can come later).

## Notes / hazards

- **Crash consistency is the whole point.** The stamp must only ever be written in the same Lucene
  commit as the documents it covers (`M23.1.1`), and only advanced under `M23.2.1`'s gapless rule.
  A stamp ahead of the documents silently hides content forever; a stamp behind only costs a replay.
- **Replaying `summary.assets` for very old revisions.** `summary` is the §7.2 denormalized list and
  is retained for all revisions (Q4: unlimited retention). If §7.7 compaction ever lands, catch-up
  must fall back to a full rebuild when a revision's summary is compacted (`revision.compacted`
  flag).
- **Rebuild memory.** Page through versions (no `findAll`). Use `IndexWriterConfig.setRAMBufferSizeMB`
  sized for the 5,000-page benchmark, and commit at the end, not per document.
- **Windows dev machines.** Renaming a directory that still has open handles fails. Close
  writer/searcher/`SearcherManager` references and wait for in-flight searches (`acquire`/`release`)
  before the swap. Test the swap on Windows (the maintainers' dev OS).
