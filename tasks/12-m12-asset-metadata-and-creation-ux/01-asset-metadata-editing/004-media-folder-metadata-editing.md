---
id: M12.1.4
status: todo
depends: []
epic: m12-asset-metadata-and-creation-ux
feature: asset-metadata-editing
area: frontend
---

# M12.1.4 — Media folder UID and metadata editing

## Context

`ui/src/app/features/media/` has `media-detail-drawer.component.ts` for
editing a *file's* UID/metadata (already shipped), but **no equivalent for a
Media folder** — folders in this store are represented only by
`media-folder-node.component` (a tree row) and renamed via a raw
`window.prompt('Folder name', folder.displayName ?? '')` in
`media-library.component.ts` (~line 416). There is no UID-rename UI for a
Media folder anywhere, even though `AssetService.changeUid` already works on
any asset type including folders (`folder-detail.component`, the Pages
store's equivalent, already proves this pattern works for a folder, not just
a leaf asset).

## Goals

- New detail view for a selected Media folder — either a new
  `media-folder-detail.component` (mirroring `folder-detail.component`'s
  shape) opened the same way `media-detail-drawer.component` opens for a
  file, or an extension of the existing folder-node interaction if this
  codebase's actual folder-selection UX makes a separate detail component
  redundant — check how `media-library.component` currently lets a user
  "select" a folder (as opposed to navigating into it) before deciding.
- Include `sf-uid-rename` for the folder's UID, exactly as
  `folder-detail.component` does for Pages-store folders.
- Include `displayName` editing, backed by the same update call
  `folder-detail.component` already uses (a generic folder/asset update, not
  a media-specific one — confirm the exact method).
- Remove the `window.prompt('Folder name', ...)` rename call once the new
  detail view covers the same capability (folder *creation* still uses its
  own prompt today — that's `M12.2`'s job, not this task's; don't
  accidentally fix both prompts here if only one is in scope).

## Acceptance criteria

- [ ] A Media folder's UID can be changed from the UI, with the same
      inline-edit interaction as Pages-store folders/Media files.
- [ ] A Media folder's display name can be edited and saved without the raw
      browser prompt.
- [ ] The Media folder tree (`media-folder-node.component`) reflects a
      rename immediately, the same way `folder-detail.component`'s renames
      already propagate to the Pages folder tree.

## Out of scope

- Media folder *creation* — still a `window.prompt`, fixed by `M12.2`.
- File-level metadata editing (`media-detail-drawer.component`) — already
  shipped, untouched.

## Notes / hazards

- If `media-library.component`'s current folder-rename prompt is reachable
  from a context-menu action rather than a dedicated "select this folder to
  see its details" interaction, decide whether to keep that same
  context-menu entry point (now opening the new detail view instead of a
  prompt) or add folder selection alongside file selection — pick whichever
  requires the smaller, more consistent change to this component's existing
  interaction model, and document the choice.
