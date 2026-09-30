---
id: M35.25
status: todo
depends: [M35.11, M35.12, M35.13, M35.14, M35.15]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.25 — Settings sub-pages, members, import/export

## Context

`features/settings/*` (general, code highlighting, compaction, languages, media, members, import, export),
`features/channels/*`. Routes and side menu from M35.11. Screenshots 80–81, 87.

## Goals

- **Every sub-page:**
  - `sf-page-header` and one form with the save UX (M35.13): Save enabled only when dirty, and the unsaved guard.
  - Explanations shortened into hints.
- **Languages and Channels:** `sf-data-table`s with drawers for add and edit. The native inputs are replaced.
  - Channels are developer mode only.
  - Checkbox labels sit next to their controls.
- **Compaction:** "Enable compaction" is a normal switch with an explanation, not a red button. Destructive runs need
  confirmation.
- **Members:** `sf-data-table`; roles as human labels; invite in a drawer; remove with confirm.
- **Import/export:**
  - A step layout: select (tree with `sf-tree` checkboxes), options, run, result.
  - No duplicated headings.
  - The export button sits beside the selection summary.
  - "/ ROOT" is replaced by the store name.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.
