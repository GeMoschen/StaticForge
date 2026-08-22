---
id: M5.3.3
status: done
depends: [M5.3.2, M2.4.2]
epic: m5-channels-navigation
feature: structure-navigation
area: backend
---

# M5.3.3 — Navigation renderers (`$CMS_NAV`, `$CMS_NAV_RECURSE`)

## Context

Implement `$CMS_NAV` and `$CMS_NAV_RECURSE` per §17.1.

## Goals

- Render a structure's per-channel template with a nav scope exposing node fields
  (`label`, `href`, `active`, `level`, `children`, `page`).
- Implement `$CMS_NAV_RECURSE(node)` re-entering the renderer at `level + 1`.
- Integrate with `$CMS_NAV(structure:uid)` resolution (recorded as `NAV` reference edge).

## Acceptance criteria

- [ ] The §17.1 nav example renders with correct levels/active/trail classes.
- [ ] Nested navs recurse correctly and terminate.

## Out of scope

- Breadcrumb/list renderer polish (same construct path).

## Notes / hazards

- Nav render results are memoized per build (feature navigation-builder).
