# Generation benchmark

Proves the §18.6 generation targets on a realistic fixture (also §26.1 scalability, §25.1
performance row).

## What it measures

`server/sf-app/src/test/java/com/acme/staticforge/benchmark/GenerationBenchmark.java` builds a
real project fixture — one page template plus **N** pages created through the production
`AssetService` (so the revision machinery and generation pipeline run realistically) — and then:

1. runs a **FULL** generation, timing wall-clock and recording files written;
2. edits a single page (opening a new revision);
3. runs an **INCREMENTAL** generation, timing how long it takes to re-render just the affected page.

It prints a summary line, e.g.:

```
pages=500, fullMs=1200, incrementalMs=95, filesWritten=500, incrementalFilesWritten=3, fixtureMs=1800
```

## Targets (§18.6)

| Pages  | Full             | Incremental     |
|--------|------------------|-----------------|
| 500    | < 20 s           | < 2 s           |
| 5,000  | < 5 min          | < 10 s          |
| 50,000 | < 45 min         | < 30 s          |

Measured with **2 channels**, **8 vCPU**, media unchanged.

## Running

```sh
infra/scripts/benchmark-generation.sh            # 500-page smoke
infra/scripts/benchmark-generation.sh 5000       # §18.6 target fixture
infra/scripts/benchmark-generation.sh 50000      # heavy fixture (nightly)
```

The underlying Gradle invocation is:

```sh
SF_PERF=true ./gradlew --no-daemon :server:sf-app:test \
    --tests '*GenerationBenchmark*' --console=plain
```

## Gating

The benchmark is **off by default**. `GenerationBenchmark` is annotated
`@EnabledIf("perfEnabled")`, which returns true only when `-Dsf.perf=true` (system property) or
`SF_PERF=true` (environment variable) is present. The script uses the environment variable and
`--no-daemon` because Gradle does not forward `-D` system properties to the forked test JVM
without explicit `systemProperty` wiring in the build.

Because it is gated off, the default `./gradlew build` stays green and the Spring context is
never loaded.

## Configuration (system property / env var)

| Property / env     | Default        | Meaning                                   |
|--------------------|----------------|-------------------------------------------|
| `sf.perf` / `SF_PERF`            | unset          | Enables the benchmark                      |
| `sf.perf.pages` / `SF_PERF_PAGES`| `500`          | Fixture page count                         |
| `sf.perf.out` / `SF_PERF_OUT`    | `build/perf-results/generation-summary.txt` | Summary output file |
| `sf.perf.timeoutMs` / `SF_PERF_TIMEOUT_MS` | `max(60s, pages × 150ms)` | Await-terminal deadline |

## Notes / deviations

- The **heavy matrix (5,000 / 50,000 pages)** belongs to the **nightly CI job** (added by the CI
  agent), not a per-push gate — see `tasks/07-m7-hardening/02-performance/002-generation-benchmark.md`.
- The fixture uses a **minimal static HTML template** on purpose: the page count dominates the
  measured throughput, so a content-rich template would only add noise. Pages still carry
  distinct UIDs/output paths so full generation renders one file per page.
- The fixture is built through real services (one revision allocation per asset). For very large
  N this fixture-build phase can be slow; it is **not** part of the measured generation time.
  A lighter direct-insert bulk-feed path is a documented future escape hatch (§26.2) if the
  nightly job needs faster fixture construction.

---

# Search benchmark (M23.5.1)

`infra/scripts/benchmark-search.sh [pages]` runs the perf-gated `SearchBenchmark` (same gating as above, `SF_PERF=true`)
on a filesystem index. The fixture is built through the real services: a page template with a text intro, a rich-text
body and a section body, a section template, and `N` pages (default 5,000, the generation benchmark's size), each with
~110 words of German/English prose from a fixed vocabulary in its intro, body (paragraphs, bold, a list) and one
section. Live indexing is on while the fixture is built, like in production.

It measures:

- **Full rebuild** of the project's index (`POST /search/reindex`'s path: `SearchIndexer.requestRebuild` until idle).
- **200 queries** through `SearchService.search` (validation, index status, query, facets, snippets; no HTTP), 50 each of:
  a uid prefix (`benchmark_page_42`), a single word, a two-word phrase, a word filtered by `type=PAGE` and
  `folder=/pages_root/`. p50/p95/max over all, p95 per kind. 20 warm-up queries are not measured.
- **Indexing lag** during a burst of 100 page saves (the largest `lag` seen, sampled every 10 saves) and the time the
  index needs to catch up after the last save.

## Results (2026-09-17)

Intel Core i5-7600K (4 cores / 4 threads), 64 GB RAM, SATA SSD, Windows 10, OpenJDK 21.0.11, H2 in-memory (`test`
profile), the same machine class as the generation benchmark runs.

| Measure | Target (M23) | Result, 5,000 pages |
|---|---|---|
| Full rebuild (5,002 documents) | < 60 s | **1.6 s** |
| Query p50 / p95 / max (200 queries) | p95 < 150 ms | **19.5 / 34.6 / 93.8 ms** |
| p95 by kind: uid prefix / word / phrase / filtered | | 17.9 / 39.2 / 34.6 / 35.4 ms |
| Burst of 100 saves | | 556 ms, index at most 72 revisions behind |
| Catch-up after the burst | | 232 ms |
| Index size on disk | | 4.9 MB |

```
pages=5000, fixtureMs=31576, rebuildMs=1604, queries=200, totalHits=477237, p50Ms=19.5, p95Ms=34.6, maxMs=93.8,
uidPrefixP95Ms=17.9, wordP95Ms=39.2, phraseP95Ms=34.6, filteredP95Ms=35.4, burstSaves=100, burstMs=556,
maxLagDuringBurst=72, settleAfterBurstMs=232, indexBytes=4893593
```

Both targets are met with a wide margin; no follow-up task was needed. The queries found 2,386 hits on average (the fixture
draws from a 50-word vocabulary), so they count and rank far more hits than typical editorial searches.
During the burst, syncs coalesce (at most one pending per project), which is why the lag rises while saving and drops to
zero within a fraction of a second after.
