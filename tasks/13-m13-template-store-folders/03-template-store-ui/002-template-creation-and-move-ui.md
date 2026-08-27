---
id: M13.3.2
status: todo
depends: [M13.3.1]
epic: m13-template-store-folders
feature: template-store-ui
area: frontend
---

# M13.3.2 — Template creation targets a folder; templates are movable

## Context

`TemplatesComponent.newTemplate()` today always creates at the top with no
parent context (`this.service.create(this.kind(), key, { displayName: ...
})` — no `parentFolderUuid`). With `M13.1.3` accepting `parentFolderUuid`
on create and `M13.3.1` giving the screen a real tree with a selected
folder, creation needs to target wherever the user currently has selected
(or the matching fixed root if nothing more specific is selected), and an
existing template needs a way to move between folders — mirroring how
Pages/Media let you drag an item onto a folder node, or move it via a
context-menu action.

## Goals

- `newTemplate()` passes the currently-selected folder's uuid (defaulting
  to the matching fixed root when a template, not a folder, is selected —
  or when nothing is) as `parentFolderUuid` to `TemplatesService.create`.
- `TemplatesService`/`ApiClient` gain whatever's needed to move a template:
  confirm `AssetController`'s generic `POST /assets/{uuid}/move` is already
  exposed on `ApiClient` (check for an existing generic `move` method used
  by Pages/Media's non-folder assets, e.g. moving a `Page` between
  folders) — reuse it rather than adding a template-specific move call.
- A template list item supports being moved to a different folder (drag
  onto a folder node, matching Pages/Media's existing interaction, or a
  context-menu "Move to..." action if drag-and-drop isn't already a Pages/
  Media pattern to copy — check before assuming which).
- Attempting to move a template across the `PAGE_TEMPLATE`/`SECTION_TEMPLATE`
  boundary is prevented in the UI and, if it somehow reaches the API,
  surfaces the backend's 422 as a toast (matching the existing
  `templates.component.ts` error-toast style throughout).

## Acceptance criteria

- [ ] Creating a template while a folder (or a template inside one) is
      selected places the new template in that folder.
- [ ] Creating a template with nothing selected places it at the matching
      fixed root for the current kind.
- [ ] An existing template can be moved to a different folder of the same
      kind from the UI; the tree/list reflect the move without a full page
      reload.
- [ ] A cross-kind move attempt is blocked in the UI with a clear message.

## Out of scope

- The shared "Create asset" dialog (`M12.2`) — if it exists by the time
  this task starts, wire template creation through it (folder-aware target
  is exactly the kind of context that dialog is meant to carry); if not,
  extend `templates.component`'s existing creation flow in place.

## Notes / hazards

- `refreshTemplateStore()` (already called after create/rename/delete
  today, to keep `ProjectContextStore.pageTemplates`/`sectionTemplates` in
  sync for the page editor's template pickers) must also run after a move —
  a stale folder-path cache there wouldn't break correctness (those pickers
  don't show folder position) but keep it consistent with the existing
  refresh-on-every-mutation discipline in this component.
