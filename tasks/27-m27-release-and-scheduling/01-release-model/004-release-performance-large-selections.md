---
id: M27.1.4
status: todo
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

- [ ] Benchmark numbers before and after recorded in this file (release, plan, Changes list; 10,000 items).
- [ ] Releasing 10,000 items takes seconds, not minutes; query count bounded independent of the item count.
- [ ] `ReleaseServiceIntegrationTest`, `ReleaseApiTest` and the `RevisionInvariantsTest` release property green.
- [ ] `./gradlew build` green.

## Out of scope

- UI for "Release all" (`M27.6.2`), scheduled releases (`M27.4.2`).

## Notes / hazards

- Refusals must still leave the revision counter untouched (lesson "throw to roll back" — assert it).
- Don't disable flushing globally; scope any `FlushMode` change to the release call and prove the writes still land.
