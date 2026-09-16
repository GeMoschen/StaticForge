# Feature: Docs + E2E verification

**Spec:** §25.6 (critical E2E journeys), §25.7 (quality gates); docs under `docs/`.

## Goal

Document the Content store for all personas and prove the full journey — schema → records →
template loop → generation → incremental rebuild → export/import — end-to-end.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs.md](001-docs.md) | `M19.3.2`, `M19.4.2` |
| 2 | [002-content-store-journey.md](002-content-store-journey.md) | `M19.1.3`, `M19.3.2`, `M19.4.2` |

## Feature exit criteria

- [x] Template developer guide, user guide, editor docs, API docs and architecture map describe
      datasets/records accurately against the shipped code.
- [x] A Playwright journey and a backend integration journey cover the end-to-end flow.

## Dependencies

All other `M19` features.
