# M4 — Generation

**Spec:** §18 (generation pipeline), §20.2 (generation/targets endpoints).
Roadmap M4 (§27): 3 weeks.

## Goal

Implement the generation pipeline end to end: snapshot + plan (full/incremental), parallel
render, output-path resolution, targets with atomic publish, post-processors, run records
with SSE progress, and the generation UI.

## Exit criteria (epic is done when)

- [ ] A 5,000-page fixture builds within target (§18.6) and incremental single-page builds
      in < 10 s. _(benchmark lives in M7 `02-performance/002-generation-benchmark.md`; M4 proves functional correctness + a small end-to-end fixture, not the 5k run)_
- [x] Rollback (`promote`) works; failed runs leave `current` untouched.

## Implementation status

All 11 tasks implemented. `sf-generate` (previously empty) now holds the full pipeline:
snapshot → plan → validate → render (parallel) → asset copy → post-process → write → report,
plus the REST API, SSE progress, and the generation UI.

Verified: `./gradlew build` green (all modules + spotless + `checkModuleLayers` + tests, incl.
`GenerationIntegrationTest` proving a full build writes files, publishes `current`, and
rollback/`promote` behavior); `ui` `ng build` green + 55 vitest tests green.

**Cross-module note:** `sf-generate` gained a direct `sf-common` dependency (added to
`allowedEdges`) so it can throw coded `SfException` problems (`SF-GEN-0500` active-run 409,
`SF-GEN-0110` output-path collision) consistent with the rest of the codebase. `sf-generate`
also gained `spring-boot-starter-web` solely for `SseEmitter` in the SSE seam.


## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [build-planner](01-build-planner/README.md) | backend | — |
| 2 | [render-pipeline](02-render-pipeline/README.md) | backend | 1 |
| 3 | [targets](03-targets/README.md) | backend | 1 |
| 4 | [postprocess](04-postprocess/README.md) | backend | 2 |
| 5 | [generation-api](05-generation-api/README.md) | backend | 1, 3 |
| 6 | [generation-ui](06-generation-ui/README.md) | frontend | 5 |

## Dependencies

`M1` (revision snapshot, asset_reference), `M2` (renderer), `M3` (media variants).
