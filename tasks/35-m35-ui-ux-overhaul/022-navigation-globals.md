---
id: M35.22
status: todo
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

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.
