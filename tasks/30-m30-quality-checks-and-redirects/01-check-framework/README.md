# Feature: Check framework — rules over rendered HTML, configuration, findings, pipeline stage

**Spec:** Extends §18.2 (new `CHECK` stage), §18.4 (`quality.json` sidecar), §18.5 (findings), §20.2 (quality-rules
and findings endpoints).

## Goal

Give the build a place to look at what it wrote: parse every HTML output once, run configurable rules over it and
over the whole site, store the findings per run, and hold back pages with error-level findings.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-quality-rule-spi-and-html-facts.md](001-quality-rule-spi-and-html-facts.md) | — |
| 2 | [002-rule-configuration-and-findings-store.md](002-rule-configuration-and-findings-store.md) | 1 |
| 3 | [003-check-stage-in-generation.md](003-check-stage-in-generation.md) | 1, 2 |

## Feature exit criteria

- [x] A test rule set runs over a fixture build; findings are stored per run and served paged and filtered.
- [x] `ERROR` holds the page back (`SF-GEN-0125`, run `PARTIAL`); `WARNING` leaves the run `SUCCESS`.
- [x] Incremental runs reuse carried facts/findings from the base sidecar; missing sidecar or changed rules → FULL.
- [x] `./gradlew build` green.

## Dependencies

`M27` (snapshot views), `M22` (manifests, baseline, `FallbackCause`), `GenerationService`, `RenderPipeline`,
`CarryForward`, `TargetWriter` implementations.
