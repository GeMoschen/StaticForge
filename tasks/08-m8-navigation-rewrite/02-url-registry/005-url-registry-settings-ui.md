---
id: M8.2.5
status: todo
depends: [M8.2.4]
epic: m8-navigation-rewrite
feature: url-registry
area: frontend
---

# M8.2.5 — Project settings: Navigation URLs panel

## Context

Add a new tab to the project settings shell (`ui/src/app/features/settings/`), next to
`general`/`media`/`channels`/`generation`/`revisions`, following the
`project-settings-general`/`project-settings-media` component pattern.

## Goals

- New tab entry `url-registry` (label "Navigation URLs") in
  `project-settings-shell.component.html`, routed via a lazy child route in
  `app.routes.ts`.
- `project-settings-url-registry.component.ts/.html/.scss`: standalone, `OnPush`,
  injects a new `url-registry.service.ts` (same typed-`HttpClient`-over-generated-schema
  pattern as `channels.service.ts`).
- Table view: filterable by channel and area (`PREVIEW`/`GENERATED` tabs or a toggle),
  columns = `PageReference` label, URL, overridden flag, assigned-at; inline edit for
  manual override (calls the `PATCH` endpoint).
- Reset controls: per-row reset, per-channel reset, per-area reset, and a
  project-wide "Reset all" — each behind a confirmation dialog (reuse the shared
  `shared/` confirm-dialog component) since reset is destructive per `M8.2.4`'s Notes.

## Acceptance criteria

- [ ] Tab appears in project settings and loads the registry list against the real
      backend.
- [ ] Filtering by channel/area works.
- [ ] Manual override edits persist and reflect immediately in the table.
- [ ] Every reset action requires confirmation and, after confirming, the affected rows
      disappear from the table (since `reset` deletes them; they reappear only once
      something re-triggers a `resolve`, e.g. a generation run or a nav preview).
- [ ] Vitest tests for the table's filter/override/reset interactions.

## Out of scope

- Nothing further planned in this epic — this is the last task.

## Notes / hazards

- After a reset, the UI should clearly communicate "entries will repopulate on next
  generation/preview" rather than implying they're gone forever, to avoid alarming
  users who don't understand the lazy-repopulate contract from `M8.2.2`.
