---
id: M35.26
status: todo
depends: [M35.14]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.26 — Search page

## Context

`features/search/*` (facets, pager, empty states, "Rebuild index"). Screenshots 78–79d. The palette itself is M35.14.

## Goals

- Results use `sf-data-table` or a result list with type icons, name, breadcrumb path and a snippet with highlights.
  Snippets exclude raw select values and CDL for editors.
- Match chips ("Name", "Content") use neutral styling, not error red.
- Facets sit in a collapsible side panel; filters live in the URL.
- The folder filter uses a folder picker, not a path placeholder.
- *Rebuild index* appears only for project admins, in ⋮.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.
