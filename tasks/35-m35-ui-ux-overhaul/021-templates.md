---
id: M35.21
status: todo
depends: [M35.11, M35.12, M35.13, M35.14, M35.15]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.21 — Templates IDE

## Context

`features/templates/*` (after M35.2), `sf-cdl-sections-editor`, `sf-octl-editor`, `dataset-schema-editor`.
Screenshots 50–53 and E5. The CDL/OCTL split editor (M34) is strong; keep its behaviour. Developer-only screen (hidden
in editor view).

## Goals

- **Tree** (`sf-tree`):
  - Page templates, section templates, datasets, folders.
  - Filter.
  - A full menu: New (explicit kind: page template, section template, dataset, folder), Duplicate, Rename, Move, Delete
    (confirm and undo), Used by.
  - One selection style (fixes the double highlight).
- Selection lives in the URL (`/templates/:uuid`). Switching templates goes through the unsaved guard (M35.13).
- **Folder view:** `sf-data-table` of templates: name, kind, channels, used by (count), modified.
- **IDE:**
  - `sf-page-header`: name, kind, inheritance chain as breadcrumb, save status, primary *Save* (enabled only when
    dirty, `Ctrl+S`), ⋮.
  - Metadata and pagination paths in a collapsible *Settings* section.
  - CDL panel and channel panel in an `sf-splitter`, stacking below 1280 px as tabs (CDL | Channels) so nothing is
    clipped at 1024.
  - Diagnostics list per tab, with jump-to.
- **Output path check:** warn inline when a multi-language project's output path lacks `{locale}` (M35.1 item 10
  provides the rule).
- **New template dialog:** the kind is chosen explicitly, never inferred from the selection.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated (URL selection, guard on switch). `npx vitest run` and `npx ng build` green.
