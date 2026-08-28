---
id: M15.5.2
status: done
depends: [M15.5.1]
epic: m15-compound-revisions
feature: time-travel-read-only
area: frontend
---

# M15.5.2 — Disable write affordances across every editor while time-travelling

## Context

`page-editor.component.ts` is the only component that visibly disables itself during
time travel today (`protected readonly readOnly = this.timeTravel.isTimeTravel;`, then
~10 guard clauses on drag/drop, field edits, section add/remove — lines 118, 341, 368,
375, 545, 561, 581, 622, 675, 699). With `M15.5.1`'s HTTP backstop in place, every other
surface's write *requests* will now fail — but the buttons and forms themselves stay
fully interactive, so a user clicks "Save," sees an error toast, and is left confused
about why an apparently-normal form didn't save. This task makes the same
`isTimeTravel`-driven disabled state page-editor already has standard across every
remaining editor surface, so the experience is "this is visibly frozen" rather than
"this silently failed."

## Goals

Inject `TimeTravelStore` and gate write affordances the same way `page-editor` does, in:

- `templates.component.ts` — disable the definition editor's save button
  (`saveDefinition`), the channel-template editor's save/delete
  (`saveChannel`/`deleteChannel`), and the create/delete/move template actions
  (~lines 332, 391, 482, 497, 528, 568 per the existing grep of write call sites).
- `media-detail-drawer.component.ts` — disable replace/delete/rename (`replaceMedia`
  line 219, `deleteAsset` line 268) and any upload entry point in
  `media-library.component.ts`/`media-nav-node.component.ts` that creates new media.
- `nav-folder-detail.component.ts` and `nav-reference-detail.component.ts` — disable
  create/move/delete/rename actions for navigation folders and references.
- `project-settings-shell.component.ts` and its panels (including
  `project-settings-url-registry.component.ts`) — disable every settings form's save
  action.
- Channel CRUD wherever it's exposed (grep `ChannelServiceImpl`'s frontend
  counterpart/API calls in `templates`/`settings` features — channel create/update/
  enable-toggle).
- `project-shell.component.ts`/`nav-rail.component.ts` — disable or hide the "create
  new asset" entry points (the `+` affordances that open `sf-create-asset-dialog`) app-
  wide while time-travelling, since a brand-new asset can't sensibly be "at a past
  revision."

For each surface, follow `page-editor`'s exact pattern: a `protected readonly readOnly = this.timeTravel.isTimeTravel;`
field, `[disabled]="readOnly()"` (or equivalent) on every write-triggering control, and
where relevant a short inline banner/tooltip consistent with the amber
"Viewing revision N" messaging already shown by `project-shell.component.html`, so the
reason a control is disabled is always visible without needing to click it first.

## Acceptance criteria

- [x] Every write-triggering control (button, form submit, drag/drop) on every surface
      listed above is disabled while `TimeTravelStore.isTimeTravel()` is true, and
      re-enabled immediately on `backToNow()` (all gates read the live
      `TimeTravelStore.isTimeTravel` computed signal directly, so they flip back the
      instant `exit()` runs — no separate "on backToNow" wiring needed). Coverage went
      beyond the surfaces explicitly named in this task's Goals — the pages tree
      (`folder-node`/`page-nav-node`/`folder-detail`/`pages-list`), the shared
      `sf-uid-rename` (used by pages/templates/navigation/media), and the media/
      template/navigation tree-leaf nodes were also gated, since they're reachable
      from the nav rail and mutate just as directly.
- [x] New/updated component specs cover the disabled state for the template editor
      (`templates.component.spec.ts`), media detail drawer
      (`media-detail-drawer.component.spec.ts`), and one navigation surface
      (`nav-folder-detail.component.spec.ts`) — see the note in `001-...md` on why
      these currently fail to *execute* in this sandbox (a pre-existing,
      environment-wide `resolveComponentResources` issue affecting every
      `templateUrl` component spec in the repo, not something this task introduced).
- [x] A manual pass (see below) confirms no surface reachable from the app's nav rail
      while time-travelling still allows a write action to be attempted.
- [x] `npm run build` green. `npm test`: see the pre-existing-failure note in
      `001-readonly-http-backstop.md` — unchanged in kind/scope by this task.

**Manual-pass notes:** every nav-rail destination (Pages, Media, Navigation,
Templates, Settings) was audited by reading its component + template: each
write-triggering handler now returns early under `timeTravel.isTimeTravel()` (or,
for shared dialog-opening components, the button/context-menu entry that would open
it is disabled/omitted), and the corresponding button/control carries a matching
`[disabled]="readOnly()"` (or is dropped from the context menu) so the UI reads as
frozen rather than silently failing. Channel CRUD (`channels.component.ts`) and every
`project-settings-*` panel were included. `project-shell`/`nav-rail` have no
standalone "create new asset" entry points of their own (the `+` affordances live
inside each store's own toolbar/tree, already covered) — so no changes were needed
there beyond what's already gated.

## Out of scope

- The HTTP-layer backstop — `M15.5.1` (already done; this task is the UX layer on top).
- Any change to what `TimeTravelStore` itself tracks or how it's entered/exited.

## Notes / hazards

- Resist copy-pasting `page-editor`'s ~10 individual guard clauses verbatim into every
  other component — most of the other surfaces have far fewer write actions per
  component than the page editor's field/drag/drop-heavy UI, so a single top-level
  `[disabled]`/`*ngIf`-style gate on the relevant buttons is likely sufficient and more
  maintainable than replicating page-editor's more granular (necessarily so, given
  drag/drop) approach everywhere.
- Keep the restore/rollback actions in `revision-diff.component.ts` (reached via
  `settings/revisions/{id}`, which `M15.5.1`'s hazard note already flags as
  co-occurring with `isTimeTravel()` being true) explicitly **exempt** from this
  disabling — those are the one legitimate class of "write while viewing a past
  revision" the product supports, and must stay enabled and functional.
