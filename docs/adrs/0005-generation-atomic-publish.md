# ADR-0005 — Generation: snapshot → plan → atomic staged publish, one run per project

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** Tech lead (specced in `cms-specification.md` §18)

## Context

Generation must be reproducible (generate any past revision), predictable (5,000 pages < 5 min), and safe (a failed run must never clobber the currently-published site). A naive "write files in place" approach violates all three.

## Decision

1. **Eight-stage pipeline on a pinned, immutable snapshot.** `SnapshotService` loads an in-memory `Snapshot` of all assets at revision R; `BuildPlanner` computes the file set (`BuildPlan`/`PlanEntry`), expanding incremental changes over `asset_reference` reverse edges (transitive, navigation-aware). `GenerationRenderer` renders in parallel over virtual threads bounded by `sf.generate.parallelism`; `AssetCopyStage` copies content-addressed media; `PostProcessStage` runs per-channel post-processors (sitemap, robots, redirects, search index, HTML pretty-print).

2. **Atomic publish via staged directories.** Filesystem targets write to `{root}/builds/{runId}/` and then flip a `current` symlink; a failed run leaves `current` untouched. `FilesystemTargetWriter` implements this; `ZipTargetWriter` and `S3TargetWriter` implement the other target types behind `TargetWriter`/`TargetWriterSelector`. The last N builds are retained for instant rollback (`POST /generations/{runId}/promote`). `{root}` is per target — `{output-root}/{projectKey}/{config.path | target-{id}}` (`TargetLocations`) — so projects and targets never share a `current` pointer or retention pool. Output from the earlier shared-root layout (`{output-root}/builds`, `current`, `s3`) is removed at startup by `LegacyOutputCleanupRunner` when no project owns that key and the contents match the old layout; disable with `sf.generate.cleanup-legacy-output=false`.

3. **One active run per project.** A second generation request for a busy project returns `SF-GEN-0500` (409) with the running run id. Progress streams to the UI over Server-Sent Events (`GET /generations/{id}/events`), and `GenerationRun` records counts, timings, and diagnostics.

4. **Validate before write.** ERROR-severity findings (compile errors, output-path collisions `SF-GEN-0110`) abort before any file is written; warnings (`SF-GEN-0210` missing channel template, `SF-GEN-0410` nav cycle) degrade the affected files only.

5. **Generation runs outside the request transaction.** The snapshot is a read-only view of a pinned revision, so a long build never holds a lock (spec §21.4).

## Consequences

- Output paths resolve deterministically via `OutputPathResolver` (path override → template `outputPath` → project default), with collision detection across pages.
- Reproducible republishing and rollback verification are free: pass a revision and the site is generated *as it was* (§18.1).
- `GenerationService` and the `target`/`stage`/`postprocess` packages own the pipeline end-to-end in `sf-generate`, keeping `sf-domain` free of build mechanics.
