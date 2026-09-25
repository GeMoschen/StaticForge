# Feature: Scheduler — engine, release/unpublish and generation actions, schedules API

**Spec:** Extends §18.1 ("Scheduled | full, cron per project | system"), §20.2 (REST), §26.2 (scalability: multi-node
safe claiming), §26.4 (metrics).

## Goal

An extensible, multi-node-safe scheduler that executes project actions at a time or on a cron: scheduled release and
unpublish (with optional "then generate"), one-off generation and recurring generation — with pin, missed-run,
time-zone, authority and archived-project rules. `M29` reuses the engine's claim mechanism for instance jobs.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-scheduler-engine.md](001-scheduler-engine.md) | `M27.1.2` |
| 2 | [002-release-and-unpublish-actions.md](002-release-and-unpublish-actions.md) | 1 |
| 3 | [003-generation-actions.md](003-generation-actions.md) | 1 |
| 4 | [004-schedules-api.md](004-schedules-api.md) | 2, 3 |

Tasks 2 and 3 can run in parallel.

## Feature exit criteria

- [x] Due actions are claimed exactly once, even with two engine instances against one database (test).
- [x] All four action types execute with the decided pin, missed, busy, authority and archived behaviour.
- [x] Recurring schedules evaluate cron in the stored zone across DST changes.
- [x] Schedules API (CRUD, cancel, take over, run now, re-pin, history) served; `schema.d.ts` regenerated.
- [x] `./gradlew build` green.

## Dependencies

`M27.1.2` (`ReleaseService`), `M4`/`M22` (`GenerationService.start`, `GenerationRequest`, `findActive`), `M26`
(archived guard, account statuses, token-independent permission checks), `M7.3` (`AuditService`).
