---
id: M27.4.3
status: done
depends: [M27.4.1]
epic: m27-release-and-scheduling
feature: scheduler
area: backend
---

# M27.4.3 — `GENERATION` and `RECURRING_GENERATION` actions

## Context

`M27.4.1` (engine, timing, missed policy), `sf-generate/.../generate/GenerationService.java` (`start` `:161-217`,
`startLock`, `findActive` → `409 SF-GEN-0500`, in-memory idempotency keys `:114`), `GenerationRequest`
(`mode`, `revision`, `channels`, `targetId`, `folderPath`, `assetUuids`, `comment`), `GenerationRun` (`started_by`),
`resolveTarget` (`:591`). Spec §18.1 "Scheduled | full, cron per project | system". Epic decisions 21, 23, 25, 27.

## Goals

- **`GENERATION` handler** (one-off): params = a generation request (`mode` `FULL`|`INCREMENTAL`, `channels`,
  `targetId`, `scope {folderPath, assetUuids}`, `comment`); `revision` is always "current at execution" (a scheduled
  build of an old revision is not a use case — reject `revision` in `validate`, `422 SF-DOM-0161`). Validation at
  creation: target exists in the project, channels enabled, scope folder exists (`422 SF-DOM-0161` with field errors).
- **`RECURRING_GENERATION` handler**: same params + `cron`/`zone_id` on the action; each slot starts one run.
- **Start as owner.** Runs are started with `startedBy` = owner and `comment` "Scheduled generation #id" (plus the
  user's comment). The execution records `generation_run_id`.
- **Busy project.** If `start` answers `SF-GEN-0500` the execution waits (decision 27): it stays open ("waiting for
  run #n") and is retried on each tick; `SKIP_IF_LATER_THAN` ends it as `SKIPPED` once the lateness bound passes. A
  recurring slot that is still waiting when its next slot comes due is **coalesced** (one run, not two).
- **Idempotency.** Before starting, check the execution for an already-started run for this `scheduled_for`
  (re-claim after lease expiry must not start a second run). Pass a deterministic idempotency key
  (`schedule-{id}-{scheduledFor}`) to `GenerationService.start` as a second guard.
- **Outcome.** The execution finishes when the run is **started** (`SUCCEEDED` = run accepted), not when it ends — the
  run's own status lives in the run history; the execution links it. Document this in the API task.
- **Target deleted** later → execution `FAILED` `SF-DOM-0162` "Target no longer exists"; recurring action paused.

## Acceptance criteria

- [x] One-off full build at T starts one run as the owner with the scheduled comment; the execution links the run.
- [x] Recurring `0 0 3 * * *` Europe/Berlin starts one run per day at 03:00 local (clock-driven test across a DST switch).
- [x] With a run active: the scheduled run starts right after it ends; with `SKIP_IF_LATER_THAN 15m` and a 30-minute
      run it is skipped; overlapping recurring slots coalesce.
- [x] Lease expiry mid-execution → no second run.
- [x] Deleted target → `FAILED SF-DOM-0162`, recurring action paused.
- [x] `./gradlew build` green.

## Out of scope

- Crash recovery of stuck runs (`M29`), persisting run comments (`M28` owns generation audit/attribution changes;
  here only the comment passed to `start`).

## Notes / hazards

- `GenerationService` is single-node (JVM `startLock`): with several app nodes, the scheduler claim guarantees only one
  node starts the run, but two nodes could still race with a manual start — acceptable (the `findActive` check under the
  lock on each node + DB state); note it, don't solve distributed generation here.

## Implementation notes

- `sf-generate/generate/schedule`: `GenerationActionHandler` (`ONE_OFF`) and `RecurringGenerationActionHandler`
  (`RECURRING`) over `AbstractGenerationActionHandler`; `ScheduledGenerations` implements the port
  `ScheduledGenerationStarter` (validation, busy check, `GenerationService.start` as the owner).
- **Params** stored normalized: `{mode, channels[], targetId|null, scope: {folderPath|null, assetUuids[]}, comment?}`.
  Validation (`422 SF-DOM-0161` with `field`): `revision` present, unknown mode, target not in the project (or no
  target at all), channel unknown or disabled, no page under the scope folder, unknown scope pages; `pinPolicy` and
  `thenGenerate` are refused for generation types.
- **Start**: busy is detected before starting (`findActive` → `Busy(runId)`); a lost race with a manual start
  (`SF-GEN-0500` thrown by `start`) is caught outside the transaction and treated as busy. The run id is checkpointed in
  the transaction that creates the run, plus the idempotency key `schedule-{id}-{scheduledFor}`. Target gone at
  execution → `FAILED SF-DOM-0162`, paused; a channel disabled since → `FAILED 0161`, paused.
- The run comment ("Scheduled generation #id: …") is passed to `start` but not persisted (see Out of scope), so tests
  assert the owner, mode, target and link instead.
- Tests (`ScheduledActionsIntegrationTest`): one-off as owner + crash re-run starts no second run; recurring 03:00
  Europe/Berlin over the 2025 spring-forward switch (three runs at 03:00 local); busy with `RUN_LATE`,
  `SKIP_IF_LATER_THAN 15m` and a coalesced hourly slot; deleted target.
