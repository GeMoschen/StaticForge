# Feature: Docs + end-to-end verification

**Spec:** §25.6 (critical E2E journeys), §25.7 (quality gates); documentation in
`docs/template-developer-guide.md`, `docs/editors/`, `docs/user-guide.md`, `cms-specification.md`.

## Goal

Document pagination for developers and editors, fold the new behaviour into the spec, and prove
the whole flow in the running app: declare, configure, generate, link-check, change the source,
then run an incremental rebuild.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs-and-journey.md](001-docs-and-journey.md) | `M21.2.2`, `M21.3.1`, `M21.4.1` |

## Feature exit criteria

- [ ] Template developer guide, editor reference, user guide and spec sections updated.
- [ ] M21 E2E journey implemented and run against a live backend, or the execution caveat recorded
      with evidence.
- [ ] Epic exit criteria in `../README.md` ticked with evidence.

## Dependencies

All other M21 features.
