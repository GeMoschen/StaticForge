---
id: M27.6.1
status: todo
depends: [M27.1.3]
epic: m27-release-and-scheduling
feature: ui
area: frontend
---

# M27.6.1 — Release status badges, release bar in editors, release/dependency dialog

## Context

`features/pages` (`page-nav-node`, `pages-list`, `page-editor`, `folder-detail`), `features/content`
(`content.component`, `record-grid`, `record-editor`, `record-set-view`), `features/globals` (`global-set-detail`),
`features/media` (`media-library`, `media-detail-drawer`, `media-nav-node`), `features/navigation`
(`nav-folder-detail`, `nav-reference-detail`), `core/project/editing-locale.store.ts` (current editing locale),
`project-access.store.ts` (`readOnly`), `AuthStore.roleFor`, regenerated `schema.d.ts` (`release`, `scheduled` on DTOs,
`/releases`, `/releases/plan`). Epic decisions 6–11, 15.

## Goals

- **`sf-release-badge`** (shared component): shows the status for the current editing locale (`Published`, `Changed`,
  `New`, `Unpublished`, `Deletion pending`) plus a clock icon when `scheduled`; tooltip lists every locale's status
  ("DE published · EN changed"). Colour **and** text/icon (never colour alone — §24.7). Used in every tree node / list
  row / card of the releasable types.
- **Release bar** (shared `sf-release-bar`) at the top of each releasable editor (page, record, record set, global set,
  media drawer, navigation folder/reference, editorial folders): status for the editing locale and a compact locale
  list, and actions:
  - **Release…** — opens the release dialog.
  - **Unpublish…** (when released in any locale) — locale choice, confirmation.
  - **Discard changes…** (when `CHANGED`/`DELETION_PENDING`) — confirmation showing the diff summary; shows the
    `sharedFieldsKept` note from the response.
  - **Schedule…** is added by `M27.6.5` (the bar exposes an action slot for it); not part of this task.
- **Release dialog**: locale checkboxes (current editing locale preselected; "all changed locales" shortcut), calls
  `POST /releases/plan`, shows the selection, the proposed dependencies grouped by reason (referenced, parent folder,
  descendants of a renamed folder) **ticked by default** with untick, completeness findings (blocking, with links to the
  field), optional comment, **Release** button. On success: toast "Released in r1234 — goes online with the next
  build", statuses refresh.
- **Deleting** a published asset: the delete confirmation says "Stays online until you release the deletion"; a `NEW`
  asset keeps today's text.
- Visibility: actions only for `DEVELOPER`+ (decision 15) — one `canRelease()` computed in a small
  `ReleasePermissionsStore` reading the role (so `M28` switches it to server-provided permissions in one place);
  disabled in read-only mode (time travel, archived) with the existing read-only affordance.

## Acceptance criteria

- [ ] Vitest (fixtures from the real `schema.d.ts` shapes): badge per status and locale; release dialog includes
      ticked dependencies in the request, unticked ones not; findings block the Release button; discard shows the
      shared-fields note.
- [ ] Every releasable editor shows the bar; an `EDITOR` sees statuses but no actions; time travel hides actions.
- [ ] Manual check in the running app: edit → `Changed`, release → `Published`, delete published → `Deletion
      pending`, release deletion → gone; per-locale statuses switch with the editing locale.
- [ ] Layout holds at 1280 px (lessons: `min-width: 0` on flex children) — assert in the journey (`M27.7.2`).
- [ ] `npm run build` and `npx vitest run` green.

## Out of scope

- Changes view (`M27.6.2`), preview toggle (`M27.6.3`), schedule dialog (`M27.6.5`).

## Notes / hazards

- Keep one data source for statuses: DTO `release` blocks; after an action, re-fetch the affected assets (or apply the
  response) — don't compute status client-side.
- Lessons: a `<select>`/radio default must be modelled explicitly (preselected locale), buttons gated on dirty + valid.
