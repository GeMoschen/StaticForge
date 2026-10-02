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

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

**Signed off with M35.12 (gate decision 35):** drawers, the media detail included, start **below the top bar**; `sf-drawer`
is already offset by `--sf-topbar-height`. Do not re-open that question here.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.

## Notes (M35.9)

- Decide first (open from the gate): whether `sf-drawer` starts below the dark top bar. The media detail showed it
  covering the bar.
- The signed-off sample (decisions 19-22) is the reference. The detail is a resizable, non-modal `sf-drawer` on the
  right, with ←/→ to step to the previous/next file. It **widens the tab list in Goals** (Details, Focal
  point, Versions, Used by) with all tabs, shown only when they apply to the file: Details (large preview, alt text,
  caption, file info, styled Replace, focal point set by clicking the preview, numbers in developer mode), Variants,
  Languages (a file per language), Processing (the "Process CMS syntax" switch of text media with its diagnostics),
  Rendered (served output of text media), Source (text media in the code panel), Used by, Versions. Check backend
  support for Variants, Languages, Processing and Rendered before building each tab.
- Grid card: thumbnail with the name (truncated at the end) and "JPG · 1.2 MB" below, checkbox top-left on
  hover/focus/selected, status icon when unreleased. A drop zone covers the whole area; the upload progress panel is
  per file. Bulk move, delete (undo) and download.

## Notes (M35.15 favorites)

- The media tree and the grid and list: add the pinned *Favorites* node (`pinned: true`, only while there are favorites; children from
  `FavoritesService`, flat with an icon per kind, favorite folders as lazily loaded folder nodes, a click on the node opens
  the Favorites list in the main pane) and *Add to / Remove from favorites* to the row context menu (and a hover/focus ☆
  in table name cells). The design is in the sample (`/styleguide/sample`, gate round 5, decisions 57–58). Favorites are
  not store-bound: the node lists them from every store.
- Put the open item in the URL (`?asset=` / `?folder=`, or the route's UUID) so it is recorded as a recent.

