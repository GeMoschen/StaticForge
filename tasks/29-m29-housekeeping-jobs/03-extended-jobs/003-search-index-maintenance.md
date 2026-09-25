---
id: M29.3.3
status: todo
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

- [ ] A project whose index lost one document (deleted directly in the test) is detected and rebuilt, and search
      finds the asset again.
- [ ] A project whose indexing event was dropped (listener disabled for one commit) is caught up by the job.
- [ ] Merge is triggered above the threshold and not below (small index fixture).
- [ ] Archived projects are skipped, and an unavailable index (`SF-SEARCH-0503`) is reported, not failed.
- [ ] `./gradlew build` green.

## Out of scope

- Multi-node search (§26.2 stays single-writer).

## Notes / hazards

- The count must use exactly the indexer's notion of indexable (types, non-deleted, open versions). Otherwise
  maintenance rebuilds every night. Share the predicate and don't re-implement it.
- M27 changes nothing for search (drafts are indexed). If M27 adds a release-status facet, the count stays per asset.
