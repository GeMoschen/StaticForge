# Feature: UI — admin Jobs page, compaction setting, compacted notices

**Spec:** Extends §23 (`admin/` feature), §24 screen 11 (Admin), §24.2 (revision spine), §24.5 (project settings).

## Goal

- Instance admins see and steer every housekeeping job in the admin area.
- Project admins opt in to compaction with a clear, typed confirmation.
- Everyone travelling through compacted history is told what they are looking at.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-admin-jobs-page.md](001-admin-jobs-page.md) | `M29.1.2` |
| 2 | [002-compaction-setting-and-notices.md](002-compaction-setting-and-notices.md) | `M29.4.1`, `M29.4.3` |

## Feature exit criteria

- [x] `/admin/jobs` lists jobs, and a detail view shows history, edits the schedule and settings (validated), runs now
      or as a dry run and shows the report. It is keyboard-complete and passes axe.
- [x] Project settings → General (or History) has the compaction card with the estimate and a type-the-key confirmation.
- [x] The revision spine, list, diff and time-travel banner show "compacted" where the API says so.

## Dependencies

`M29.1.2`, `M29.4.1`, `M29.4.3`; the M26 admin shell (`features/admin/admin-shell.component.ts`, `admin.routes.ts`).
