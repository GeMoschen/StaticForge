---
id: M12.1.3
status: todo
depends: []
epic: m12-asset-metadata-and-creation-ux
feature: asset-metadata-editing
area: frontend
---

# M12.1.3 — Navigation folder and reference UID/metadata editing

## Context

`ui/src/app/features/navigation/nav-folder-detail.component.ts` and
`nav-reference-detail.component.ts` are the Navigation store's equivalents of
`folder-detail.component`/`media-detail-drawer.component` (Pages/Media), but
neither currently includes `sf-uid-rename` or any metadata-editing form —
both are read/structural-action-only today (matching what `navigation.component`'s
`window.prompt`-based creation flow, fixed separately in `M12.2`, currently
also lacks).

## Goals

- Add `sf-uid-rename` to both `nav-folder-detail.component` and
  `nav-reference-detail.component`.
- Add `displayName` editing to `nav-folder-detail.component` (a Navigation
  folder's own display name — check `FolderService`'s existing update method,
  it's the same one `folder-detail.component` already uses for the Pages
  store's folders, just scoped to `NAVIGATION` here).
- Add editable-field support to `nav-reference-detail.component` for whatever
  a `PAGE_REFERENCE`'s own update command actually supports today — check
  `CreatePageReferenceRequest`'s update counterpart (likely a label override
  and/or the target itself) before assuming which fields are editable; do
  not invent new backend-supported fields as part of this task.

## Acceptance criteria

- [ ] A Navigation folder's UID and display name can both be changed from
      `nav-folder-detail.component`.
- [ ] A Navigation reference's UID and its existing editable fields (per the
      investigation above) can be changed from `nav-reference-detail.component`.
- [ ] Both changes are reflected immediately in `nav-tree-node.component`'s
      rendering of the tree (the node's label/uid updates without requiring a
      full tree reload) — check how `folder-detail.component`'s equivalent
      update already propagates to its own tree view and mirror that
      propagation mechanism here.

## Out of scope

- Any change to reference *resolution* behavior (`NavigationService`) —
  untouched, this is identity/display metadata only.
- Creating new folders/references — `M12.2`.

## Notes / hazards

- Confirm whether `PAGE_REFERENCE`'s target can safely be changed after
  creation via the existing update path, or whether the backend only
  supports setting it at creation time — if the latter, do not add a
  target-editing control that would call an endpoint that doesn't support
  it; scope the editable fields to what's actually there.
