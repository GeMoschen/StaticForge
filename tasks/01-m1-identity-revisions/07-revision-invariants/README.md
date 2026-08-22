# Feature: Revision invariants & test builders

**Spec:** §25.3 (test data builders), §25.5 (property-based revision invariants).
**Area:** qa/backend. **Epic:** M1.

## Goal

Prove the revision machinery is correct with property-based tests and reusable fixture
builders that exercise the real services.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-test-data-builders.md](001-test-data-builders.md) | M1.4.2, M1.5.1 |
| 2 | [002-property-based-invariants.md](002-property-based-invariants.md) | 1, M1.4.3 |

## Feature exit criteria

- [ ] Five invariants (§25.5) pass via jqwik with a 16-virtual-thread concurrency harness.
- [ ] Builders exercise the revision machinery rather than bypassing it.

## Dependencies

`M1:revision`, `M1:asset-api`.
