---
id: M13.2.1
status: todo
depends: []
epic: m13-template-store-folders
feature: export-import
area: backend
---

# M13.2.1 — Template folders reachable via selective export

## Context

`resolveIncludedAssetIds` (`ProjectExportImportServiceImpl`) is already
`FolderScope`-agnostic — it branches only on `AssetType.FOLDER` vs.
not, and walks ancestors by `getFolderId()` regardless of scope. `M11.1.3`'s
`fullStores` expansion (`Set<FolderScope>` → each scope's current top-level
folder ids, via `FolderService.tree(projectId, scope, 0, ctx)`) is also
scope-generic. Both should already work for `FolderScope.TEMPLATES` once
`M13.1` lands; this task proves it and extends `fullStores`' accepted set.

## Goals

- `ExportSelection.fullStores` / `FolderScope` already includes `TEMPLATES`
  once `M13.1.2` adds it — no new field needed here, just wiring: confirm
  `fullStores = {TEMPLATES}` expands to both fixed folders (since
  `FolderService.tree(projectId, TEMPLATES, 0, ctx)` always returns exactly
  those two nodes at depth 0, per `M13.1.2`).
- Integration tests:
  - Selecting a single template folder (nested a few levels under "Page
    Templates", containing templates) exports exactly that subtree.
  - Selecting `fullStores = {TEMPLATES}` exports every live template and
    template-folder in the project, nothing from Pages/Media/Navigation.
  - Combining `fullStores = {TEMPLATES}` with an explicit `assetUuids` pick
    from another store still unions correctly (no duplicates), matching
    `M11.1.3`'s existing multi-scope test shape.
  - A page referencing a template that's inside a *non-selected* template
    folder still produces the existing `MISSING_TEMPLATE_REFERENCE`
    conflict on analyze (`M10.2`) — folders must not accidentally
    auto-include a referenced template the way `M11.1.2` deliberately
    avoided.
- Fix only whatever real gap a failing test reveals — per `M11.1.2`'s
  precedent, expect this to mostly already work.
- Update `FolderController.parseScope`'s error message ("scope must be
  PAGES, MEDIA, or NAVIGATION") to include `TEMPLATES`.

## Acceptance criteria

- [ ] All tests above pass.
- [ ] `GET /folders?scope=TEMPLATES` and folder create/rename/move/delete
      all route through the same generic `FolderController` endpoints with
      no template-specific branching needed beyond what `M13.1` already
      added at the service layer.

## Out of scope

- The fixed-folder-identity problem on import (creating a second "Page
  Templates" folder) — `M13.2.2`.

## Notes / hazards

- Don't write a second "walk this store's top-level folders" query — reuse
  `FolderService.tree`, exactly as `M11.1.3`'s existing implementation
  already does for the other three scopes.
