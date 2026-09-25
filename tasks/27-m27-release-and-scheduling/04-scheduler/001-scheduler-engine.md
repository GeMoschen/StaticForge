---
id: M27.4.1
status: done
depends: [M27.1.2]
epic: m27-release-and-scheduling
feature: scheduler
area: backend
---

# M27.4.1 — Scheduler engine: tables, lease claim, SPI, missed policy, cron and time zones

## Context

No scheduling infrastructure exists (no `@EnableScheduling`/`@Scheduled`/`TaskScheduler`/ShedLock/`SKIP LOCKED`;
only `SearchIndexServiceImpl`'s private `ScheduledExecutorService`, `:93-98`). Virtual threads on
(`application.yml:17-19`). Property style: `GenerationProperties` (`@ConfigurationProperties`, `Duration`/`DataSize`,
Javadoc per field). Archived guard: `ProjectWriteGuard` / `ProjectService.requireWritable`. Account status and
membership: `AppUser.status`, `ProjectMemberRepository` (permissions must be evaluated from the database, not from a
JWT). `AuditService.record(projectId, actorUserId, action, target, detail)`. Epic decisions 20, 23–26.

## Goals

- **Schema** `v1.0/022-scheduler.xml`:
  - `scheduled_action` (`id`, `project_id`, `type` varchar(40), `params` json, `run_at` timestamp null (one-off),
    `cron` varchar(120) null, `zone_id` varchar(64) null, `pin_policy` null, `missed_policy` (`RUN_LATE` |
    `SKIP_IF_LATER_THAN`), `max_lateness` interval-as-seconds null, `then_generate` json null, `status` (`PENDING` |
    `RUNNING` | `SUCCEEDED` | `FAILED` | `SKIPPED` | `CANCELLED`), `next_run_at` (UTC, indexed with status),
    `lease_owner`, `lease_until`, `created_by`, `owner_user_id`, `created_at`, `updated_at`, `version` for optimistic
    locking). Recurring actions stay `PENDING` between slots; one-offs end in a terminal status.
  - `scheduled_action_execution` (`id`, `action_id`, `scheduled_for`, `started_at`, `finished_at`, `outcome`
    (`SUCCEEDED` | `PARTIAL` | `FAILED` | `SKIPPED`), `late_by_ms`, `message`, `detail` json, `revision_id` null,
    `generation_run_id` null, `executed_as_user_id`).
- **`SchedulerEngine`** (`sf-domain` or a new `scheduler` package; single bean, started on `ApplicationReadyEvent`,
  stopped on shutdown): every `sf.scheduler.poll-interval` (default 15 s) it selects due candidates (`status = PENDING
  AND next_run_at <= now`, limit `sf.scheduler.batch-size`) and **claims** each with a conditional update
  (`… SET lease_owner = :node, lease_until = now + sf.scheduler.lease WHERE id = :id AND version = :v AND (lease_until IS
  NULL OR lease_until < now)`); only a claimer with 1 updated row executes. Execution on a virtual thread; the lease is
  extended while it runs; a crashed node's lease expires and another node re-claims (the handler must be idempotent
  per `scheduled_for`, see hazards). `sf.scheduler.enabled` (default `true`; `false` in the `test` profile unless a test
  enables it). Node id from `sf.scheduler.node-id` (default hostname + pid).
- **SPI** `ScheduledActionHandler`: `String type()`, `void validate(params, actor)`, `ActionRequirements
  requirements(params)` (minimum role + named permissions; M27 uses the role only, M28 adds permissions — one object
  evaluated by the API and by the execution re-check), `ExecutionResult execute(ExecutionContext)`. Handlers are beans; unknown types in the
  table fail with `SF-DOM-0160`, logged once per action.
- **Timing.** `nextRunAt` computed by `ScheduleTiming`: one-off = `run_at`; recurring = Spring `CronExpression` (6-field
  seconds form accepted; 5-field input normalized) evaluated in `zone_id`, DST-correct (a skipped local time runs at
  the next valid instant, a repeated local time runs once). After a recurring execution, `next_run_at` = next slot
  **after now** (missed slots collapse into one execution, decision 23).
- **Missed policy.** At claim time `late_by = now - scheduled_for`; `SKIP_IF_LATER_THAN` with `late_by > max_lateness`
  → execution `SKIPPED` with message; `RUN_LATE` executes and records `late_by`.
