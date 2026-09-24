# Feature: Docs and end-to-end journey

**Spec:** §8, §9, §20.2, §23, §24, §26 follow-ups; §25 (Playwright journeys).

## Goal

Bring the spec and operator docs in line with the new account rules and prove the whole flow in the running app.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs-and-spec.md](001-docs-and-spec.md) | `M26.1.*`, `M26.2.1`, `M26.3.1` |
| 2 | [002-user-management-journey.md](002-user-management-journey.md) | `M26.4.*` |

## Feature exit criteria

- [x] Spec and `infra/README.md` describe the new rules and endpoints.
- [x] The Playwright journey is green against the dev stack.

## Dependencies

All other M26 features.
