---
id: M29.1.2
status: todo
depends: [M29.1.1]
epic: m29-housekeeping-jobs
feature: job-framework
area: backend
---

# M29.1.2 — Admin jobs API

## Context

- `AdminAuditController`, `AdminProjectController`, `AdminUserController` (`sf-api/.../api/`, class-level
  `@PreAuthorize("hasAuthority('SYS_INSTANCE_ADMIN')")`).
- `AuditService.record` (free-string actions).
- `SystemJobService` (`M29.1.1`).
- Epic decisions 3–5, 14.

## Goals

`AdminJobController` under `/api/v1/admin/jobs`:

- `GET /admin/jobs`: every job with:
  - key, name, description, enabled, cron, zone, settings, defaults;
  - `nextRunAt`, `running` (plus `startedAt` when it is), `supportsDryRun`, `orphaned`;
  - last run summary (outcome, trigger, dry run, finishedAt, duration, affected, bytesFreed).
- `GET /admin/jobs/{key}`: the same for one job. An unknown key is `404 SF-DOM-0184`.
- `GET /admin/jobs/{key}/runs?page=&size=`: history, newest first, with the report sample.
- `GET /admin/jobs/{key}/runs/{runId}`: one run with its full report.
- `PATCH /admin/jobs/{key}`:
  - body: `enabled`, `cron`, `zone`, `settings` (merge), with `If-Match` on `version`;
  - invalid cron, zone or settings → `422 SF-DOM-0180` with an `errors` list (one message per problem);
  - recomputes `next_run_at`; audits `JOB_SETTINGS_SET` (before/after in the detail).
- `POST /admin/jobs/{key}/reset`: back to property defaults, audited `JOB_SETTINGS_SET`.
- `POST /admin/jobs/{key}/run?dryRun=true|false`:
  - answers `202` with a `Location` to the run;
  - `dryRun=true` on a job without dry-run support → `422 SF-DOM-0180`;
  - already running → `409 SF-DOM-0181`;
  - audits `JOB_RUN` (`dryRun` in the detail).
- Add the new actions to the audit labels list (`ui/.../admin-audit.util.ts` in `M29.5.1`).
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [ ] API tests: list/detail/history paging; PATCH validation (bad cron, bad zone, bad settings, stale `If-Match` →
      `409 SF-API-0409`); reset; run now plus dry run; `409` while running; `403` for a non-admin; `404` for an unknown
      key.
- [ ] Audit entries `JOB_SETTINGS_SET` and `JOB_RUN` are written with the actor, target `job:<key>` and detail.
- [ ] `./gradlew build` green.

## Out of scope

- UI (`M29.5.1`).
- Per-project job views: compaction is project-scoped only through its policy (`M29.4.1`).

## Notes / hazards

- `settings` is typed per job. Validate through `HousekeepingJob.validateSettings`, and never store unknown keys.
- A run started through the API while the engine's scheduled run of the same job is claiming the lease: exactly one
  wins, and the other gets `409`, or is skipped (scheduled). Cover this with a test.
