---
id: M35.7
status: done
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
- **`sf-menu`:** M35.6 already built the menu button (`shared/components/menu/sf-menu.component.ts`: items with icon,
  disabled, danger, separator, router link; arrow keys, Home/End, type-ahead, Escape/Tab/outside click, focus restore)
  and the anchored positioning (`shared/overlay/anchored-position.ts`), because tab overflow and the page header need
  them. Extend those rather than starting a second menu.
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

- [x] Vitest specs: focus trap and restore, Escape, stacked dialogs, typed confirm, menu keyboard (open via
      `Shift+F10`, arrow keys, type-ahead), toast undo invokes its callback and dismisses.
- [x] Existing `DialogService` consumers migrated. The remaining `window.*` calls are listed for the screen tasks
      (the lint rule starts as a warning and becomes an error in M35.27).
- [x] `npx vitest run` and `npx ng build` green.

## Review (2026-10-01)

- **Overlay layer** (`shared/overlay/overlay-stack.ts`, in-house — the CDK isn't installed): every dialog, drawer and
  popover registers its pane. z-index per layer from the token scale (`calc(var(--sf-z-modal) + n)` for stacked ones),
  Escape to the topmost overlay that takes it (a non-modal drawer only while focus is inside), Tab trapped in the topmost
  modal (overlays opened above it handle their own), `inert` on everything outside the topmost modal except
  `[data-sf-no-inert]` (the toast host), scroll lock, focus restore to the opener — only when focus was inside the
  overlay or lost with it. Anchored panels (menus, combobox, date picker, popovers) live in `<body>` on the popover
  layer, above dialogs and drawers.
- **Dialogs** (`shared/components/dialog/`): `sf-dialog` (sm/md/lg/full, `h2` title + `aria-labelledby`, scrolling body,
  `[sfDialogFooter]`, × and backdrop when `dismissible`, focus starts on the content). Works inline (`@if`, moves itself
  into `<body>`, emits `closed`) and as the root of a component opened by `DialogService.open(component, data,
  { injector })` → `SfDialogRef<R>.result`. A service dialog closes (resolving `undefined`) on a route change and when
  the opener's injector is destroyed. `ConfirmService.confirm({ title, message, confirmLabel, cancelLabel, tone,
  typeToConfirm, details, irreversible })` → `Promise<boolean>`; danger starts on Cancel, a typed confirmation on its
  field. The page's keyboard shortcuts are silent while a modal is open.
- **`sf-drawer`**: right edge, non-modal (default) or modal, keyboard/pointer resizable through a `role=separator`
  handle (`width` two-way). M35.8's splitter replaces the handle's internals.
- **`sf-popover`** + `[sfPopoverTrigger]`: click (focus moves in) or focus/hover trigger, Escape on panel or trigger,
  outside click, route change; `role=dialog` non-modal.
- **Menus**: `sf-menu-panel` shared by `sf-menu` and `sf-context-menu`; submenus (→/Enter/Space open, ←/Escape close,
  hover), `shortcut` hints (`sf-kbd`, `aria-keyshortcuts`), `disabledReason` (reachable, described, tooltip), `group`s,
  `action`. `ContextMenuService.open(MouseEvent | KeyboardEvent | HTMLElement, items)`: a keyboard `contextmenu`
  (Shift+F10, the Menu key) anchors to the element; focus to the first item, back to the opener on close. The 15
  callers are unchanged.
- **Toasts**: max 3 visible + queue (errors ahead of waiting news), lifetime `clamp(base + 60 ms × length, 5–12 s)`
  (+6 s with an action), pause on hover/focus, `undo(message, run)` with a visual countdown (not announced as it
  ticks), polite/assertive regions kept, bottom centre (a corner stack covered drawer footers), focus moves on when a
  focused toast closes.
- **Migrated** from the old `core/ui/dialog.service` (removed): URL registry resets, Languages (URL change, discard
  translations), revision rollback (typed ROLLBACK), media delete (typed DELETE while referenced; the bespoke
  `sf-media-drawer-delete-dialog` is gone). `lint:dialogs` (`scripts/check-window-dialogs.mjs`) warns now; M35.27 runs
  it with `--strict`.

Verification: `npx vitest run` 192 files / 1,512 tests; `npx ng build` green (initial 1.94 MB, was 1.91); `npm run lint`
green. Checked in Chrome: typed confirm (Enter confirms once typed), a dialog with a combobox and a confirm stacked on
top (Escape order list → confirm → dialog, lower dialog inert, focus restored), menu with submenu, Shift+F10 context
menu, drawer, popover, Undo and error toasts.

Found on the way (each fixed with a spec):
- Panels of controls (combobox, date picker, menus) were on the dropdown layer, below modals: inside a dialog they
  would have opened behind it.
- Toasts in the bottom-right corner covered the drawer's footer actions.
- A review pass: service dialogs outlived a route change or their opener (a confirm could act for a destroyed screen);
  page shortcuts fired behind a modal; a URL reset confirmed while another ran could be lost (one shared pending scope,
  buttons not disabled while busy); a referenced media file could be deleted without DELETE when Delete was pressed
  before its usages loaded; Tab inside a popover in a dialog jumped back into the dialog; Escape didn't close a
  focus-opened popover; closing a non-modal overlay pulled focus from where the user had moved on; activating a toast
  button dropped focus to `<body>`.

Behaviour change in the migrated screens: confirmations close on confirm and the outcome comes as a toast (the old URL
reset and media delete dialogs stayed open with "Resetting…"/"Deleting…"); the reset/delete buttons stay disabled while
the request runs.

Remaining `window.confirm`/`prompt` calls (30), for the screen tasks to replace with `ConfirmService`:
- M35.16 (account, admin): `account.component.ts:162`, `admin-job-detail.component.ts:238`,
  `admin-projects.component.ts:56`, `admin-user-detail.component.ts:196, 213, 235, 357`
- M35.17 (content form and editors): `forms/editors/rich-text-editor.component.ts:85` (`prompt` for the link URL — needs
  a small link dialog)
- M35.18 (pages): `pages/folder-detail.component.ts:103`, `pages/folder-node.component.ts:246`,
  `pages/page-nav-node.component.ts:266`
- M35.19 (media): `media/drawer/media-drawer-files.store.ts:209`, `media/drawer/media-drawer-text.store.ts:73`,
  `media/library/media-folder-actions.ts:192`, `media/library/media-item-actions.ts:79, 99`,
  `media/media-folder-detail.component.ts:104`, `media/media-folder-node.component.ts:259`,
  `media/media-nav-node.component.ts:150`
- M35.20 (content records): `content/dataset-schema-editor.component.ts:277`, `content/record-actions.service.ts:60`,
  `content/record-set-actions.service.ts:33`
- M35.21 (templates): `templates/template-folder-node.component.ts:310`
- M35.22 (navigation): `navigation/nav-folder-detail.component.ts:157`,
  `navigation/nav-reference-detail.component.ts:234`
- M35.23 (schedules): `schedules/schedules.component.ts:214`
- M35.24 (redirects): `settings/project-settings-redirects.component.ts:188`
- M35.25 (members): `settings/project-settings-members.component.ts:152, 181`
- M35.26 (search): `search/search-page.component.ts:284`

Deviations:
- Drawers don't persist their width yet (the `width` model is there; the preference wiring belongs to the screens and
  M35.15).
- The 25 bespoke `role=dialog` components are not migrated here (screen tasks); `sf-dialog` works inline for exactly
  that.
