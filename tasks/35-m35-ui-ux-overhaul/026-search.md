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

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.
