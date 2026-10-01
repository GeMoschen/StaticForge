---
id: M35.8
status: done
depends: [M35.6, M35.7]
epic: m35-ui-ux-overhaul
feature: design-system
area: frontend
---

# M35.8 — Data table, tree and splitter

## Context

- **Trees today:** `pages/folder-node` + `page-nav-node`, `media/media-folder-node` + `media-nav-node`,
  `templates/template-folder-node` + `template-nav-node`, `shared/components/sf-store-tree-node` (Content, Navigation,
  Globals), and the export tree. `sf-tree` is an empty wrapper. `shared/services/tree-clipboard.service.ts`,
  `sf-drop-target`.
- **Tables today:** `sf-table` is a passthrough with 20 bespoke `<table>`s. `features/changes` is the reference list.
- **Splitter today:** the page-editor divider (mouse only).
- User decisions 12, 14, 17, 18.

## Goals

### `sf-tree` (headless data plus a rendering component)

- Data source interface: children are loaded lazily, and the tree shows an icon, label, secondary text (dev-mode UID),
  status badges and a drag handle per node.
- Sorted by name (Navigation passes its own order).
- ARIA `tree`, `treeitem` and `group`, with `aria-level`, `aria-setsize`, `aria-posinset` and `aria-expanded`.
- **Keyboard (roving tabindex):**
  - ↑/↓, ←/→ (collapse/parent, expand/child), Home/End, `*` (expand siblings), type-ahead.
  - Enter opens; Space selects.
  - `Shift`/`Ctrl` multi-select.
  - `F2` renames inline; `Del` deletes (via `ConfirmService` and undo).
  - `Ctrl+X/C/V` cut, copy and paste through `TreeClipboardService`.
  - `Shift+F10` or the ContextMenu key opens the context menu.
- A ⋮ menu button on hover and focus.
- **Filter box:** client-side highlight, or server search for large trees. It auto-expands matches and shows a
  "no results" state.
- Expansion is persisted per project and tree via `PreferencesService`, with expand-all/collapse-all.
- Drag and drop move with valid-target feedback, plus a keyboard move alternative (cut and paste, or "Move to…").
- Inline create (new folder, new item row) and inline rename (validation errors inline).
- **Names never truncate before secondary text.** Secondary text truncates first; names show fully in a tooltip when
  cut.
- One selection style.
- Skeleton loading.

### `sf-data-table`

- Column definitions:
  - Cell templates.
  - Sortable columns (multi-sort with `Shift`).
  - Resizable, hideable and reorderable columns (column chooser persisted in preferences).
  - Sticky header and first column.
- Selection: checkbox column, select page / select all matching, and a bulk action bar showing the count, actions and
  "Clear".
- Row keyboard as in Changes: ↑/↓, Space, Enter, `Shift`-range.
- Filter bar: search, filter chips, filter menu. State is synced to URL query params.
- Server or client paging: a pager or infinite scroll, with `aria-rowcount` and `aria-busy`.
- Density-aware row height. Empty, skeleton and error states.
- The table fills the available height inside the frame; the page itself never scrolls a second time.

### `sf-splitter`

- Horizontal and vertical.
- `role=separator` with `tabindex`, `aria-valuenow/min/max`, arrow keys (Shift for large steps), Home/End, and Enter to
  collapse or restore.
- Double click resets.
- Min and max sizes.
- Size persisted per pane id via preferences.
- Collapsible panes with a restore button.

## Acceptance criteria

- [x] Vitest specs for every keyboard interaction listed, multi-select, persisted expansion, clipboard, drag and drop
      (unit level), table sort/select/bulk/URL sync, and splitter keyboard and persistence.
- [x] Performance: a tree with 5,000 nodes (lazy) and a table with 1,000 client rows scroll smoothly (virtual scroll
      where needed; CDK `ScrollingModule` or equivalent).
- [x] `npx vitest run` and `npx ng build` green.

## Out of scope

- Replacing the feature trees and tables (screen tasks).

## Review (2026-10-01)

