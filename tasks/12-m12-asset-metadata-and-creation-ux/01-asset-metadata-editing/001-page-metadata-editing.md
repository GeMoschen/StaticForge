---
id: M12.1.1
status: todo
depends: []
epic: m12-asset-metadata-and-creation-ux
feature: asset-metadata-editing
area: frontend
---

# M12.1.1 — Page UID and metadata editing

## Context

`ui/src/app/features/pages/page-editor.component.ts` has no UID-rename or
metadata-editing UI at all today — a page's UID is set once at creation time
(via whatever the "Create asset" dialog will set it to, per `M12.2`) and can
never be changed from the UI, even though `AssetService.changeUid` already
works on any asset type. `media-detail-drawer.component.ts` is the reference
implementation for what this should look like: the shared `sf-uid-rename`
component for the UID, plus a small reactive form for the rest.

## Goals

- Add a metadata section to `page-editor.component` (either inline in its
  existing layout, or a collapsible/drawer section if the editor is already
  visually dense — check the current layout before deciding, don't assume a
  full drawer overlay is the right fit for an already-busy editor screen).
- Reuse `sf-uid-rename` exactly as `media-detail-drawer.component`/
  `folder-detail.component` do (`projectKey`/`uuid`/`uid` inputs,
  `uidChanged` output updating local state).
- Add `displayName` editing, backed by whatever `PageService`/`ApiClient`
  method already updates a page's display name (check `AssetController`'s
  generic `PATCH .../assets/{uuid}` or a page-specific update endpoint —
  confirm which one this codebase's existing page-update flow actually calls
  today, e.g. from `submitNewPage`'s sibling "edit" path if one exists,
  before adding a new call).

## Acceptance criteria

- [ ] A page's UID can be changed from `page-editor.component`, with the same
      inline-edit interaction (`sf-uid-rename`'s own UX) as Media/Folders.
- [ ] A page's display name can be edited and saved, with loading/error
      states matching `media-detail-drawer.component`'s save flow.
- [ ] Changing the UID updates the page editor's own displayed identity
      (title/breadcrumb/URL if the route is UID-keyed — check whether page
      routes use `uuid` or `uid` before assuming nothing else needs updating).

## Out of scope

- Any change to the page's content/body editing UI — untouched.
- Deleting a page from this screen — if no delete-from-editor flow exists
  today, don't add one as a side effect of this task.

## Notes / hazards

- If `page-editor.component`'s route or internal state uses the page's `uid`
  (not `uuid`) anywhere for navigation or lookups, changing the UID
  mid-session could break that — check for this specifically (the same
  concern `sf-uid-rename`'s existing warning-on-affected-templates flow
  already handles for OCTL literal references) and confirm the editor
  re-syncs correctly after a UID change rather than silently pointing at a
  stale identifier.
