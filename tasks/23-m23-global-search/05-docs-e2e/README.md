# Feature: Docs, benchmark, E2E

**Spec:** Documentation follow-up to §20.2, §21.4, §23/§24 and §26.1/§26.2. It adds a critical
journey to §25.6.

## Goal

Close the epic with proof and documentation:

- **E2E journey.** Create content, find it via Ctrl+K, open it, edit it, and confirm the old term
  no longer matches.
- **Benchmark.** Query latency and full rebuild time on the 5,000-page fixture.
- **Documentation.** Document search for editors and operators, including the single-instance
  scaling limit and the index volume.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs-benchmark-e2e.md](001-docs-benchmark-e2e.md) | M23.2.2, M23.3.1, M23.4.1, M23.4.2 |

## Feature exit criteria

- [ ] E2E journey spec exists and passes against a live backend (or is recorded with the exact
      reason it could not run, as in `M15.6`).
- [ ] Benchmark numbers recorded against the epic targets.
- [ ] User guide, API docs, architecture, infra README / deploy runbook and spec updated.

## Dependencies

All of `M23.1`–`M23.4`.
