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

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

**Signed off with M35.12 (gate decisions 41–46):** filter bars use the **normal control size** (as tall as the search
field; the shared `sf-data-table` toolbar already does), type filters show the type's icon, an open list item's row uses
`sf-data-table` `currentKey` (highlight + accent bar + `aria-current`), dialog footers use `<ng-container sfDialogFooter>`,
and list + detail panes are bordered cards with the splitter handle centred in a gap (`--sf-splitter-gap`).

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated (grid selection and bulk). `npx vitest run` and `npx ng build` green.

## Notes (M35.9)

- The sample's Content area (decision 12) is the reference: a tree of folders and record sets, a record set view and a
  record editor.
- **Record set filter (decision 13):** a collapsed query panel with a readable summary. Editors get a filter builder
  (field, operator, value rows); developer mode also shows the expression editor.
- Record editors use the full-width form and the release-actions group in the header (decisions 33, 34).
- Datasets are shown under Templates (M35.21), not here.
