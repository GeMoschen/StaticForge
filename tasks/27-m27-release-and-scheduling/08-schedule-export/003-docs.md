---
id: M27.8.3
status: done
depends: [M27.8.1, M27.8.2]
epic: m27-release-and-scheduling
feature: schedule-export
area: docs
---

# M27.8.3 — Docs: schedules in archives

## Goals

- `cms-specification.md`: §26.5 "Export protocol 9 (M27.8)" bullet, the protocol-8 bullet loses "Schedules are not
  exported"; §18.7 (schedule uuid, export/import, `SCHEDULE_IMPORTED`), generation target uuid, audit row, §20.
- `docs/api.md` (`includeSchedules`, `importSchedules`, `scheduleCount`, result fields, the five conflict types,
  `uuid` on schedules and targets), `docs/user-guide.md` (export/import dialogs, scheduling), `docs/release-readiness.md`.
- Epic README: decision 28 amended, feature row 8, "exporting schedules" removed from "Not in scope".

## Acceptance criteria

- [x] No "Schedules are not exported" left in docs or code comments.
- [x] Every doc above updated against the code.
