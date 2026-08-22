# Feature: Structure & navigation

**Spec:** §17 (entire).
**Area:** backend + frontend. **Epic:** M5.

## Goal

Implement the `structure` asset: source/order/filter grammar, navigation computation, and
per-channel nav renderers (`$CMS_NAV`, `$CMS_NAV_RECURSE`).

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-structure-domain.md](001-structure-domain.md) | M5.1.1 |
| 2 | [002-navigation-builder.md](002-navigation-builder.md) | 1 |
| 3 | [003-nav-renderers.md](003-nav-renderers.md) | 2, M2.4.2 |
| 4 | [004-structure-ui.md](004-structure-ui.md) | 3, M3.2.2 |

## Feature exit criteria

- [ ] `navigation`/`breadcrumb`/`list` kinds compute + render with active/trail marking
      and cycle protection (`SF-GEN-0410`).

## Dependencies

`M5:channels`, `M2:renderer`, `M4` (snapshot index reuse).
