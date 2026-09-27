---
id: M29.3.3
status: done
depends: [M29.1.1]
epic: m29-housekeeping-jobs
feature: extended-jobs
area: backend
---

# M29.3.3 — Search-index maintenance

## Context

- `SearchIndexer` (`sync` `:295-309`: stamp vs head, replay or rebuild; `requestSync` `:139`; `requestRebuild` `:148`;
  `status` `:158`).
- `IndexCheck`, `SearchIndexServiceImpl` (its own `refreshAll` executor), `SearchIndexCatchUpRunner` (startup only),
  `SearchIndexHealthIndicator`.
- The indexer skips archived projects.
- Metrics `sf.search.index.*`.
- Epic decision 12.

## Goals

- **Job `search-maintenance`** (default `0 5 * * *`, settings `mergeDeletesPct` = 20), for every non-archived project:
  1. `requestSync` and wait until idle (bounded), which catches up a lost after-commit event.
  2. **Count check.** Compare the index's live document count with the number of indexable current versions (the same
     query the rebuild uses: `findCurrentVersionIdsByProject`, filtered to the indexed types). On a mismatch:
     `requestRebuild`, reported as "repaired".
  3. **Merge.** When deleted documents exceed `mergeDeletesPct` of `maxDoc`, `forceMergeDeletes()` (not a full
     `forceMerge(1)`).
- A project with a rebuild already in progress (`SF-SEARCH-0409`) is reported `SKIPPED` for that project, and the job
  continues.
- Report per project: lag before/after, doc counts, repaired or merged, duration.
- `SearchIndexer` exposes the counts and merge through a small maintenance API. The job doesn't touch Lucene directly.

## Acceptance criteria

- [x] A project whose index lost one document (deleted directly in the test) is detected and rebuilt, and search
      finds the asset again.
- [x] A project whose indexing event was dropped (listener disabled for one commit) is caught up by the job.
- [x] Merge is triggered above the threshold and not below (small index fixture).
- [x] Archived projects are skipped, and an unavailable index (`SF-SEARCH-0503`) is reported, not failed.
- [x] `./gradlew build` green.

## Out of scope

- Multi-node search (§26.2 stays single-writer).

## Notes / hazards

- The count must use exactly the indexer's notion of indexable (types, non-deleted, open versions). Otherwise
  maintenance rebuilds every night. Share the predicate and don't re-implement it.
- M27 changes nothing for search (drafts are indexed). If M27 adds a release-status facet, the count stays per asset.

### Deviations

- **Job** `housekeeping.search.SearchMaintenanceJob` + `SearchMaintenanceProperties`
  (`sf.housekeeping.search-maintenance.merge-deletes-pct`, default 20). Per project the report holds `lagBefore`,
  `lagAfter`, `indexable`, `documents`, `deleted`, `documentsAfter` (after a repair), `merged`, `durationMs`, `result`
  (`OK`, `REPAIRED`, `SKIPPED`, `UNAVAILABLE`, `TIMEOUT`) and `code` (`SF-SEARCH-0409`/`0503`); plus
  `archivedSkipped`. An unavailable index or a timeout makes the run `PARTIAL`; a running rebuild is `SKIPPED`.
- **Maintenance API on `SearchIndexer`**: `syncAndAwait(projectId, timeout)`, `awaitProject(projectId, timeout)`,
  `counts(projectId)` → `IndexCounts(indexable, documents, deleted, maxDoc)` and `forceMergeDeletes(projectId)`; counts
  and merge run under the project's indexing lock, so no sync moves the index meanwhile. `SearchIndexService` gained
  `stats(projectId)` (`IndexWriter.getDocStats`) and `forceMergeDeletes(projectId)` (commits with the unchanged
  revision stamp and owner). The waits are bounded at 10 minutes per project (a constant, not a setting).
- **Shared predicate**: `SearchTextExtractor.indexes(asset)` (default `true`; `FolderTextExtractor` overrides it with
  its fixed/protected-folder rule and uses it in `extract`), exposed as `SearchTextExtractorRegistry.indexes`. The
  count runs it over the rebuild's own query (`findCurrentVersionIdsByProject`), so a healthy index always matches.
  An asset whose extraction keeps failing makes the counts differ, and the job rebuilds (and reports it) every run
  until it is fixed.
- **Merge policy**: Lucene's `TieredMergePolicy` already expunges segments above ~20 % deletes on its own, and its
  `forceMergeDeletes` skipped segments under 10 % deletes. The writers now set `forceMergeDeletesPctAllowed(0)`, so
  when maintenance decides to merge (index-wide share above `mergeDeletesPct`) every segment's deletes go. In practice
  the job merges rarely; the test fixture keeps one delete in eleven documents (below Lucene's own threshold).
- Tests: `SearchMaintenanceIntegrationTest` (filesystem index, live indexing off): lost document → `REPAIRED` and found
  again; lost indexing event → caught up by the sync, no rebuild; merge at 5 % but not at 50 %, stamp unchanged;
  archived project not in the report, a locked index reported `UNAVAILABLE` / `SF-SEARCH-0503` with the run `PARTIAL`.
