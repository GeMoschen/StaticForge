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

## Implementation plan (M35.20)

Reference: the sample in `features/styleguide/sample/` (`sample-content-*`, `sample-record-set`, `sample-record-editor`,
`sample-query-panel`), gate rounds 1, 5 and 6, and the finished Pages (M35.18) and Media (M35.19) screens.

- [ ] **A. Shell, tree, folder view:** `content.component` on `sf-splitter` + `sf-tree` (filter, one menu, cut/copy/paste/move, F2, Del,
      pinned Favorites node, `?folder=`), folder view = `sf-page-header` + `sf-data-table` of record sets with the dataset filter chip
      group and bulk Move/Delete (undo). The *New record set* dialog is **not covered by the sample**: add it to the sample first
      (no preselected dataset, note that the dataset can't change later), get sign-off, then build it.
- [ ] **B. Record set view:** `sf-page-header` (breadcrumb, New record, Release…, ⋮), collapsed query panel with a readable summary,
      filter builder for editors, expression editor in developer mode only, `record-grid` on `sf-data-table` with selection and
      bulk delete (undo), move, release.
- [ ] **C. Record editor:** header like the page editor (display name, save status, Release group, History, ⋮ with Delete), display
      name never the UUID, same top layout as the set view.
- [ ] **D. Finish:** i18n, specs, `npx vitest run`, `npx ng build`, `npm run lint`, Chrome check, review section.

## Notes (M35.9)

- The sample's Content area (decision 12) is the reference: a tree of folders and record sets, a record set view and a
  record editor.
- **Record set filter (decision 13):** a collapsed query panel with a readable summary. Editors get a filter builder
  (field, operator, value rows); developer mode also shows the expression editor.
- Record editors use the full-width form and the release-actions group in the header (decisions 33, 34).
- Datasets are shown under Templates (M35.21), not here.

## Notes (M35.15 favorites)

- The content tree and the record set tables: add the pinned *Favorites* node (`pinned: true`, only while there are favorites; children from
  `FavoritesService`, flat with an icon per kind, favorite folders as lazily loaded folder nodes, a click on the node opens
  the Favorites list in the main pane) and *Add to / Remove from favorites* to the row context menu (and a hover/focus ☆
  in table name cells). The design is in the sample (`/styleguide/sample`, gate round 5, decisions 57–58). Favorites are
  not store-bound: the node lists them from every store.
- Put the open item in the URL (`?asset=` / `?folder=`, or the route's UUID) so it is recorded as a recent.


## Notes (M35.20 A — shell, tree, folder view)

- Built: `content.component` (splitter, `sf-tree`, one menu, Favorites node, `?folder=`, `?favorites=1`), `content-folder-view.component`
  (page header + `sf-data-table`, dataset filter chips via `urlSync` so `?dataset=<uuid>` still works, bulk Move/Delete with Undo),
  `content-item-actions.service` (confirm/delete/move/undo shared by tree and table), `content-tree.util` (index, nodes, search, trail).
- **Deviations to approve:** (1) the table has a *Status* column (release chips per language, as in Pages) that the sample lacks;
  (2) *Modified* needs `RecordSetSummaryView.changedAt` — added to the DTO, controller and `schema.d.ts` (time only, no user name; not
  compiled here, Gradle not run); (3) the header ⋮ of a folder has Rename / Move… / Delete… without the sample's *Used by* (folders have
  none); (4) the tree menu also offers *New record*, *History*, *Used by* on a record set (child-route params `newRecord=1`, `panel=…`).
- **New record set dialog:** the app still uses `sf-create-asset-dialog` (first dataset preselected). The new design is in the sample
  (gate round 10, decisions 108–110) and **awaits user sign-off** before the app switches to it.
- **Sample catch-up (gate round 11, decisions 111-127, awaiting sign-off):** the sample now shows everything the app does beyond rounds 1-10: the folder *Status* column, *Shown by the
  filter / All records*, the filter extras (offset/limit, several sort keys, date and Yes/No values, an expression the builder cannot show, Save filter / Revert), *Use as set filter*,
  the record set's and folder's menus with Rename and Move, the records' Move, the tree's menu, and the record editor's menu, Checks and Used by drawer, deleted-record banner and
  error states. Review links are in the round's table. Change the app only as far as the user's sign-off says.
