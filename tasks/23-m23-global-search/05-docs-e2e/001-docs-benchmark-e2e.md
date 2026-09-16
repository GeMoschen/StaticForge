---
id: M23.5.1
status: todo
depends: [M23.2.2, M23.3.1, M23.4.1, M23.4.2]
epic: m23-global-search
feature: docs-e2e
area: qa
---

# M23.5.1 — Search docs, benchmark, E2E journey

## Context

- **E2E.** Playwright journeys live in `ui/e2e/` (`m6-journeys.spec.ts`, `m15-journeys.spec.ts`).
  Earlier milestones recorded that journeys collect cleanly but were not always run against a live
  backend.
- **Benchmark.** The generation benchmark is `infra/scripts/benchmark-generation.sh` +
  `infra/scripts/README-benchmark.md` (5,000-page fixture, §2.1 G5).
- **Operations docs.** `infra/docker/docker-compose.yml` defines volumes `db-data`, `media-data`
  and `output-data` and env `SF_MEDIA_ROOT`/`SF_OUTPUT_ROOT`. Deploy and backup runbooks:
  `infra/docs/deploy-runbook.md`, `infra/docs/backup-recovery-runbook.md`.
- **User and architecture docs.** `docs/user-guide.md`, `docs/api.md`, `docs/architecture.md`.

## Goals

- **E2E** `ui/e2e/m23-journeys.spec.ts`, journey "find and fix":
  1. Log in and open the project.
  2. Create a page whose rich-text value contains a unique term.
  3. Ctrl+K, type the term, and see the page in the results.
  4. Enter opens the editor.
  5. Replace the term and save.
  6. Ctrl+K with the old term shows no result for that page; the new term finds it.
  7. Open the search page, filter by type, and see the facet counts.

  Add a second short journey: a media alt-text search opens the media drawer via deep link.
- **Benchmark.** Extend the benchmark tooling (a separate script or flag, e.g.
  `benchmark-search.sh`):
  - Seed or reuse the 5,000-page fixture.
  - Measure the full rebuild duration (target < 60 s).
  - Measure p50/p95 for 200 representative queries: uid prefix, single word, phrase, filtered
    (target p95 < 150 ms).
  - Measure indexing lag after a burst of 100 page saves.
  - Record the results in `README-benchmark.md`.
- **Docs:**
  - `docs/user-guide.md`: searching (palette, search page, what is searchable, current-revision
    note).
  - `docs/api.md`: `/search`, `/search/status`, `/search/reindex`.
  - `docs/architecture.md`: new §"Search" section covering the embedded Lucene index in
    `sf-domain` `search` package, after-commit indexing from `summary.assets`, revision stamp
    catch-up and the rebuild swap.
  - Spec: §20.2 catalogue, Appendix B codes (`SF-SEARCH-0400`, `SF-SEARCH-0503`), §25.6 journey
    list, §26.2 scalability note.
  - `infra/docker/docker-compose.yml`: `SF_SEARCH_INDEX_ROOT` + `search-index` volume.
  - `infra/README.md` + `infra/docs/deploy-runbook.md`: the **single-instance constraint** (why,
    symptoms such as the lock error and `UNAVAILABLE` state, and what multi-instance would need),
    that the index needs no backup (rebuildable; the backup runbook should say "exclude"), and how
    to force a rebuild (delete the volume or call reindex).

## Acceptance criteria

- [ ] `m23-journeys.spec.ts` exists and passes against a live dev backend. If it cannot run here,
      record the exact reason and what was verified instead (manual Playwright run with
      screenshots of each step).
- [ ] Benchmark executed; numbers recorded with hardware notes; any missed target has a follow-up
      task file added in the relevant feature.
- [ ] All listed docs updated. `docker compose config` validates with the new volume/env.
- [ ] Epic README exit criteria ticked with evidence (test names, benchmark numbers), in the same
      style as `M15`'s README.

## Out of scope

- Implementing multi-instance search.
- Load testing beyond the single-node benchmark.

## Notes / hazards

- E2E runs against H2 dev profile by default; the index must use a temp or `build/` directory
  there, never a shared path between parallel test workers.
- Benchmark on the same machine class as the generation benchmark, so numbers are comparable.
