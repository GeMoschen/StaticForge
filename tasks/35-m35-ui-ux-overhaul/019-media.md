---
id: M35.19
status: todo
depends: [M35.11, M35.12, M35.13, M35.14, M35.15]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.19 — Media library and detail

## Context

`features/media/*` (library, folder and nav nodes, detail drawer, after M35.2). Screenshots 20–23 and E2. Folder cards
are clickable `<div>`s, checkboxes have no labels, delete is the only bulk action, there is no sort or list view, and
there is no upload progress.

## Goals

- **Tree:** folders only (the pane is titled "Folders", so files don't belong in it), via `sf-tree`, with a filter.
- **Main area:**
  - Toolbar: search, type filter, **sort** (name, date, size, type), **grid/list toggle** (stored in preferences),
    Upload (primary).
  - Grid cards: focusable, labelled checkboxes, name that truncates only at the end.
  - List view: `sf-data-table` with thumbnail, name, type, dimensions, size, modified, usages.
  - Selection bulk actions: move, delete (undo), download.
- **Upload:**
  - A drop zone visible on drag over the whole area.
  - A per-file progress list in a dockable panel: progress bar, cancel, retry, errors.
  - Alt text can be entered after upload.
- **Detail:**
  - A drawer (or split, resizable).
  - Tabs via `sf-tabs`: Details, Focal point, Versions, Used by.
  - A proper preview (fixes the collapsed thumbnail from M35.1).
  - Focal point set by clicking on the image; numeric fields only in developer mode.
  - Styled file replace.
  - Save enabled only when dirty.
  - Delete moved to ⋮ with confirm and undo.
- Selection in the URL (`?asset=` kept, not stripped).

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.
