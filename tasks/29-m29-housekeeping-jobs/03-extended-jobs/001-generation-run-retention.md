---
id: M29.3.1
status: done
depends: [M29.1.1, M29.2.1, M29.2.2]
epic: m29-housekeeping-jobs
feature: extended-jobs
area: backend
---

# M29.3.1 — Generation-run retention

## Context

- `GenerationRun` and `GenerationRunRepository` (`findByProjectIdOrderByIdDesc`).
- `RunPlanStore.prune` (`:321-344`, `sf.generate.plan-retention-runs`).
- `TargetWriter.currentRunId`/`readManifest`; build manifests (`builds/{runId}.manifest.json`: consistent revision, base
  run).
- `scheduled_action_execution.generation_run_id` (`M27.4.x`).
- The UI run list (`features/generation/generation.component.*`).
- Epic decision 11.

## Goals

- **Job `generation-run-retention`** (default `15 4 * * *`, settings `keepDays` = 90, `keepPerProject` = 50, dry run).
  Per project it computes the **protected** set (decision 11):
  - runs with a build on disk in any target;
  - the `current` run of every target;
  - `QUEUED`/`RUNNING` runs;
  - base or baseline runs named in retained manifests;
  - runs referenced by schedule executions younger than `keepDays`.

  It then deletes runs that are both older than `keepDays` and outside the newest `keepPerProject`, and not protected.
  Their `generation_run_plan_entry` and `generation_run_plan_node` rows are deleted in the same batch.
- The target writer's retained-build listing becomes a method (`TargetWriter.retainedRunIds()`), so the job doesn't
  parse directories itself.
- Report: runs deleted per project, and the oldest remaining run.
- The UI and API keep working with gaps in run ids: no "previous run" assumptions. Check `GenerationComponent` and
  `insight/` for them.

## Acceptance criteria

- [x] With `keepDays = 0` and `keepPerProject = 2`, every unprotected run beyond the two newest is deleted, and a
      promotable build older than both is kept.
- [x] An incremental build after retention still finds its baseline (no fallback to full because of retention).
- [x] Deleting a run removes its plan rows, and `GET /generations/{id}/plan` of a deleted run answers `404`.
- [x] Schedule execution history showing a deleted run displays it as "run deleted" (API field null-safe).
- [x] A dry run matches the real run.
- [x] `./gradlew build` green.

## Out of scope

- Archiving run diagnostics elsewhere before deletion.

## Notes / hazards

- `generation_run` may be referenced by FKs added in M27 (`scheduled_action_execution.generation_run_id`). Make that FK
  `ON DELETE SET NULL`, or null it in the job before deleting. Decide, and test on PostgreSQL semantics with H2 parity.

### Deviations

- **No foreign key to decide on**: `scheduled_action_execution.generation_run_id` has none (022). The job unlinks the
  executions of the runs it deletes in the same batch transaction and keeps the id as
  `detail.deletedGenerationRunId`; the API field is simply `null`, and the schedule history UI shows
  "Generation run #N (run deleted)" (`schedule-history.component`, with a spec).
- **Base runs**: build manifests don't name a base run, so the protected base is the `planSummary.baseRunId` of every
  run with a build on disk (the build it was carried from).
- A run's age is `finished_at` (else `started_at`). Settings: `keepDays` 0–36500, `keepPerProject` 0–1,000,000.
- Plan rows are deleted explicitly in the batch (the FK cascade of 016 would also remove them).
- `retainedRunIds()` was added with M29.2.2 (published builds on disk + `current`).
- UI check: `GenerationComponent` and `insight/` make no "previous run" (id − 1) assumptions; a deleted run simply
  isn't listed, and `GET /generations/{id}/plan` answers `404`.
