# Feature: Time-travel read-only everywhere

**Spec:** §24.2 (revision spine/time travel), §19.3 (in-app preview affordances —
read-only viewing is the same family of concept), §7.5 (optimistic concurrency — the
backstop this feature adds sits alongside it).

## Goal

Viewing a past revision ("time travel," entered by clicking a spine tick — see
`project-shell.component.ts`'s `onTick`/`timeTravel.enter(revision)`) must put the
**entire app** into a read-only state for as long as it's active, not just the one
surface that happens to check for it today. As implemented (`M6`), only
`page-editor.component.ts` reads `TimeTravelStore.isTimeTravel` (aliased `readOnly`) and
gates its own edits on it (drag/drop, field edits, section add/remove — grep confirms
~10 `if (this.readOnly())` guards). `project-shell.component.html` shows the amber
"Viewing revision N / Back to now" banner globally, which visually implies the whole
app is frozen — but nothing enforces that: `templates.component.ts` (template
create/save/delete, channel-template save/delete), `media-detail-drawer.component.ts`
(replace/delete media), `nav-folder-detail.component.ts`/`nav-reference-detail.component.ts`
(navigation create/move/delete), `project-settings-shell.component.ts`'s settings
panels, and channel CRUD are all fully writable while the banner is showing a past
revision. A user can time-travel to an old revision, edit a template or delete a media
asset, and silently create a *new* current-state change while still "looking at the
past" — exactly the kind of confusing, data-corrupting interaction the amber banner
exists to prevent.

This feature closes that gap with two layers: a project-wide backstop that makes it
*impossible* for a mutating request to succeed while time travel is active regardless
of which component issued it, and per-editor UI treatment so the experience is a clear,
disabled state rather than a click that silently fails.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-readonly-http-backstop.md](001-readonly-http-backstop.md) | — |
| 2 | [002-editor-surfaces-read-only.md](002-editor-surfaces-read-only.md) | 1 |

## Feature exit criteria

- [ ] Every mutating HTTP call (`POST`/`PUT`/`PATCH`/`DELETE`) to the project API is
      rejected client-side, without ever reaching the network, while
      `TimeTravelStore.isTimeTravel()` is true — proven by a shared interceptor test,
      not by auditing every call site individually (an audit is still done for the UI
      layer in task 2, but the backstop must hold even for a component task 2 misses).
  - Read-only project-scoped GETs (revision diff, asset detail at a revision, preview)
    remain unaffected — time travel is a viewing mode, not a project-wide network lock.
- [ ] Every editor surface reachable while time-travel is active — templates
      (section/page template editors, channel-template editor), media (upload/replace/
      delete/rename), navigation (folder/reference create/move/delete), project settings
      (all panels), channels — visibly disables its own write affordances (buttons,
      form controls, drag/drop) the same way `page-editor.component.ts` already does,
      rather than relying solely on the HTTP backstop's rejection.
- [ ] Exiting time travel ("Back to now") immediately restores full write access on
      every surface, with no leftover disabled state and no stale in-flight requests
      queued from while it was active.
- [ ] `npm run build` and `npm test` green.

## Dependencies

`M6:revision-spine` (`TimeTravelStore`, `project-shell`'s amber banner and `onTick`/
`backToNow` flow — the entry/exit points this feature builds on), `M6:conflict`
(the existing `PageAutosaveService`/409 pattern the backstop must not be confused
with — time-travel rejection is a client-side, pre-flight block, not a server 409).
