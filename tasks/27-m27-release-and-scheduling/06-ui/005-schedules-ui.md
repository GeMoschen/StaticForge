---
id: M27.6.5
status: todo
depends: [M27.4.4, M27.6.1]
epic: m27-release-and-scheduling
feature: ui
area: frontend
---

# M27.6.5 — Schedules: page, schedule dialog, cron builder, time zones

## Context

New lazy feature `features/schedules/` (route `p/:projectKey/schedules`, nav-rail entry), API
`/api/v1/projects/{key}/schedules` (`M27.4.4`), `M27.6.1` (release bar "Schedule…" entry), `M27.6.2` (Changes view
"Schedule release…"), generation dialog (`features/generation/generation-dialog.component.ts` — reuse its mode/target/
channels form for generation schedules). Epic decisions 16, 18–27.

## Goals

- **Schedule dialog** (shared, opened from the release bar, the Changes view and the Schedules page):
  - Type: Release / Unpublish (items given by the caller, editable list with locale per item) / Generation /
    Recurring generation.
  - When: date + time in the **viewer's time zone** (label shows the zone, e.g. "Europe/Berlin (CEST)"); for recurring:
    presets (hourly, daily at …, weekdays at …, weekly on … at …) that write a cron expression, plus an "Advanced"
    cron text field with validation and a preview of the next 5 run times in the viewer's zone. The creator's zone is
    sent as `zoneId`.
  - Release options: **Pin** "Release the versions as they are now" (default) / "Release whatever is saved at that
    time"; **Then generate** (off by default; target + channels).
  - Missed runs: "Run as soon as possible" (default) / "Skip if more than [N] [minutes|hours] late".
  - Dependencies for release: same plan call and ticked-by-default list as the release dialog.
- **Schedules page**: table (type, what — items or build summary, next run in viewer zone with the schedule's zone when
  different, owner, status, drift warning "Draft changed since scheduled" with **Re-pin**), filters (type, status,
  owner), row actions Edit, Cancel, Run now, Take over (when owner lost permission / action failed or paused), and an
  execution history drawer (time, late by, outcome, per-item results, link to the revision and to the generation run).
- **Release bar entry**: this task adds **Schedule…** to `sf-release-bar` (`M27.6.1`), opening the dialog with the
  asset and the editing locale preselected.
- **Asset editors**: the release bar shows pending schedules for the asset ("Release scheduled for Tue 09:00 by Ana")
  linking to the schedule.
- Roles/read-only as in `M27.6.1` (generation schedules `DEVELOPER`); archived → read-only.

## Acceptance criteria

- [ ] Vitest: a local time in `Europe/Berlin` is sent as the correct UTC instant (test around a DST switch); presets
      produce the expected cron; invalid cron shows the server's `SF-DOM-0165` message; drift badge + re-pin.
- [ ] Manual check: schedule a release 2 minutes ahead with then-generate; it executes, the page shows `Published`, the
      run appears in generation history, the execution history links both.
- [ ] `npm run build` and `npx vitest run` green.

## Out of scope

- Calendar view; notifications.

## Notes / hazards

- Use the platform `Intl` API for zones (`Intl.DateTimeFormat().resolvedOptions().timeZone`); no new date library
  unless one is already a dependency — check `package.json` first.
- Next-run previews come from the server (`POST /schedules/preview-times`, `M27.4.4`), so cron semantics (DST, 5- vs
  6-field) exist once, in Java. Debounce the call while typing.
