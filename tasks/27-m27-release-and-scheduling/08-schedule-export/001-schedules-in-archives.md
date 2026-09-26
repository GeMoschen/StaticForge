---
id: M27.8.1
status: done
depends: [M27.4.4, M27.5.1]
epic: m27-release-and-scheduling
feature: schedule-export
area: backend
---

# M27.8.1 — Protocol 9: schedules in archives

## Context

`sf-domain/.../exportimport/ProjectExportImportService(Impl).java` (`PROTOCOL_VERSION = 8`), `ExportedRelease`,
`writeReleasedVersion`, settings import (targets matched by name); `sf-domain/.../scheduler/ScheduleService.java`
(`create` → `apply` → `writeAssets`), `ScheduledAction`, `ActionAuthority.denial`, handlers (stored params);
`ReleaseServiceImpl.plan`; changelog `022-scheduler.xml`. Feature decisions 1–9.

## Goals

- Changelog `024`: `uuid` on `scheduled_action` and `generation_target` (backfilled, not null, unique per project);
  exposed on `ScheduleView` and the generation target view.
- Export (protocol 9): `schedules/<uuid>.json` per open schedule, no database ids (pins as `ExportedRelease`, targets
  by uuid + name, users by username); `includeSchedules` on the selection; target uuid in `settings.json`.
- Import: `importSchedules` option, schedules imported last in the import revision through a new
  `ScheduleService.importAction` that validates like create and reports refusals as values.
- Analysis: `scheduleCount` and the warnings `DUPLICATE_SCHEDULE`, `SCHEDULE_OVERDUE`, `SCHEDULE_TARGET_MISSING`,
  `SCHEDULE_INVALID`, `SCHEDULE_OWNER_REPLACED`; the import result carries counts and commit-time warnings.
- `ReleaseServiceImpl.plan` must not doom the caller's transaction when it refuses (`noRollbackFor`).
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [x] `ScheduleExportImportIntegrationTest`: pinned `DRAFT_EQUALS` and `PAYLOAD` round trips (executing releases the
      pinned content), latest, unpublish + then-generate (target by uuid, null stays null), recurring pending/paused,
      overdue, target missing / name-clash fallback, owner kept/replaced + audit, re-import overwrite, busy and finished
      left alone, export coverage/flag/statuses, invalid schedules skipped while the rest commits, `importSchedules =
      false`, protocol-8 fixture, `DRAFT` mode with a deletion item.
- [x] Existing export/import, analysis, selection and schedules API tests updated and green.
- [x] `./gradlew build` green.

## Out of scope

- UI (`M27.8.2`), docs (`M27.8.3`). Execution history.

## Notes / hazards

- A `@Transactional` method that throws inside the import transaction marks it rollback-only even when caught.
- The PostgreSQL backfill changeset isn't covered by a test (H2 only); review it.

## Implementation notes

- **Where.** `exportimport/ScheduleArchive` (package-private component) holds everything schedule-shaped: which
  schedules an export carries and their `ExportedSchedule` form, the analysis warnings, and the import through
  `ScheduleService.importAction`. `ProjectExportImportServiceImpl` only wires it in: `schedules/<uuid>.json` entries,
  the `includeSchedules` flag (a full export carries every open schedule, a selection only covered releases/unpublishes),
  a `Writes` callback that pins against the import's own maps, and the shared map of versions written for released
  and pinned payloads (per asset and content, so a pin equal to a released version shares it).
- **Validation without rollback.** `importAction` validates on a detached copy (`apply` as for a create, as the owner)
  and returns `Created | Replaced | Kept | Refused`; it never throws. `ReleaseServiceImpl.plan` got
  `noRollbackFor = SfException.class`: a refused plan inside the import transaction had marked it rollback-only
  (`UnexpectedRollbackException` at commit). Proven: the two tests with refused schedules fail without it.
- **Checks before writes.** Unknown type, overdue, target and an executing/finished schedule with the same uuid are
  decided before any pinned version is written; the analysis adds reference checks (assets, locale keys, channels,
  cron). Commit-time outcomes are returned as `scheduleWarnings`.
- **Targets.** `TargetImportPlan` gained `SKIP_SAME_TARGET` (same uuid: nothing to report); a created target keeps the
  archive's uuid. `ScheduleArchive.Targets` resolves a schedule's target by uuid, else — for an archived target skipped
  for a name clash — the project's single target of that name.
- **Owner.** By username; kept when `ActionAuthority.denial` is empty, else the importer. The creator is the matching
  user whatever their status (history), else none; `createdAt` is kept.
- **Tests:** `ScheduleExportImportIntegrationTest` (7: pinned round trip incl. a `PAYLOAD` pin that releases its
  content, drift and audit; latest/unpublish/one-off/recurring/paused with the owner kept; re-import replacing open
  schedules and leaving executing and cancelled ones; overdue, deleted target, name-clash target, deletion imported as
  draft (`SF-DOM-0151`) with the rest committing; a locale the target lacks; selection coverage, statuses and a
  schedules-only selection; `importSchedules=false` and a protocol-8-shaped archive), `ProjectImportAnalyzeApiTest`
  (+1 over HTTP), `ProjectExportSelectionApiTest` (+1), `ScheduleApiTest` (`uuid`), protocol version 9 in
  `ProjectExportImportIntegrationTest`; `ReleaseStateExportImportIntegrationTest` now asserts protocol ≥ 8.
- **Deviation:** the protocol-8 case is an archive rewritten in the test (schedules dropped, target uuids removed,
  manifest 8) rather than a frozen fixture directory: a protocol-8 archive differs from protocol 9 only in those parts.
