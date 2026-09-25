---
id: M27.4.4
status: todo
depends: [M27.4.2, M27.4.3]
epic: m27-release-and-scheduling
feature: scheduler
area: backend
---

# M27.4.4 — Schedules API: CRUD, cancel, take over, run now, re-pin, history, `scheduled` on assets

## Context

`M27.4.1`–`M27.4.3`, `ReleasePermissions` (`M27.1.3`), `ChangesController` / asset DTOs (`scheduled` placeholder from
`M27.1.3`), `ArchivedProjectEndpointWalkTest`, `AuditService`, `ProblemFactory`. Epic decisions 15, 18–27.

## Goals

- **`ScheduleController`** `/api/v1/projects/{key}/schedules`:
  - `GET ` (`VIEWER`) — paged, filters `type[]`, `status[]`, `owner`, `assetUuid` (actions touching an asset), `from`/
    `to` on `next_run_at`; row: id, type, status, runAt/cron+zoneId, nextRunAt, pinPolicy, missedPolicy, maxLateness,
    thenGenerate, owner, createdBy/At, item count, `drift` summary (for `RELEASE`), last execution.
  - `GET /{id}` — detail incl. items (with uid/displayName/locale and drift per item) and params.
  - `POST ` (`DEVELOPER`; per type `ReleasePermissions.canSchedule` for `RELEASE`/`UNPUBLISH`, `DEVELOPER` for
    generation types) — body `{type, runAt? (ISO instant), cron?, zoneId?, pinPolicy?, missedPolicy, maxLateness?,
    thenGenerate?, params}`; validates via the handler; `runAt` in the past → `422 SF-DOM-0164`; invalid cron/zone →
    `422 SF-DOM-0165`; cron on a one-off type or `runAt` on a recurring one → `422 SF-DOM-0166`.
  - `PUT /{id}` (`If-Match` on `version`) — edit time/cron/policies/params of a `PENDING` action (re-validated);
    editing anything but the owner's own action requires the same permission as creating.
  - `POST /{id}/cancel` → `CANCELLED` (not for `RUNNING`: `409 SF-DOM-0167`).
  - `POST /{id}/take-over` → owner = caller (caller must hold the permission the action needs); a paused/failed action
    becomes `PENDING` again with `next_run_at` recomputed (one-off in the past: runs on the next tick, missed policy
    applies to its original time — document).
  - `POST /{id}/run-now` → due immediately (keeps the schedule for recurring; one-off runs now instead of later).
  - `POST /{id}/repin` (`RELEASE` + `PINNED` only, else `422 SF-DOM-0168`).
  - `GET /{id}/executions` — history, paged.
  - `POST /preview-times` (`VIEWER`, `@AllowedOnArchivedProject`, read-only) — `{cron, zoneId, count ≤ 10}` → the next
    run instants (validates like create; used by the UI's cron preview, `M27.6.5`).
- **Asset DTOs & Changes rows** fill `scheduled: [{actionId, type, runAt/nextRunAt, locale}]` for pending actions
  touching the asset (bulk lookup; one query per list call).
- **Audit** `SCHEDULE_CREATED`, `SCHEDULE_UPDATED`, `SCHEDULE_CANCELLED`, `SCHEDULE_TAKEN_OVER`, `SCHEDULE_RUN_NOW`
  (target `schedule:<id>`, detail with type and time).
- **Archived**: every mutating endpoint `409 SF-DOM-0141` (walk test), reads allowed.
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [ ] MockMvc per endpoint: roles, archived, validation codes `SF-DOM-0164`–`0168`, optimistic lock (`409 SF-API-0409`
      on stale `If-Match`).
- [ ] Created `RELEASE` schedule appears in `scheduled` on the page DTO and on its Changes rows; cancel removes it.
- [ ] Take over re-activates an owner-lost recurring action under the new owner; run-now executes on the next tick.
- [ ] Times round-trip as ISO instants; recurring rows expose `zoneId` and a computed `nextRunAt`.
- [ ] OpenAPI + `schema.d.ts` regenerated; `./gradlew build` green.

## Out of scope

- UI (`M27.6.5`, `M27.6.2`), editor policy (`M28`).

## Notes / hazards

- Keep `ScheduleController` free of per-type logic: validation and permission come from the handler SPI.
- Error code map: `0160` unknown type, `0161` invalid generation params, `0162` target gone, `0163` owner no longer
  permitted, `0164` time in the past, `0165` invalid cron/zone, `0166` timing form doesn't fit the type, `0167` running
  action can't be cancelled, `0168` re-pin not applicable.
