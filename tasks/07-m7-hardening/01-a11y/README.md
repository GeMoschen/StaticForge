# Feature: Accessibility (WCAG 2.2 AA)

**Spec:** §24.7.
**Area:** frontend. **Epic:** M7.

## Goal

Reach and prove WCAG 2.2 AA (AAA where feasible) per §24.7.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-a11y-sweep.md](001-a11y-sweep.md) | — |
| 2 | [002-contrast-motion-tests.md](002-contrast-motion-tests.md) | 1 |

## Feature exit criteria

- [ ] Zero axe violations of impact serious/critical; body-text contrast ≥ 7:1.
- [ ] Full keyboard operation incl. drag-drop alternatives and panel resize.

## Dependencies

`M3`/`M6` (all screens exist).
