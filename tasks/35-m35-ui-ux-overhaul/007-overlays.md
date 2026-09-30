---
id: M35.7
status: todo
depends: [M35.5]
epic: m35-ui-ux-overhaul
feature: design-system
area: frontend
---

# M35.7 — Overlays: dialog, confirm, drawer, popover, menu, toast

## Context

`core/ui/dialog.service.ts` (4 consumers, each rendering its own markup), `design/_dialog-shell.scss` (11 dialogs),
bespoke overlays (page-editor palette, `sf-diff` scrim, generation dialog, media drawer, conflict drawer, preview share
popover). There are 25 `role=dialog` components and none traps or restores focus. `sf-context-menu` and
`ContextMenuService` open only from a `MouseEvent`. `core/ui/toast.service.ts` and `toast-host`. User decisions 10
and 12.

## Goals

- **One overlay layer**: Angular CDK Overlay, or an in-house equivalent if the CDK isn't installed. It provides focus
  trap, focus restore to the opener, a scroll lock, `Escape` to close, stacking by the z-index scale, and `inert` on
  the background.
- **`sf-dialog`:**
  - Sizes sm/md/lg/full.
  - Header (title as `h2`, `aria-labelledby`), scrollable body, footer with actions (primary on the right).
  - `aria-modal`.
  - Opened via `DialogService.open(component, data)` and returns a typed result.
- **`ConfirmService.confirm({ title, message, confirmLabel, tone: 'danger'|'default', typeToConfirm?, details? })`:**
  - The only confirmation API.
  - `typeToConfirm` handles large deletes (for example the folder name, when more than N items are affected, per spec
    §24.6).
  - Copy rules: the verb names the action ("Delete 12 pages"), and "This cannot be undone" appears only when no undo
    exists.
- **`sf-drawer`:** right side, modal or non-modal, resizable through the splitter (M35.8), used for detail and history.
- **`sf-popover`:** anchored, click- or focus-triggered, `Escape` and outside click close it, and it closes on route
  change.
- **`sf-menu`:**
  - Menu button (⋮ or labelled), context menu (right click, `Shift+F10`, the ContextMenu key), submenus, and item
    groups with separators.
  - Items: icons, disabled with a reason, shortcut hints, danger items.
  - Keyboard: arrow keys, Home/End, type-ahead; focus goes to the first item on open.
  - `ContextMenuService` accepts a keyboard anchor element, not just a mouse event.
- **Toasts:**
  - Queue with max visible.
  - Action button (for example **Undo** with a countdown).
  - Pause on hover and focus.
  - Lifetime scales with text and action.
  - Keep the separate polite/assertive regions.
- Provide an ESLint rule or script that forbids `window.confirm`, `window.prompt` and `window.alert` in `src/app`.

## Acceptance criteria

- [ ] Vitest specs: focus trap and restore, Escape, stacked dialogs, typed confirm, menu keyboard (open via
      `Shift+F10`, arrow keys, type-ahead), toast undo invokes its callback and dismisses.
- [ ] Existing `DialogService` consumers migrated. The remaining `window.*` calls are listed for the screen tasks
      (the lint rule starts as a warning and becomes an error in M35.27).
- [ ] `npx vitest run` and `npx ng build` green.
