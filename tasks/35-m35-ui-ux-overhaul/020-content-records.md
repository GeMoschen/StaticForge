---
id: M35.20
status: todo
depends: [M35.11, M35.12, M35.13, M35.14, M35.15, M35.17]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.20 — Content: record sets and records

## Context

`features/content/*`: `content`, `record-set-view`, `record-grid` (the richest list: server paging, multi-sort, quick
search, expression filter, column chooser), `record-editor`, move dialog, and `dataset-schema-editor` (its editor part
stays in M35.21). Screenshots 30–33 and E3.

## Goals

- **Tree** (`sf-tree`): folders and record sets, with a filter. Unify the menu (New folder, New record set, Move,
  Rename, Delete, History, Used by) with the other trees; cut and paste replace the separate "Move to…" dialog where
  possible.
- **Folder view:**
  - `sf-data-table` of record sets: name, dataset, record count, modified.
  - The dataset chips become a filter chip group with clear labels ("Dataset: Products").
- **Record set view:**
  - `sf-page-header` with breadcrumb and actions (New record, Release…, ⋮).
  - The query panel is collapsed by default and shows a readable summary ("Where role is lead · sorted by name").
  - The expression editor appears in developer mode only; editors get a simple filter builder.
  - `record-grid` moves onto `sf-data-table` with **row selection and bulk actions**: delete (undo), move, release.
- **Record editor:**
  - Header like the page editor: name, save status, Release, History, ⋮ with Delete.
  - The record's display name is used, never its UUID.
  - The same top layout as the set view.
- **New record set dialog:** no preselected dataset; explain that the dataset can't be changed later.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated (grid selection and bulk). `npx vitest run` and `npx ng build` green.
