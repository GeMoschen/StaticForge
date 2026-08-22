---
id: M0.4.3
status: done
depends: [M0.4.1]
epic: m0-skeleton
feature: frontend-shell
area: frontend
---

# M0.4.3 — Core UI plumbing

## Context

Build the shared UI infrastructure (`core/ui` + `shared/`) that feature screens will
reuse: toasts, dialogs, keyboard shortcuts, and the base shared components/pipes from
§23.2.

## Goals

- Implement `toast.service`, `dialog.service`, `shortcut.service` (keyboard manager
  supporting `Cmd/Ctrl+K`, `?`, `g p/m/t/r` per §24.6).
- Scaffold `shared/components` (`sf-button`, `sf-field`, `sf-table`, `sf-tree`,
  `sf-empty-state`, `sf-diff` placeholder), `shared/directives` (`sfAutofocus`,
  `sfTooltip`, `sfDropTarget`), and `shared/pipes` (`sfRelativeTime`, `sfFileSize`).
- Add the command-palette overlay (centered 640px, §24.4) as an initial consumer of the
  shortcut service.

## Acceptance criteria

- [ ] Toast/dialog/shortcut services exist with unit tests.
- [ ] Command palette opens with `Cmd/Ctrl+K` and lists registered commands; `?` shows a
      shortcut sheet.
- [ ] Shared components compile and render in a demo route.

## Out of scope

- Full component implementations (trees/filters) needed by later features; placeholders
  are acceptable here.

## Notes / hazards

- Shortcut handling must respect focus in inputs/Monaco and be customizable (single map).
