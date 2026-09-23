# Feature: Docs & end-to-end journey

**Spec:** §3, §5.1, §16.2, §20.2 follow-ups; §25 quality gates (Playwright journeys).

## Goal

Document record sets for developers and editors, update the spec, and prove the whole flow in one
Playwright journey.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs.md](001-docs.md) | `M25.2.2`, `M25.4.1`, `M25.5.1` |
| 2 | [002-record-sets-journey.md](002-record-sets-journey.md) | `M25.2.3`, `M25.4.1`, `M25.5.*` |

## Feature exit criteria

- [ ] Developer guide, user guide, editor docs, API docs and spec updated.
- [ ] `ui/e2e/m25-journeys.spec.ts` green.

## Dependencies

All other `M25` features.
