---
id: M7.2.1
status: done
depends: [M3.2.2]
epic: m7-hardening
feature: performance
area: frontend
---

# M7.2.1 — Frontend performance tuning

## Context

Meet the §23.8 budgets.

## Goals

- Enforce bundle budget (initial JS ≤ 350 kB gzip; fail on > 5% regression).
- Lazy-load Monaco/TipTap only on their routes; virtual scroll everywhere (§23.8).
- Measure LCP ≤ 1.8 s and interactions ≤ 100 ms; add a perf CI step / budget.
- Optimistic UI with rollback already in place (verify no regressions).

## Acceptance criteria

- [ ] Budget enforced in CI; metrics recorded.
- [ ] LCP/interaction targets met on a mid-range profile.

## Out of scope

- Backend hotspots (noted but separate).

## Notes / hazards

- Keep zoneless + OnPush; ensure `trackBy` everywhere (§23.8).
