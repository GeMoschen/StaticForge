# Feature: Schedules in archives (protocol 9)

**Spec:** Extends §26.5 (export/import, protocol history) and §18.7 (scheduler). Overturns the last sentence of epic
decision 28 ("Schedules are not exported", user request 2026-09-26).

## Goal

Archives carry a project's open schedules (pending and paused recurring), with pins that survive the move, stable
identities for schedules and generation targets, and owners matched by username. The import dialog can leave the
schedules out.

## Decisions (with the user, 2026-09-26)

1. **Open schedules only.** `PENDING` (a `RUNNING` one is exported as `PENDING`) and paused recurring (`FAILED` with a
   cron). No executions, no finished or cancelled one-offs.
2. **Export flag.** `includeSchedules` on the selection export (checkbox in the export dialog); the full export always
   includes them. A selection export carries a release/unpublish schedule only when every item's asset is in the
   archive; generation schedules whenever the flag is on.
3. **Pins.** A pin on the current draft is exported as `DRAFT_EQUALS` (pins the imported draft); any other pinned
   version is exported with its payload and imported as a non-current version (like a released payload, shared with
   an identical one). An item on an asset the import reused from the target pins the target's current draft.
4. **Schedule uuid.** New column, unique per project. Re-import with the same uuid replaces an *open* schedule in place
   (id and history kept, `DUPLICATE_SCHEDULE`); a finished/cancelled one, and one that is executing, are left alone
   (warning). Another type is `SCHEDULE_INVALID`.
5. **Import option** `importSchedules` (default true), a "Schedules" radio in the dialog when the archive has any.
   Imported schedules keep their status; the lease is cleared and the next run recomputed.
6. **Overdue** one-offs (`runAt` before the import) are not imported (`SCHEDULE_OVERDUE`).
7. **Generation targets get a uuid** (unique per project), carried in `settings.json`. Settings import: same uuid in
   the target → keep the existing target; else a name clash → skipped as before; else created with the archive's uuid.
   Schedules refer to targets by uuid; a target skipped for a name clash resolves to the same-named target; otherwise
   `SCHEDULE_TARGET_MISSING` (not imported).
8. **Validation like create.** A schedule that fails it is not imported (`SCHEDULE_INVALID` with the `SF-DOM` code);
   the rest of the import commits. A locale that doesn't fit the target makes the schedule invalid.
9. **Owners by username.** Kept when the user exists and may own it (`ActionAuthority`); otherwise the importer owns
   it (`SCHEDULE_OWNER_REPLACED`). The creator is the matching user or none; `createdAt` is kept.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-schedules-in-archives.md](001-schedules-in-archives.md) | `M27.4.4`, `M27.5.1` |
| 2 | [002-schedule-import-export-ui.md](002-schedule-import-export-ui.md) | 1 |
| 3 | [003-docs.md](003-docs.md) | 1, 2 |

## Feature exit criteria

- [x] Protocol 9 round-trips open schedules (pinned draft and older pins, latest, unpublish with then-generate,
      one-off and recurring generation, paused), with the decided overdue, target, owner, duplicate and invalid cases.
- [x] An invalid schedule never fails the rest of the import.
- [x] Protocol 8 and 7 archives import unchanged.
- [x] Export checkbox and import option in API and UI.
- [x] `./gradlew build`, `npm run build`, `npx vitest run` green.

## Dependencies

`M27.4` (scheduler, schedules API), `M27.5` (protocol 8, released payload versions).
