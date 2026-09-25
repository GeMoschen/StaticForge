---
id: M29.2.2
status: todo
depends: [M29.2.1]
epic: m29-housekeeping-jobs
feature: core-jobs
area: backend
---

# M29.2.2 — Build output cleanup and published-only rollback slots

## Context

- `FilesystemTargetWriter`: `builds/{runId}` directories; `current` symlink or marker; `.current-<nanos>.link`
  temporary links (`:157`); `prune()` (`:177-212`) counts every numeric directory except `current`; `promote` (`:121`)
  only checks `Files.isDirectory`.
- `ZipTargetWriter`: `builds/{runId}.zip`, `{runId}.zip.tmp`, manifests.
- `TargetWriterSelector`, `GenerationTarget` and `TargetController.delete` (`:102`, removes only the row).
- Output root `{sf.generate.output-root}/{projectKey}/{path}` (spec §18.4).
- `LegacyOutputCleanup` (startup, pre-M22 layout).
- Epic findings 5.

## Goals

- **Rollback slots count published builds only.**
  - `prune()` (filesystem and ZIP) counts only builds of runs that were published.
  - Tell "published" by the run row (`SUCCESS`/`PARTIAL` with this target) or, without DB access in the writer, by the
    presence of the manifest, which is written only right before `publish`. Pick one, document it, and make
    `keep-builds` mean "the last N published builds + current".
- **Promote refuses unpublished builds.** `GenerationService.promote` refuses a run that isn't `SUCCESS`/`PARTIAL` or
  doesn't belong to the target: `409` with a clear message, reusing the existing generation problem style and
  documented in Appendix B by `M29.6.1`.
- **Job `build-output-cleanup`** (default `10 3 * * *`, dry run supported, setting `minAge` = 1 h), for every project
  and target:
  - staged output of runs in `FAILED`/`CANCELLED`, of runs with no row, and of `QUEUED`/`RUNNING` runs older than
    `minAge` that recovery has since failed: `builds/{id}` directories, `{id}.zip.tmp`, and manifests without a build;
  - `.current-*.link` older than `minAge`;
  - directories under `{output-root}/{projectKey}/` that belong to no existing target (deleted targets). The `target-{id}`
    and `config.path` rules of §18.4 decide ownership, and the legacy layout is left to `LegacyOutputCleanup`;
  - never `current`, the build `current` points at, or a directory whose run is still executing locally.
- **Report.** Paths removed per project and target (sample), plus the bytes freed (the directory walk size).

## Acceptance criteria

- [ ] Filesystem and ZIP tests: a failed run's staged output is removed by the job, and a published build within
      `keep-builds` stays.
- [ ] Five failed runs no longer push published builds out of `keep-builds` (regression test on `prune`).
- [ ] Promote of a `FAILED` run → `409`, and `current` is unchanged.
- [ ] A deleted target's directory is removed. A directory belonging to an existing target with a custom `config.path`
      is kept.
- [ ] A dry run lists the same paths and bytes and deletes nothing.
- [ ] `./gradlew build` green.

## Out of scope

- S3 (`S3TargetWriter` is a local-mirror stub; follow-up when it writes to real buckets).
- Retention of run rows (`M29.3.1`).

## Notes / hazards

- Path safety: every deletion goes through `TargetIo`, with an assertion that the path lies under the target root
  (spec §26.3 path traversal). Symlinks are deleted as links, never followed.
- Hard-linked carried files (M22) share inodes with newer builds. Deleting a directory removes links, not the data of
  other builds, so no special handling is needed. Keep a test that proves it.
