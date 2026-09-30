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

## Acceptance criteria

- [ ] Vitest: chord timing, input suppression, scope activation/deactivation on route change, palette action
      filtering by permission, and the sheet reflects the registry.
- [ ] No component uses raw `document`/`window` `keydown` listeners for shortcuts (grep check).
- [ ] `npx vitest run` and `npx ng build` green.

## Notes / hazards

- Check browser-reserved combinations (`Ctrl+H` is history in some browsers, `Ctrl+Shift+B` is the bookmarks bar).
  Where the browser wins, pick an alternative and record it.
