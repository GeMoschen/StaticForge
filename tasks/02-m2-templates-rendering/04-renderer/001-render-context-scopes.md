---
id: M2.4.1
status: done
depends: [M2.3.3]
epic: m2-templates-rendering
feature: renderer
area: backend
---

# M2.4.1 — RenderContext & scopes

## Context

Implement the render context and the scope rules of §16.5.

## Goals

- Implement `RenderContext` carrying: current channel + escaping mode, the asset being
  rendered, `$CMS_META` values (§16.2), and the enclosing page for `$CMS_PAGE.*`.
- Implement scope resolution per §16.5: section (own editors + meta + page read-only +
  loop vars), page (own editors + bodies + meta + loop vars), navigation (node fields:
  `label`, `href`, `active`, `level`, `children`, `page`), list loop (`item.*`,
  `item._index/_first/_last/_count`).
- Enforce read-only upward `$CMS_PAGE.*` access (§16.5).

## Acceptance criteria

- [ ] `$CMS_PAGE.headline$` inside a section reads the enclosing page's value (read-only).
- [ ] Loop variables and nav node fields resolve per §16.5.

## Out of scope

- Actual output production (next task).

## Notes / hazards

- Sections never write; reject any write-side path.
