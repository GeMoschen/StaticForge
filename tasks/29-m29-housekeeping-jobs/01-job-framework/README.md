# Feature: Job framework — system jobs on the scheduler engine

**Spec:** Extends §21 (services), §26.4 (observability), §26.6 (operations), §20.2 (`/admin/jobs`).

## Goal

A single place for instance-level background work. Each job:

- has a cron schedule, an enabled flag and persisted settings, with defaults from `sf.housekeeping.*`;
- runs at most once at a time on any node, using M27's lease;
- keeps a run history;
- reports metrics;
- can be run manually, and dry-run where destructive, through an instance-admin API.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-system-job-model-and-runner.md](001-system-job-model-and-runner.md) | `M27.4.1` |
| 2 | [002-admin-jobs-api.md](002-admin-jobs-api.md) | 1 |

## Feature exit criteria

- [x] A test job registered as a bean is seeded from properties, runs on its cron, can't run twice concurrently (two
      engines in one test), and records `system_job_run` rows and `sf.job.*` metrics.
- [x] Instance admins list jobs, read history, change schedule/settings (validated) and trigger *Run now* or a dry
      run through `/api/v1/admin/jobs`. Everyone else gets `403`.

## Dependencies

`M27.4.1` (`SchedulerEngine`, lease claim), `M26.3.1` (admin controller pattern, audit search).
