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
