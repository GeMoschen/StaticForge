---
id: M7.1.2
status: done
depends: [M7.1.1]
epic: m7-hardening
feature: a11y
area: frontend
---

# M7.1.2 — Contrast matrix & motion tests

## Context

Automate the §24.7 contrast and motion guarantees.

## Goals

- Automated contrast-matrix test in CI verifying token pairs (§24.3): body text ≥ 7:1,
  UI/large text ≥ 4.5:1.
- Enforce motion ≤ 200 ms and full suppression under `prefers-reduced-motion` (§24.3).

## Acceptance criteria

- [ ] CI fails if any token pair falls below the ratio threshold.
- [x] Reduced-motion bypasses all animations/transitions.

## Out of scope

- Non-automated manual checks.

## Notes / hazards

- Compute contrast in CI from the token values, not screenshots.
