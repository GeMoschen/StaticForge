---
id: M29.1.1
status: todo
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

- [ ] Seeding: properties → row on the first start. An edited row survives a restart with different properties.
- [ ] Two runner instances (two engines against one DB in a test) never run the same job concurrently. A crashed
      holder's lease expires and the job runs again.
- [ ] Cron with a zone: `0 3 * * *` in `Europe/Berlin` runs once across both DST changes (the clock is injected).
      Missed slots run once.
- [ ] `FAILED` outcome recorded, and the next scheduled run still happens. The history cap is enforced.
- [ ] `sf.job.duration`, `sf.job.items`, `sf.job.bytes.freed` and `sf.job.last.success.age` are visible on
      `/actuator/prometheus`.
- [ ] `./gradlew build` green.

## Out of scope

- The admin API (`M29.1.2`) and the jobs themselves (features 2–4).

## Notes / hazards

- No `@EnableScheduling` for this: the engine's tick is the single scheduler. Don't add a second polling mechanism.
- Lessons: every overload on a Spring service interface is abstract (no `default` delegating into `@Transactional`).
- Keep `run` outside one long transaction. Jobs open their own short transactions per batch.
