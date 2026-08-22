---
id: M7.2.2
status: done
depends: [M4.2.1]
epic: m7-hardening
feature: performance
area: backend
---

# M7.2.2 — Generation performance benchmark

## Context

Prove the §18.6 generation targets on a realistic fixture.

## Goals

- Build a 5,000-page (and 50,000-page) fixture generator (§25.1 performance row).
- Benchmark full vs incremental with JMH + Gatling, 2 channels, 8 vCPU, media unchanged.
- Tune parallelism/query paths to meet §18.6; record results.

## Acceptance criteria

- [ ] 500 p < 20 s / < 2 s; 5,000 p < 5 min / < 10 s; 50,000 p < 45 min / < 30 s.

## Out of scope

- Long-term partitioning (documented escape hatch, §26.2).

## Notes / hazards

- Add as a nightly CI job, not a per-push gate.
