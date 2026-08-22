# Feature: Performance

**Spec:** §26.1 (perf), §18.6 (generation), §23.8 (frontend perf).
**Area:** fullstack. **Epic:** M7.

## Goal

Hit the §26.1/§18.6/§23.8 performance targets with measurements.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-frontend-performance.md](001-frontend-performance.md) | M3.2.2 |
| 2 | [002-generation-benchmark.md](002-generation-benchmark.md) | M4.2.1 |

## Feature exit criteria

- [ ] Frontend: initial JS ≤ 350 kB gzip, LCP ≤ 1.8 s, interactions ≤ 100 ms.
- [ ] Generation: 5,000-page fixture builds < 5 min, incremental < 10 s (§18.6).

## Dependencies

`M3`, `M4`.
