---
id: M35.8
status: todo
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

- [ ] Vitest specs for every keyboard interaction listed, multi-select, persisted expansion, clipboard, drag and drop
      (unit level), table sort/select/bulk/URL sync, and splitter keyboard and persistence.
- [ ] Performance: a tree with 5,000 nodes (lazy) and a table with 1,000 client rows scroll smoothly (virtual scroll
      where needed; CDK `ScrollingModule` or equivalent).
- [ ] `npx vitest run` and `npx ng build` green.

## Out of scope

- Replacing the feature trees and tables (screen tasks).
