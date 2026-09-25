---
id: M28.3.2
status: todo
depends: [M28.3.1]
epic: m28-editor-publishing
feature: ui
area: frontend
---

# M28.3.2 — Settings: "Publishing by editors" card

## Context

`features/settings/project-settings-generation-view.component.*` (Generation tab: targets + `<sf-generation>`),
`project-settings-shell.component.html` (tabs), `GET/PUT /projects/{key}/publish-policy`,
`POST …/publish-policy/impact` (`M28.1.1`), `ProjectPermissionsStore` (`M28.3.1`). Epic decisions 1–3, 10.

## Goals

- A card **Publishing by editors** at the top of the Generation tab with four switches and one-line explanations:
  - "Release, discard and unpublish content" (`RELEASE`)
  - "Schedule releases and unpublishing" (`SCHEDULE_RELEASE`, disabled with hint "Needs 'Release…'" while `RELEASE`
    is off; switching `RELEASE` off also switches it off)
  - "Start incremental builds to the default target" (`INCREMENTAL_BUILD`)
  - "Start full builds and builds to any target" (`FULL_BUILD`, same dependency on `INCREMENTAL_BUILD`)
  - A static line: "Developers and project admins can always do all of this. Promote/rollback, targets and
    generation schedules stay with developers."
- Editable for `canAdminProject`; read-only (switches disabled, no Save) for everyone else, with "Only project admins
  can change this."
- **Save** gated on dirty and valid (lessons). Before saving, call `impact`; if schedules would fail, a confirmation
  dialog lists them (type, time in the viewer's zone, owner, missing permission) with "Save anyway" / "Cancel".
- After save: refresh `ProjectContextStore` (own permissions may change for an editor-admin edge case) and show the
  saved state from the server response. Server `errors` (implication rules) are shown under the card.
- Read-only in time travel and in archived projects (store `readOnly`).

## Acceptance criteria

- [ ] Vitest: dependency rules (disable + cascade off), dirty/valid gating, impact dialog shown only with failing
      schedules, read-only for non-admins, error rendering from a `400` payload in the API's shape.
- [ ] Manual check in the running app as project admin and as editor.
- [ ] `npm run build` and `npx vitest run` green.

## Out of scope

- Gating the rest of the generation screen (`M28.3.3`).

## Notes / hazards

- Don't hold the switch states in signals written only by `(change)` handlers — derive the initial state from the
  server response (lessons: a control rendering an implicit default).
