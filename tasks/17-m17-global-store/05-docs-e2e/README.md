# Feature: Global store docs + E2E verification

**Spec:** §25.6 (critical E2E journeys), plus documentation in `docs/` (template developer
guide, user guide, API, architecture) and a spec follow-up for §3/§16.

## Goal

Document the Globals store for both personas (Dev: CDL + `global:`/`CMS_GLOBAL`; Elena:
editing values) and prove the full journey end to end: create a set, reference it in a
template, edit the value, preview it, generate incrementally, and see the change only on
dependent pages.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs.md](001-docs.md) | `M17.3.1`, `M17.4.1` |
| 2 | [002-globals-journey.md](002-globals-journey.md) | `M17.3.1`, `M17.4.1` |

## Feature exit criteria

- [ ] Docs describe the store, the syntax, the role split and incremental rebuild behavior.
- [ ] The Playwright journey exists and its backend-level counterpart integration test passes.

## Dependencies

`M17.1`–`M17.4`.
