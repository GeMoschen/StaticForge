---
id: M27.1.4
status: done
depends: [M27.1.2]
epic: m27-release-and-scheduling
feature: release-model
area: backend
---

# M27.1.4 — Release performance for large selections

## Context

Found while benchmarking M27.2 (`GenerationBenchmark`, 5,000 pages × 2 locales, 2026-09-25): the first
`ReleaseFixtures.releaseAll` — one `ReleaseService.release` call with 10,000 (asset, locale) items — took 428–486 s;
later calls with a handful of items took 2–4 s. The machine was under load, but load doesn't explain a 100× gap. The
measured time also included `ReleaseFixtures`' golden check (two full renders of the project, ~20–30 s), so the release
itself was not measured in isolation.

A "Release all" in the Changes view (`M27.6.2`) and a scheduled release of a large selection (`M27.4.2`) hit exactly
this path. `ReleaseServiceImpl`, `ChangesService`, `ReleaseCompleteness`, `ReleaseStatusService`. Epic decisions 9, 10,
12.

## Goals

- **Measure first.** A benchmark (extend `ReleaseMigrationBenchmark` or a new `ReleaseBenchmark`, gated on `SF_PERF`)
  that times `ChangesService.list`, `ReleaseService.plan` and `ReleaseService.release` separately for 5,000 pages × 2
  locales (10,000 items), without the golden check. Record where the time goes (query count, flush count, CPU).
- **Fix the cause.** Likely suspects, to confirm or rule out with the measurement:
  - per-item queries in `ReleaseServiceImpl.resolve` (asset and open version looked up one by one; `pinnedVersion`);
  - Hibernate auto-flush dirty-checking every managed entity before each query in one large transaction (quadratic
    in the number of loaded versions and pointers);
  - `ReleaseCompleteness.blockingIssues` per item (template/definition lookups, CDL compiles) without a per-call memo;
  - per-pointer `save` in `closeIfOpen` instead of a batch update.
- **Target:** releasing 10,000 items in one call finishes in a few seconds on the benchmark (the same order as a full
  build of that project), with a bounded number of queries (assert it in a test, like the `release` block's bounded
  status calls in M27.1.3).
- Behaviour unchanged: one revision, the same refusals (`SF-DOM-0150`–`0154`) with nothing written, the same summary.

## Acceptance criteria

- [x] Benchmark numbers before and after recorded in this file (release, plan, Changes list; 10,000 items).
- [x] Releasing 10,000 items takes seconds, not minutes; query count bounded independent of the item count.
- [x] `ReleaseServiceIntegrationTest`, `ReleaseApiTest` and the `RevisionInvariantsTest` release property green.
- [x] `./gradlew build` green.

## Out of scope

- UI for "Release all" (`M27.6.2`), scheduled releases (`M27.4.2`).

## Notes / hazards

- Refusals must still leave the revision counter untouched (lesson "throw to roll back" — assert it).
- Don't disable flushing globally; scope any `FlushMode` change to the release call and prove the writes still land.

## Implementation notes

**Benchmark** (`benchmark/ReleaseBenchmark`, opt-in: `SF_PERF=true SF_PERF_PAGES=5000 ./gradlew :server:sf-app:test
--tests "*ReleaseBenchmark" --rerun`; summary in `build/perf-results/release-summary.txt`). 5,000 never-released pages ×
2 locales in 50 folders, each page referencing one shared media asset; one item per (asset, locale) the Changes list
shows = **10,101 items**, released in one call, like "Release all". No golden check, no build. Statement, flush and
entity-load counts from Hibernate statistics.

| Step | Before | After |
|---|---|---|
| `ChangesService.list` (all rows) | 161 ms, 25 statements | 180 ms, 34 statements |
| `ReleaseService.plan` | 2,521 ms, 40,222 statements | 1,028 ms, 40 statements |
| `ReleaseService.release` | **328,682 ms**, 40,224 statements | **1,819 ms**, 10,145 statements |

The remaining release statements are the 10,101 pointer inserts (one per opened pointer: `asset_release` ids are
`IDENTITY`, which Hibernate can't batch) plus ~44 reads and the revision writes.

**Cause.** Plan and release ran the same ~4 statements per item, but plan took 2.5 s and release 329 s. The
difference is the transaction: `plan` is read-only (flush mode `MANUAL`), `release` is read-write, so each of its
~40,000 queries first auto-flushed, and Hibernate dirty-checks every managed entity for that — 10,000+ versions,
assets and pointers, growing as the call loads them. Quadratic. Of the suspects in the task text:
- per-item queries in `resolve` (asset, open version, pinned version) — **confirmed**, the main source of queries;
- auto-flush dirty checking — **confirmed** as the multiplier; fixed by removing the per-item queries, not by
  changing `FlushMode` (no flush-mode change was needed, so the hazard note doesn't apply);
- `ReleaseCompleteness` per item — **confirmed**: every check built a new `TemplateHierarchy` (template asset and
  version re-read, CDL recompiled) and a new content validator;
- per-pointer `save` in `closeIfOpen` — harmless on its own (the pointers are managed), but now one `saveAll`.

**Fix.**
- `resolve` loads assets (`findByProjectIdAndUuidIn`), open versions (`findOpenWithAssetByAssetIdIn`), pinned
  versions, pointers and released versions in bulk, chunked by `Chunks` (PostgreSQL's bind-parameter limit). The
  refusal order and messages are unchanged (validated per uuid in selection order after loading).
- `ReleaseCompleteness.checker(projectId)` replaces the per-item method: one `PageContentValidation.Session` (new —
  hierarchy, validator, section templates and each template's effective definition resolved once; the existing
  `issues(projectId, payload)` now goes through it), one record validator, dataset schemas and global set schemas
  memoized. `plan` and `release` each create one checker per call.
- The plan's dependency walk (`Dependencies.propose`) processes the queue one breadth-first layer at a time — the same
  order as before — reading the layer's outgoing edges in one query (new `AssetReferenceRepository
  .findByFromAssetIdInAndValidToRevisionIsNull`) and prefetching the drafts and statuses of every edge target and
  parent folder in bulk. Record-set members and folder descendants are still listed per container (bounded by the
  number of containers, not items) but their drafts are prefetched.
- `release`/`unpublish` close pointers with one `saveAll`.

**Tests.** `ReleaseQueryCountIntegrationTest`: the same selection shape with 4× the items runs exactly as many reads
(plan and release) and the same updates, and the release adds exactly one insert (the pointer) per extra item;
against the old code it fails (plan 71 → 221 reads). Statements are counted on the test thread only
(`ThreadStatementCounter`, a Hibernate `StatementInspector`): with Hibernate's global statistics the full suite
failed it, because the context's scheduler poll and search indexer query in the background. An incomplete page inside a
40-page selection refuses the release with `SF-DOM-0150`, leaves the revision count unchanged and opens no pointer.
Each measured call follows an unmeasured plan of the same project, so shared per-project caches are equally warm —
without that the counts depended on test order, not on the selection.
