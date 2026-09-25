---
id: M29.5.1
status: todo
depends: [M29.1.2]
epic: m29-housekeeping-jobs
feature: ui
area: frontend
---

# M29.5.1 — Admin Jobs page

## Context

- `ui/src/app/features/admin/`: `admin.routes.ts`, `admin-shell.component.ts`, `admin-audit.component.*` (filters in
  the URL), `admin-audit.util.ts` (action labels), `admin-users.component.*` (server paging).
- Generated API types (`core/api/generated/schema.d.ts`).
- Lessons: fixtures from the real API shape; Save gated on dirty + valid; no implicit select defaults.
- Epic decisions 3–7.

## Goals

- **Route** `/admin/jobs`, with a tab in the admin shell next to Users, Projects and Audit.
- **List.** One row per job:
  - name and description;
  - enabled switch;
  - schedule (cron shown as text, e.g. "Daily at 03:30 (UTC)", with the raw cron in a tooltip);
  - next run (in the viewer's time zone, plus the job's zone where different);
  - last run (outcome chip, when, duration, affected, bytes freed);
  - a running indicator.
  - Orphaned jobs are shown greyed with a note.
- **Detail** `/admin/jobs/:key`:
  - **Schedule and settings form.** Enabled, cron with a live "next 3 runs" preview computed client-side (or a
    `?preview` query if the backend offers it; don't invent a second cron parser if one isn't available, and show the
    server's `nextRunAt` after save instead). Zone select. Job-specific settings rendered from the job's settings
    (typed numeric/duration fields with the server's validation messages under the field).
  - Save is gated on dirty + valid. `If-Match` conflict → conflict notice and reload. *Reset to defaults* with a
    confirmation.
  - **Run now** and **Dry run** (only where supported). Both show progress (poll the run until finished) and then the
    report: counts, bytes, sample table.
  - **History table.** Server-paged; each row expands to its report; trigger, dry run and `started_by` columns.
- **Audit labels.** `JOB_SETTINGS_SET`, `JOB_RUN`, `COMPACTION_POLICY_SET`, `REVISIONS_COMPACTED` in
  `admin-audit.util.ts`.

## Acceptance criteria

- [ ] Vitest specs (fixtures from the generated types):
  - [ ] list rendering incl. orphaned and running;
  - [ ] form dirty/valid gating;
  - [ ] server validation errors mapped to fields;
  - [ ] run-now polling to the finished report;
  - [ ] dry-run button hidden for jobs without support.
- [ ] Manual check in the running app: edit the blob-sweep grace, dry run, run now, history entry appears; a
      non-admin can't reach `/admin/jobs` (guard).
- [ ] Keyboard-complete, axe clean on list and detail.
- [ ] `ui` `npm run build` and `npx vitest run` green.

## Out of scope

- Project-level views of instance jobs.

## Notes / hazards

- Times: always label the zone. The viewer's zone and the job's zone differ by default (UTC), and a silent mismatch
  would mislead.
