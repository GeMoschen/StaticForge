# Feature: Docs + E2E verification

**Spec:** Documentation follow-ups to §18.2, §18.4, §18.5 and §20.2; E2E per §25.6.

## Goal

Prove the whole epic end to end in the browser and document the new concepts: reason
chains, dry run, stored plans, asset impact, and the corrected incremental publish
semantics.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs-and-e2e.md](001-docs-and-e2e.md) | `M22.3.1`, `M22.3.2`, `M22.4.1` |

## Feature exit criteria

- [ ] E2E journey covering preview → run → rebuilt pages → impact exists and passes
      against a live backend, or its non-execution is documented with the exact reason
      (see `M15.6` precedent).
- [ ] Spec, API reference, user guide and architecture docs describe the shipped
      behavior.

## Dependencies

`M22.1`–`M22.4`.
