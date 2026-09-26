---
id: M27.8.2
status: done
depends: [M27.8.1]
epic: m27-release-and-scheduling
feature: schedule-export
area: frontend
---

# M27.8.2 — Export checkbox and import option for schedules

## Context

`ui/src/app/features/settings/project-settings-export.component.*`, `project-settings-import.component.*`,
`import-export.service.ts`, regenerated `schema.d.ts` (`M27.8.1`). Feature decisions 2 and 5.

## Goals

- Export dialog: a "Schedules" checkbox next to channels and targets, with the hint that release/unpublish schedules
  are included only when all their assets are selected. It enables Export on its own.
- Import dialog: a "Schedules" fieldset, shown only when the analysis reports `scheduleCount > 0`: "Import the
  archive's N schedule(s)" (default) / "Don't import schedules". Changing it re-analyzes; a new file and cancel reset
  it. The choice is sent as `importSchedules`.
- The five schedule warnings are listed with the other warnings (own icons); the result shows the schedules imported
  and the commit-time warnings.

## Acceptance criteria

- [x] Vitest: service sends `importSchedules`; import radios hidden without schedules, default import, switching
      re-analyzes and commits `false`, reset on new file; warnings and result; export request carries
      `includeSchedules` and the checkbox alone enables Export (fixtures in the real response shapes).
- [x] Manual check in the running app.
- [x] `npm run build` and `npx vitest run` green.

## Implementation notes

- The release-state fieldset's styles became a generic `.import-option` block shared by "Release state" and
  "Schedules". The schedules choice lives in `importSchedules`/`archiveScheduleCount` signals, re-analyzes like the
  release mode and resets on a new archive and on cancel.
- The result shows "Imported N schedule(s), replaced M." and a "Schedules" list of the commit-time warnings; the toast
  adds the schedule count. Icons: `event_repeat`, `event_busy`, `link_off`, `person`.
- Export: "Include schedules" with a hint, part of `exportDisabled`.
- **Tests:** `project-settings-import.component.spec.ts` (+3; existing call assertions now carry `importSchedules`),
  `import-export.service.spec.ts` (+1), `project-settings-export.component.spec.ts` (+1).
