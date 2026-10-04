---
id: M35.22
status: review
depends: [M35.11, M35.12, M35.13, M35.14, M35.15, M35.17]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.22 — Navigation and globals

## Context

`features/navigation/*` (folder detail, reference detail, new reference), `features/globals/*` (tree, global set
detail: Values | Schema). Screenshots 40–43 and 60–61. Neither screen has an `h1`, there is no tree filter, and
`global-set-detail.close()` has no dirty check.

## Goals

- **Navigation:**
  - `sf-tree` in navigation order.
  - Items show the **target page's name and public URL** ("Company → /about-us/"), not the internal folder path.
  - The reference detail shows the target via a page picker card, not a UUID.
  - The resolved URL is labelled correctly.
  - **Sibling reordering** (user, M35.9 decision 23 — widens decision 17): drag before/after and `Alt+↑/↓` among
    siblings via `sf-tree`'s `reorderable`. Needs a stored sibling order in the backend (navigation order today is
    not user-editable) — plan the API/model change in this task.
  - Plain wording ("Select a menu item", not "Select a node"; "Entry page", not "STARTNODE").
- **Globals:**
  - `sf-tree` with a filter.
  - The detail has an `sf-page-header` with save status.
  - Values use the M35.17 form.
  - The Schema tab and the `$CMS_VALUE(CMS_GLOBAL…)` usage chip appear in developer mode only (as `sf-copyable`).
  - Fix the layout padding.
  - Close and switch go through the unsaved guard.
- Both use selection in the URL, `ConfirmService` and undo.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.
- **Navigation area (decision 24):** the tree in navigation order with labels "Company → /about-us/"; a selected menu
  folder shows an `sf-data-table` of its items (label, target page, public URL, visible in menu); a menu item's detail
  shows the target page as a picker card, and "Change target" opens the restyled page picker dialog.
- **Globals area (decision 25):** a tree of global sets with a filter; "Site settings" (site name, contact e-mail,
  opening hours as a list, social links as a catalog of cards, footer text localized with language chips) and "Shop
  settings" (currency select, shipping threshold); `sf-page-header` with save status; the Schema tab (CDL in the code
  panel) and the usage chip as `sf-copyable` in developer mode only. Forms span the full width (decision 33).

## Notes (M35.15 favorites)

- The navigation and globals trees: add the pinned *Favorites* node (`pinned: true`, only while there are favorites; children from
  `FavoritesService`, flat with an icon per kind, favorite folders as lazily loaded folder nodes, a click on the node opens
  the Favorites list in the main pane) and *Add to / Remove from favorites* to the row context menu (and a hover/focus ☆
  in table name cells). The design is in the sample (`/styleguide/sample`, gate round 5, decisions 57–58). Favorites are
  not store-bound: the node lists them from every store.
- Put the open item in the URL (`?asset=` / `?folder=`, or the route's UUID) so it is recorded as a recent.


## Notes (M35.22 — built 2026-10-04)

Built: Navigation (`sf-splitter` + `sf-tree` in menu order, folder view table, menu item detail with picker card,
Favorites node, URL selection `?asset=`, leave guard) and Globals (tree with filter, `sf-page-header` + save status,
M35.17 form, developer-only Schema tab and usage chips, leave guard). Vitest 336 files / 3,680 tests, `ng build` and
lint green; backend sibling-order tests green.

**Backend (sibling order):** a navigation folder's payload holds `childOrder` (child uuids); the tree returns children
named there first, then the rest alphabetically. `PUT /api/v1/projects/{key}/navigation/folders/{uuid}/order`
(`{childUuids}`, editor role, `If-Match`, 422 for non-children/duplicates); one reorder = one revision, so Undo writes the
previous list back. `NavTreeView` gains `resolvedPageName`.

**Deviations from the sample — need approval (sample-first rule):**
1. Navigation: no "Visible in menu" column/switch (no such backend field).
2. "Change target…" uses the shared `sf-asset-picker-dialog` (pages only), not the sample's own picker dialog.
3. Menu item detail saves explicitly (Save/Ctrl+S, target change is a draft); sample applies at once; no "Duplicate".
4. Tree rename (F2) on an item writes its label for the editing language.
5. A reference to a Pages folder shows "Leads to the first page of a folder".
6. Globals: Schema tab keeps `sf-cdl-sections-editor` (Content + Rules) instead of one code panel.
7. Globals: usage chips are one header chip plus a "Use in templates" list (the M35.17 form has no per-field slot).
8. Globals: a folder shows a name header and "select a global set" state (sample has no folder pane).
9. Globals: create/rename/move/delete need `canEditTemplates` (developer, not time travel); the old screen only checked read-only.

**Open:** the navigation-level entry page (wrapper's `startNode`) has no entry point any more; item breadcrumb has no
folder trail; deleting the open dirty global set from the tree can still show the leave dialog; `e2e/m8-journeys.spec.ts`
uses the old controls (M35.31); no browser check yet.