- **Authority.** Before `execute`, the engine re-checks the owner: account neither `DISABLED` nor `DELETED` (a temporary
  `LOCKED` sign-in lockout doesn't block), still a member with the required role (or instance admin), and the handler's permission requirement
  (M27: `DEVELOPER`; M28 adds policy). Failure → execution `FAILED` with `SF-DOM-0163` "Owner no longer permitted" and
  the reason; the action becomes `FAILED` (one-off) or stays `PENDING` (recurring, next slot) — decide consistently:
  a recurring action is **paused** (`status = FAILED`, `next_run_at = null`) until taken over, so it doesn't fail every
  slot.
- **Archived projects.** Candidates of archived projects are not claimed (decision 26); after unarchive they are due
  and the missed policy applies.
- **Audit.** `SCHEDULE_EXECUTED` / `SCHEDULE_FAILED` / `SCHEDULE_SKIPPED` entries with `actorUserId` = owner and detail
  `{actionId, type, lateByMs, outcome}` (creation/edit audit in `M27.4.4`).
- **Metrics.** `sf.scheduler.executions{type,outcome}`, `sf.scheduler.lag` (timer of `late_by`), `sf.scheduler.claims`.
- **`SchedulerProperties`** (`sf.scheduler.enabled`, `poll-interval`, `batch-size`, `lease`, `node-id`) with Javadoc;
  documented in `application.yml` and `infra/README.md` in the docs task.

## Acceptance criteria

- [x] Two engine instances (two node ids) against one database and 50 due actions: each executes exactly once
      (integration test with a counting handler).
- [x] A lease left by a "crashed" node (lease expired, status RUNNING) is re-claimed and executed once.
- [x] Missed policy: `RUN_LATE` executes with `late_by` recorded; `SKIP_IF_LATER_THAN 10m` at 30 min late → `SKIPPED`;
      a recurring hourly schedule down for 5 h executes once, then continues at the next slot.
- [x] Cron in `Europe/Berlin` `0 30 2 * * *` on the spring-forward day runs once at 03:00 local; on the fall-back day
      runs once (clock injected; `Clock` bean used everywhere, no `Instant.now()` in the engine).
- [x] Owner disabled / removed / demoted → `FAILED SF-DOM-0163`; recurring action paused.
- [x] Archived project → not executed; after unarchive executed (or skipped) per missed policy.
- [x] `./gradlew build` green.

## Out of scope

- Concrete action types (`M27.4.2`, `M27.4.3`), REST (`M27.4.4`), instance jobs (`M29`, which reuses the claim/lease
  helper — keep it a separate reusable component, e.g. `LeaseClaimer`).

## Notes / hazards

- Idempotency: a handler may be re-executed after a lease expiry mid-run. Release handlers are naturally idempotent
  (already-released items are no-ops); generation handlers must check "a run was already started for this
  `scheduled_for`" via `scheduled_action_execution.generation_run_id` before starting another.
- Don't use `@Scheduled`/`@EnableScheduling` globally (it would change other beans' behaviour); a dedicated
  `ThreadPoolTaskScheduler` bean (1 thread for the tick) is fine.
- Tests: inject `Clock`; never sleep — drive `engine.tick()` directly.

## Implementation notes

- **Package** `sf-domain/scheduler`: entities `ScheduledAction` (JPA `@Version`), `ScheduledActionExecution`,
  `ScheduledActionAsset` (see M27.4.4), repositories, `SchedulerProperties`, `LeaseClaimer`, `ScheduleTiming`,
  `SchedulerProblems` (`SF-DOM-0160`–`0168`), the SPI and `ActionAuthority`. Changelog `v1.0/022-scheduler.xml` (JSON
  columns per dialect like `016`); `max_lateness` is stored as `max_lateness_seconds`.
- **`LeaseClaimer`** is table-agnostic (`id`, `version`, `lease_owner`, `lease_until`; extra `SET` assignments on a
  won claim) so M29's instance jobs reuse it. The claim `UPDATE … WHERE id AND version AND (lease_until IS NULL OR
  lease_until < now)` also sets `status = 'RUNNING'`.
- **`SchedulerEngine`** is a plain class (bean from `SchedulerConfiguration`), so tests run several engines with their
  own node id and `MutableClock` against the one test database; `tick()` returns `Tick(claimed, done)`. Candidates:
  `PENDING`/`RUNNING`, due, lease free or expired, project not archived (JPQL join). Poller: one platform daemon
  thread started on `ApplicationReadyEvent` when `sf.scheduler.enabled` (off in the `test` profile); executions on
  virtual threads; a lease keeper extends the lease every `lease/3`; `close()` stops everything with the context.
- **Execution model** (the engine is type-agnostic): the engine opens an execution (`scheduled_for` = `next_run_at`)
  or resumes the open one; applies unknown type → `FAILED 0160` (logged once, paused), missed policy (only when the
  execution starts), owner re-check (`0163`, paused), then calls the handler. A handler returns `FINISHED` or
  `WAITING`; waiting keeps the execution open and the action `PENDING` with `next_run_at` unchanged — due again, so
  every tick retries it and later recurring slots coalesce. Handlers checkpoint progress
  (`ExecutionContext.checkpoint`) in the transaction of the step itself, so a re-claim after a lease expiry never
  repeats a committed step. A node that lost its lease drops its result (`finish` checks `lease_owner`).
- **Paused** = recurring action `FAILED` with `next_run_at = null` (owner not permitted, unknown type, target gone).
- **Owner check** (`ActionAuthority`, also used by the API for the caller): account exists and isn't `DISABLED`/
  `DELETED` (`LOCKED` passes), instance admin or member with the handler's minimum role; a non-empty permission set
  is refused in M27 (M28 evaluates it). `RoleReleasePermissionCheck` now lets a `LOCKED` instance admin release too,
  matching this rule.
- **DST** (`ScheduleTiming`): cron evaluated on `LocalDateTime` in the zone; a local time in a gap maps to the gap's
  end (02:30 → 03:00 on the spring-forward day), a repeated one to its first occurrence, and the next slot is searched
  strictly after the last instant — each local slot runs once.
- Tests: `ScheduleTimingTest` (sf-domain, 4), `SchedulerEngineIntegrationTest` (8: two nodes × 50 actions, crashed
  lease, missed policies, 5 h outage, Berlin DST both ways, owner disabled/removed/demoted/locked, unknown type,
  archived → unarchived).
