---
id: M29.1.1
status: done
depends: [M27.4.1]
epic: m29-housekeeping-jobs
feature: job-framework
area: backend
---

# M29.1.1 — System job model, SPI and runner

## Context

- `SchedulerEngine`, its lease claim and `SchedulerProperties` (`M27.4.1`, `sf.scheduler.*`).
- Existing `@ConfigurationProperties` style: `GenerationProperties`, `MediaProperties`, `SearchProperties`, with Javadoc
  on each field and `Duration`/`DataSize` types.
- Changelogs `server/sf-app/src/main/resources/db/changelog/v1.0/` (next: `024-system-jobs.xml`).
- Micrometer (`MeterRegistry`).
- Epic decisions 1–7.

## Goals

- **Tables** (`024-system-jobs.xml`, H2 + PostgreSQL):
  - `system_job`: `key` PK, `enabled`, `cron`, `zone_id`, `settings` JSON, `next_run_at`, `lease_owner`,
    `lease_until`, `last_run_id`, `updated_at`, `updated_by`, `version`.
  - `system_job_run`: epic decision 2, with an index on `(job_key, started_at desc)`.
- **SPI** `HousekeepingJob` (sf-domain, package `com.acme.staticforge.housekeeping`):
  - `key()`, `displayName()`, `description()`;
  - `defaults()` (cron, enabled, settings), `validateSettings(JsonNode)` (a list of messages);
  - `supportsDryRun()`, `runOnStartup()`;
  - `run(JobContext)`. `JobContext` carries: dry run flag, settings, a clock, a cancellation check, counters
    (`examined`, `affected`, `bytesFreed`), a bounded report sample (≤ 50 items) and a progress message.
- **`HousekeepingProperties`** (`sf.housekeeping.*`):
  - `zone` (default `UTC`), `history-per-job` (200);
  - one nested block per job, with `cron`, `enabled` and job-specific keys that later tasks add (the defaults table is
    epic decision 7).
- **Seeding.**
  - On startup, a missing `system_job` row is inserted from `defaults()` and properties.
  - Existing rows are left unchanged: they are the admin's settings.
  - An unknown row (a job bean that was removed) is kept but reported as `orphaned` in the API. It never runs.
- **Runner** `SystemJobRunner`:
  - It registers with the engine's tick, or reuses its lease helper: if `M27.4.1` ties the lease to
    `scheduled_action`, extract a shared `LeaseClaimer` without changing M27 behaviour.
  - It claims each due, enabled job (`next_run_at <= now`) with the lease and runs it on a virtual thread.
  - It writes a `system_job_run` row (`trigger=SCHEDULE`), then computes `next_run_at` from cron and zone. A missed
    slot runs once, never once per missed slot.
  - Jobs with `runOnStartup()` run once after `ApplicationReadyEvent` (`trigger=STARTUP`).
  - The lease is renewed while a job runs (half the lease time). On shutdown, cancellation is signalled and the lease
    released.
  - A failing job records `FAILED` with the message and a stack-trace digest, and never kills the tick.
- **Manual runs.** `SystemJobService.runNow(key, dryRun, actor)` claims the same lease and runs asynchronously. A job
  that is already running answers `409 SF-DOM-0181`.
- **History cap.** After each run, a job's history beyond `history-per-job` is deleted.
- **Metrics.** Epic decision 6. The gauge reads the newest `SUCCEEDED` run per job.
- **Test job.** A `NoopJob` in test sources only.

## Acceptance criteria

- [x] Seeding: properties → row on the first start. An edited row survives a restart with different properties.
- [x] Two runner instances (two engines against one DB in a test) never run the same job concurrently. A crashed
      holder's lease expires and the job runs again.
- [x] Cron with a zone: `0 3 * * *` in `Europe/Berlin` runs once across both DST changes (the clock is injected).
      Missed slots run once.
- [x] `FAILED` outcome recorded, and the next scheduled run still happens. The history cap is enforced.
- [x] `sf.job.duration`, `sf.job.items`, `sf.job.bytes.freed` and `sf.job.last.success.age` are visible on
      `/actuator/prometheus`.
- [x] `./gradlew build` green.

## Out of scope

- The admin API (`M29.1.2`) and the jobs themselves (features 2–4).

## Notes / hazards

- No `@EnableScheduling` for this: the engine's tick is the single scheduler. Don't add a second polling mechanism.
- Lessons: every overload on a Spring service interface is abstract (no `default` delegating into `@Transactional`).
- Keep `run` outside one long transaction. Jobs open their own short transactions per batch.

### Deviations

- **Changelog `026-system-jobs.xml`**, not `024`: `024` and `025` were taken by M27.8/M28. It is picked up by the master
  changelog's `includeAll`; later M29 tasks append their changesets to the same file. `key` is quoted in H2 (reserved
  word), like `output_channel` (010).
- **`LeaseClaimer` generalized, not extracted**: M27.4.1 had already made it table-independent; it now takes a key
  column (default `id`, `system_job` uses `"key"`), binds any key type and gained `release(key, owner)`. M27 behaviour
  is unchanged (scheduler tests green).
- **Tick hook**: `SchedulerTickParticipant` beans join `SchedulerEngine.poll()` (actions first, then each participant,
  failures isolated). `SystemJobRunner.tick()` stays callable directly for tests.
- **Node id and lease**: the runner reuses `sf.scheduler.node-id` (`SchedulerProperties.effectiveNodeId()`) and
  `sf.scheduler.lease`; no `sf.node-id` yet (M29.2.1 may introduce it).
- **Per-job property blocks** are one `@ConfigurationProperties` class per job extending `JobProperties`
  (`sf.housekeeping.<key>.*`) next to the job, rather than nested classes in `HousekeepingProperties`, so parallel job
  tasks don't edit one shared class. `HousekeepingProperties` holds `enabled`, `zone`, `history-per-job`.
- **`sf.housekeeping.enabled`** (added; default `true`, off in the `test` profile) gates scheduled ticks and startup
  runs on a node; seeding and the API work regardless.
- **SPI additions**: `run` returns a `JobResult` (outcome + optional message) and may throw; `JobContext` also offers
  `report()` (structured report data), `inTransaction(...)` (short `REQUIRES_NEW` batches) and typed `settings()`
  (`JobSettings`); `SettingsSpec` declares and validates settings (unknown keys refused).
- **Effective settings**: a run (and the API) uses each key of the job's defaults with the stored value where present,
  so a key added by a newer job version works before the admin saves it.
- **Manual and startup runs keep the schedule** (`next_run_at` unchanged); only scheduled runs move to the next slot.
- **Metrics**: dry runs record only `sf.job.duration`; `sf.job.last.success.age` counts successful non-dry runs and is
  `NaN` before the first one.
