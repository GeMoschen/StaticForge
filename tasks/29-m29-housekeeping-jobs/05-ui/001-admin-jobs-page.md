---
id: M29.5.1
status: done
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

- [x] Vitest specs (fixtures from the generated types):
  - [x] list rendering incl. orphaned and running;
  - [x] form dirty/valid gating;
  - [x] server validation errors mapped to fields;
  - [x] run-now polling to the finished report;
  - [x] dry-run button hidden for jobs without support.
- [ ] Manual check in the running app: edit the blob-sweep grace, dry run, run now, history entry appears; a
      non-admin can't reach `/admin/jobs` (guard). *Not done yet: the backend in the tree was being changed by
      another task at the time; left to the milestone's manual check. The guard is covered by specs
      (`instanceAdminGuard` in `auth.store.spec.ts`, `admin.routes.spec.ts` asserts the admin chunk is behind it).*
- [ ] Keyboard-complete, axe clean on list and detail. *Keyboard-complete by construction (native links, buttons,
      inputs, selects and switches, every control labelled, field errors tied with `aria-describedby`); axe is not
      installed here (offline), so "axe clean" is unproven.*
- [x] `ui` `npm run build` and `npx vitest run` green (100 files, 679 tests).

## Out of scope

- Project-level views of instance jobs.

## Notes / hazards

- Times: always label the zone. The viewer's zone and the job's zone differ by default (UTC), and a silent mismatch
  would mislead.

### Deviations

- **No client-side "next 3 runs".** The only preview endpoint (`POST /projects/{key}/schedules/preview-times`) is
  project-scoped, and the task forbids a second cron parser. The form describes the cron in words as you type (with its
  zone) and shows the server's `nextRunAt`, recomputed on save (and in the "Saved" toast).
- **Cron wording** reuses the schedules' `describeCron` ("Every day at 03:30 (UTC)", "Every Sunday at 03:00") and adds
  `*/N` minutes/hours ("Every 5 minutes"); anything else shows as "Cron <expr>". The raw cron is the tooltip (and
  screen-reader text) in the list.
- **Audit labels:** `admin-audit.util.ts` had no label table. Added `AUDIT_ACTION_LABELS` / `auditActionLabel` with
  the four M29 actions; the audit view shows the label next to the code (filter options and table). Other actions
  stay code-only.
- **List:** the enabled switch saves at once (`PATCH {enabled}` with the row's version; a conflict reverts the switch
  and reloads). While any job runs the list re-reads itself every 5 s (`JOB_LIST_REFRESH_MS`).
- **Detail:** Save sends only the changed members and settings (the server merges). Client-side checks (whole
  numbers, durations as ISO-8601 or `30m`/`24h`/`365d`, a 5/6-field cron, a zone) are hints; server `422` messages
  are mapped to fields by `Setting '<key>'`, "cron" and "time zone", the rest is listed above the form. A `409
  SF-API-0409` shows a conflict notice and reloads the job into the form. *Reset to defaults* confirms with
  `window.confirm` (the admin area's pattern); *Run now* has no confirmation (epic decision 4: no gate).
- **Polling:** after *Run now* / *Dry run* (or on opening a job that is running) the page polls the run and the job
  (for its `progress` line) every second (`JOB_RUN_POLL_MS`), one request pair at a time, until `finishedAt` is set;
  it stops when the page is left. The finished report (counts, bytes, sample table, extra report keys) replaces the
  spinner, and the history reloads.
- **History:** page state is not kept in the URL; the pager only appears with more than one page. Each row expands to
  the report from the list response (sample and counts).
- Spec fixtures live in `features/admin/testing/admin-jobs.fixture.ts`, typed from `schema.d.ts`.
- Noticed, not changed: the schedules' `parsePresetCron` reads day-of-week `8` as Monday (`% 7`), so an invalid
  `0 3 * * 8` is described as "Every Monday at 03:00" until the server rejects it.
