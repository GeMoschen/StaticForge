---
id: M35.22
status: done
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
1. "Change target…" uses the shared `sf-asset-picker-dialog` (pages only), not the sample's own picker dialog.
2. Menu item detail saves explicitly (Save/Ctrl+S, target change is a draft); sample applies at once; no "Duplicate".
3. Tree rename (F2) on an item writes its label for the editing language.
4. A reference to a Pages folder shows "Leads to the first page of a folder".
5. Globals: Schema tab keeps `sf-cdl-sections-editor` (Content + Rules) instead of one code panel.
6. Globals: usage chips are one header chip plus a "Use in templates" list (the M35.17 form has no per-field slot).
7. Globals: a folder shows a name header and "select a global set" state (sample has no folder pane).
8. Globals: create/rename/move/delete need `canEditTemplates` (developer, not time travel); the old screen only checked read-only.

**Signed off by the user on 2026-10-07** (Telegram: "Signoff m35.022"): the eight sample deviations above are approved as built.

**Open:** item breadcrumb has no folder trail; deleting the open dirty global set from the tree can still show the leave dialog; `e2e/m8-journeys.spec.ts`
uses the old controls (M35.31); no browser check yet.


## Notes (M35.22 follow-up — 2026-10-04, user decisions)

Two features the first build left out, both decided by the user on 2026-10-04 and designed in gate round 14 (decisions 168–171,
"signed off 2026-10-04 (user instruction)"): **Visible in menu** and the **navigation Entry page** (this resolves the removed
deviation 1 and the entry-page item of *Open*).

**Visible in menu — backend.** The payload field `visibleInMenu` (boolean, `MenuVisibility` in `asset.folder`) on
`PAGE_REFERENCE` items and navigation folders; **absent = true**, so all existing data stays visible, and it is stored in the
payload like `label`/`startNode`, so export/import archives and releases carry it with no change (payloads round-trip generically).
- Set through the existing update endpoints: `PATCH …/navigation/references/{uuid}` takes `visibleInMenu` with the other fields, or
  **alone** (no `targetKind`/`targetAssetUuid`: a partial update that keeps target and label — `PageReferenceService#setVisibleInMenu`);
  `PATCH …/navigation/folders/{uuid}` takes `visibleInMenu` (400 if not a boolean; `FolderService#updateVisibleInMenu`, navigation scope
  only, not for the protected wrapper). One change = one revision, undone by writing the previous value (`If-Match` = the revision the
  write produced).
- Read: `NavTreeView.visibleInMenu` (+ **`startNode`**, new, so the UI needs no extra read for entry pages), `NavigationFolderView.visibleInMenu`,
  `PageReferenceView.visibleInMenu`; `NavTreeNode.visibleInMenu` (the old 8-argument constructor stays and means visible).
- **Hidden = left out of generated menus:** `NavigationTreeJson.toJson` omits a hidden child with its whole subtree (so `$CMS_NAVIGATION`,
  `$CMS_FOR … nav:` and the default `NavigationHtmlRenderer` HTML never see it, and it never puts an ancestor on the `trail`); the
  renderer also skips JSON nodes marked `"visibleInMenu": false`. The editor tree (`GET …/navigation/tree`) still lists every entry; the
  target page exists and builds. `resolveFolderEntry`, `resolve`, `firstNavigablePage`, `indexPage` and `danglingPageReferences` ignore the
  flag (a hidden item can be a folder's entry page). `$CMS_PAGINATION` over a navigation folder is a content listing, not a menu: it is
  unchanged (it keeps honouring the *page's* `nav.visible`).

**Visible in menu — UI.** `NavEntry.visible`; folder table column **Visible in menu** (sortable, icon + *In menu* / *Hidden from menu*,
hidden rows muted); **Visible in menu** switch in the menu item detail (a draft saved with Save/Ctrl+S together with label and target; the
header shows the saved state); **Show in menu / Hide from menu** as bulk actions of the table, in a folder's ⋮ menu and in the tree's context
menu — `NavigationItemActions#setVisibility` writes one revision per entry, skips entries that already have the value and the wrapper, stops
at the first failure, and offers one Undo toast for the group. Hidden entries in the tree: muted name (`SfTreeNode.muted`, new) plus the
neutral eye-off badge. Sample: bulk actions, hidden marker, the wording *Visible in menu*.

**Entry page (navigation) — UI.** The backend already had it (`PATCH …/navigation/folders/{uuid}` with `startNode`: a direct child,
`PAGE_REFERENCE` or `FOLDER`; `NavigationService#resolveFolderEntry`); the old pre-M35.22 screen set it in the folder drawer (`nav-folder-detail`,
reached from "All navigation"), the rewrite kept an inline select for non-root folders only. Now, for **every** folder including the wrapper:
the folder view header has an **Entry page** line (the chosen child and the page it leads to, or *None — grouping only*) with **Change…**;
*Entry page…* is in the folder's ⋮ menu and the tree's folder context menu; all open `NavEntryDrawerComponent` (`sf-drawer`, radio list of None +
the direct children, **Apply** = one revision, Undo toast). The wrapper ("All navigation") is a folder view of its own: the tree title is a
button that opens it (`?asset=<wrapper uuid>`; the empty state offers the same), with only *Entry page…* in its ⋮ menu. Read-only for viewers,
time travel and archived projects (`canEditContent`).
- Decision taken: the server accepts only a **direct child** as `startNode`, so "pick a page" means picking the menu item that leads to it
  (create one first with *New menu item*); no new endpoint was needed.

**Tests.** Backend: `NavigationServiceImplTest` (flag in the tree, default, entry/page resolution unaffected), `NavigationHtmlGoldenTest`
(hidden item + subtree, all-hidden folder, JSON flag; corpus case `05-hidden-items`), `NavigationApiIntegrationTest` (flag through both
PATCH endpoints, defaults, 400/403, `startNode` in the tree). UI: specs for the util (flag, muted node, wrapper, entry), service, actions
(`setVisibility`), folder view (entry line, column, sort, bulk, ⋮, wrapper), item detail (switch), entry drawer, the area (wrapper, context menu,
visibility with Undo) and the sample.

**Not verified:** Gradle cannot run offline here, so the Java was compiled with `javac` against the jars in `~/.gradle` and the existing
`build/classes` (sf-domain, sf-api and the changed tests, including the `@SpringBootTest` classes) and `NavigationServiceImplTest` +
`NavigationHtmlGoldenTest` (28 tests) were run with a small reflective JUnit-less runner — the Spring/DB integration tests
(`NavigationApiIntegrationTest` and the rest of `sf-app`) were compiled but **not run**; there is no generation-level test (sf-generate) of a
hidden item yet, and no browser check.
