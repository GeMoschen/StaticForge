# Feature: Pages (tree + editor)

**Spec:** §23.6 (page editor layout), §24.5 (#3 pages, #4 editor).
**Area:** frontend. **Epic:** M3.

## Goal

Build the pages list (folder tree) and the page editor with body/section editing and
autosave.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-page-list-tree.md](001-page-list-tree.md) | M3.2.2 |
| 2 | [002-page-editor-sections.md](002-page-editor-sections.md) | M3.3.3 |
| 3 | [003-autosave-conflict.md](003-autosave-conflict.md) | 2 |

## Feature exit criteria

- [ ] Page list = folder tree (virtual scroll) + table with multi-select bulk move/delete.
- [ ] Editor split view works: page fields + bodies/sections + preview; reorder via
      drag **and** keyboard.
- [ ] Autosave debounces and flushes on blur/switch/`Cmd-S`.

## Dependencies

`M3:project-context`, `M3:form-engine`, preview (feature 6) wired last.