- **Virtual scrolling** (`shared/virtual/virtual-window.ts`, no CDK): pure window maths plus the `sfVirtualScroll`
  directive (fixed row height from the density tokens, follows a density switch, `scrollToIndex`). Before the viewport
  is measured it renders the first 100 rows over the full scroll height.
- **`sf-splitter`** (`shared/components/splitter/`) on the shared **`sfSeparator`** directive (WAI-ARIA window splitter:
  arrows, Shift for large steps, Home/End, Enter collapse/restore, double click reset, pointer drag): horizontal or
  vertical, sized start or end pane, min/max (or `minOther`), collapsible with an in-flow restore button, size and
  collapsed state persisted per `paneId` (`PreferencesService.paneSizes`). The drawer's resize edge now uses the same
  directive.
- **`sf-tree`** (replaces the empty wrapper; `shared/components/tree/tree-model.ts` is the headless state): lazy
  `loadChildren`, name sort or source order, flat virtualized `treeitem` rows with `aria-level/setsize/posinset`, the
  full keyboard set (arrows, Home/End, `*`, type-ahead, Enter/Space, Shift/Ctrl multi-select, F2, Del via
  `ConfirmService` + Undo toast, Ctrl+X/C/V through `TreeClipboardService` scoped per project and tree, Shift+F10 /
  Menu key), a ⋮ menu on the hovered and focused row, client or server filter with auto-expand and "no results",
  expansion persisted per project and tree (pruned to reachable nodes), expand/collapse all, drag and drop with drop
  rules and feedback plus cut/paste and "Move to…", inline create and rename with inline errors, names truncate last
  (tooltip only when cut), one selection style, skeleton, load errors with retry. The host owns every API call
  (`rename`, `create`, `delete`, `move` outputs with a `completed(undo?)` callback).
- **`sf-data-table`** (`shared/components/data-table/`): column definitions with cell/header templates, client or server
  sorting with Shift multi-sort, resizable/hideable/reorderable columns through a column chooser persisted per table
  (`PreferencesService.tableColumns`), sticky header and first column, checkbox selection (page, all matching), bulk
  bar, row keyboard as in Changes, search + filter chips + filter menu synced to the URL (`q`, `sort=name,-changed`,
  `page`, one param per filter, optional prefix), pager or infinite scroll with `aria-rowcount/rowindex` and
  `aria-busy`, empty/skeleton/error states, fills the available height. `sf-checkbox` gained `controlTabindex`.
- The three screens that wrapped their own trees in the old `<sf-tree>` (Content, Globals, Navigation) use a plain
  `<div>` until their screen tasks migrate them.

Verification: `npx vitest run` 198 files / 1,620 tests; `npx ng build` green (1.94 MB initial, unchanged — nothing
mounts the new components yet); `npm run lint` green. In Chrome (dev build, shared 4-core machine): a tree with 5,050
expanded lazy nodes renders ~50 rows and scrolls end to end at p50 18 ms / p95 24 ms per frame; a 1,000-row client table
renders ~47 rows at p50 17 ms / p95 21 ms; End/Home reach node 5,050 and row 1,001 by keyboard; Space selects and the
bulk bar counts; the header checkbox shows indeterminate; the splitter widens, collapses and restores by keyboard.

Found on the way (each fixed with a spec):
- The collapsed splitter's restore button covered the neighbouring pane's content (now in the flow).
- A review pass: superseded tree loads never settled (create, reveal, expand-all and search hung); focus and editor
  scrolls ran before the virtual spacers grew; rows scrolled out of the window lost keyboard focus (tree and table),
  an open editor's text, and a drag's `dragend` (a later external drag emitted a stale move); the tree clipboard was
  shared across projects; tree load errors were swallowed; restored expansion ignored a project switch and only ever
  grew; "Load more" died after a failed batch; Shift range selection without an anchor selected one row (tree and
  table); an unmeasured list rendered every row at once; the drawer's default width changed after the first check.

Deviations:
- No CDK: the virtual scroller is in-house (fixed row heights, which every list here has).
- The tree is a flat list of `treeitem`s with level/size/position attributes instead of nested `group`s — the
  accessible pattern for a virtualized tree.
