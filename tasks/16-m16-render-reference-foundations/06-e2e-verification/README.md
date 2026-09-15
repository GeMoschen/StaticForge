# Feature: E2E verification

**Spec:** §25.6 (critical journeys), §25.7 (quality gates). Verifies `M16.1`–`M16.5` together and
closes the documentation drift they create.

## Goal

Prove that the foundations work together through the real app, not only in unit and integration
tests. Do it before any feature epic (`M17`+) builds on them. Also update the spec and docs wherever
this epic changed documented behavior:
- §5.4 column names and the `NAV` kind
- §16.2 cross-asset values are no longer "deferred"
- §15.2 settings are now honored
- §10.5 validation split
- new diagnostic codes

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-foundations-regression-journey.md](001-foundations-regression-journey.md) | M16.1.1, M16.2.2, M16.3.3, M16.4.1, M16.5.1, M16.5.2 |

## Feature exit criteria

- [x] A Playwright journey covers cross-asset values, usages after save, a delete guard with a stale
      reference, PRETTY channel URLs, an include-cycle diagnostic and required-field publish blocking.
      *Proof:* `ui/e2e/m16-journeys.spec.ts`, 5/5 passed against a live dev backend (M16.6.1).
- [ ] The docs and spec reflect the new behavior, and every new diagnostic code is catalogued.
      *Not ticked:* the docs/spec sync is on the docs agent's branch and not merged into `m16-foundations` yet.
- [x] The 5,000-page benchmark shows no regression (full build < 5 min, incremental < 10 s, §2.1 G5).
      *Proof:* M16.6.1 notes — 5,000 pages, median full 10.5 s / incremental 1.05 s on m16 vs 8.8 s / 0.38 s on master; both far inside G5.

## Dependencies

All of `M16.1`–`M16.5`.
