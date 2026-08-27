---
id: M13.3.1
status: todo
depends: []
epic: m13-template-store-folders
feature: template-store-ui
area: frontend
---

# M13.3.1 — Templates screen folder tree

## Context

`templates.component.ts` today holds a flat `templates` signal populated by
`TemplatesService.list(kind, key)` (a plain paged list, no folder
structure) and a `kind` signal toggling between `'section'`/`'page'`. The
Pages screen (`pages-list.component.ts` + `folder-node.component.ts`)
already renders a real, recursive folder tree against `FolderScope.PAGES`
via `ApiClient.listFolders(projectKey, 'PAGES', depth)` and per-node
`createFolder`/rename/move/delete — that's the pattern to replicate against
the new `FolderScope.TEMPLATES` (`M13.1.2`), with the wrinkle that the two
depth-0 nodes are fixed and non-editable.

## Goals

- Add `ApiClient.listFolders`'s `'TEMPLATES'` variant (extend the scope
  union type already covering `'PAGES' | 'MEDIA'` — confirm
  `'NAVIGATION'`'s equivalent typing pattern, since `navigation.service.ts`
  calls the same endpoint with a literal string rather than through
  `listFolders`'s typed overload; follow whichever is more consistent with
  the codebase as it stands by the time this task starts).
- New `template-folder-node.component` (or extend `TemplatesComponent`
  directly if a recursive node component turns out to be overkill for a
  tree that's always exactly 2 branches deep at the top — make the call
  based on how deep real usage nests, matching the complexity Pages/Media
  actually needed rather than assuming) rendering the tree returned by
  `GET /folders?scope=TEMPLATES`.
- The two depth-0 nodes ("Page Templates"/"Section Templates",
  `protected: true` per `M13.1.1`'s `FolderNode`/`FolderView` field) render
  with no rename/move/delete affordances (no context menu entries, no drag
  handle as a drag *source* — they can still be a drop *target* for
  children) — everything nested beneath them gets the full Pages-style
  folder toolset (create subfolder, rename, move, delete-if-empty/cascade).
- Selecting a folder filters the template list/detail pane to that folder's
  direct contents (matching how selecting a Pages folder scopes
  `pages-list.component`'s list) — decide whether kind-toggle (`section`/
  `page`) stays as a separate control or is now implied by which fixed
  branch is selected; implied is likely cleaner but confirm the CDL/OCTL
  editing pane's `kind`-dependent behavior (`isSection()`,
  `outputPathOf`/`bodies` handling) doesn't assume the toggle exists
  independently of folder selection before removing it.

## Acceptance criteria

- [ ] The Templates screen shows both fixed roots always, with their real
      current children (folders + templates) beneath.
- [ ] Neither fixed root can be renamed, moved, or deleted from the UI; both
      accept new subfolders and new templates.
- [ ] A folder nested arbitrarily deep under either fixed root renders
      correctly and supports create/rename/move/delete like a Pages folder.
- [ ] Moving a folder from under "Page Templates" to under "Section
      Templates" (or vice versa) is prevented in the UI (disabled drop
      target / clear error), matching the backend's `templateKind`
      mismatch rejection (`M13.1.2`/`M13.1.3`).

## Out of scope

- Template creation/move dialogs and drag-and-drop wiring specifically —
  `M13.3.2`.
- The export/import panel — `M13.3.3`.

## Notes / hazards

- Don't build a new shared folder-tree component that Pages/Media then get
  retrofitted onto — that's a larger refactor than this milestone asks for
  (see the feature README's Dependencies note). Follow the existing
  per-store pattern.
