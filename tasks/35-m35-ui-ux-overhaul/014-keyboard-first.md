---
id: M35.14
status: todo
depends: [M35.10]
epic: m35-ui-ux-overhaul
feature: frame
area: frontend
---

# M35.14 — Keyboard-first: shortcut registry, palette actions, `?` sheet

## Context

`core/ui/shortcut.service.ts` (`g`-chords stubbed as a no-op, `?` opens the palette),
`core/ui/command-palette/command-palette.component.ts` (search-only, good ARIA combobox). Per-component key handlers
(`Ctrl+Enter` preview, `Alt+↑/↓` sections, `Alt+P` generation). User decision 12.

## Goals

- **Shortcut registry:**
  - Every shortcut is declared with an id, keys (Mac/PC), scope (global, screen, component), a Transloco description
    key and a handler.
  - Conflicts are detected in dev.
  - Shortcuts are ignored while typing in inputs, except those that are explicitly allowed (`Ctrl+S`, `Ctrl+K`,
    `Esc`).
  - Components register and unregister through the registry. Ad-hoc `keydown` listeners are replaced.
- **Global set:**
  - `Ctrl/Cmd+K` palette.
  - `?` shortcut sheet.
  - `g` chords: `g h` home, `g p` pages, `g m` media, `g c` content, `g n` navigation, `g l` globals, `g t` templates,
    `g x` changes, `g b` publishing, `g s` schedules, `g ,` settings.
  - `Ctrl+S` save.
  - `Ctrl+H` history.
  - `[` toggles the rail.
  - `/` focuses the local filter.
  - `n` creates a new item in the current screen.
  - `Esc` closes the topmost overlay.
- **Screen sets:**
  - Trees: M35.8.
  - Tables: ↑/↓, Space, Enter, `Shift`, `Ctrl+A`.
  - Editors: `Alt+↑/↓` move section, `Ctrl+Enter` refresh preview.
  - Release: `Ctrl+Shift+R` opens the release dialog.
  - Build: `Ctrl+Shift+B` opens *Build now*.
  - Each screen task adds its own set to the registry.
- **Command palette:**
  - Result groups: *Actions* (context-aware: create page here, release this page, build now, switch project, toggle
    theme, density, developer mode, sign out), *Navigate* (every screen and settings page), *Recent*, *Favorites*,
    *Search results* (existing search).
  - Prefix modes: `>` actions only, `#` settings, `@` projects.
  - Fuzzy matching. Shortcut hints on the right. Actions respect permissions and developer mode.
- **`?` shortcut sheet:** a dialog listing the shortcuts of the current context and the global ones, grouped, with a
  search field. Generated from the registry, so it never drifts.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

**Signed off with M35.12:** the History drawer opens from the top bar button and `Ctrl+H` (register the shortcut here);
the drawer's *Open full history* leads to `/p/:key/history`.

## Acceptance criteria

- [ ] Vitest: chord timing, input suppression, scope activation/deactivation on route change, palette action
      filtering by permission, and the sheet reflects the registry.
- [ ] No component uses raw `document`/`window` `keydown` listeners for shortcuts (grep check).
- [ ] `npx vitest run` and `npx ng build` green.

## Notes / hazards

- Check browser-reserved combinations (`Ctrl+H` is history in some browsers, `Ctrl+Shift+B` is the bookmarks bar).
  Where the browser wins, pick an alternative and record it.

## Notes (M35.9 / M35.10)

- The `?` sheet and the `Ctrl+K` search field are already in the top bar (M35.10); the sheet lists only the two
  shortcuts that exist today and is filled from the registry here.
- Already built in the design system, to register rather than re-implement: `sf-tree` `Alt+↑/↓` sibling reordering
  (M35.9 decision 23), the menu and card shortcuts, and the `sf-catalog` card actions.
