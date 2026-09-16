# Feature: Docs + E2E verification

**Spec:** Updates §13, §16.2, §16.9, §16.11 and Appendix B. Adds a critical journey per §25.6.

## Goal

Document inheritance where template developers look for it. Prove the full author → preview →
generate → change-parent → incremental-rebuild loop end to end.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs-and-journey.md](001-docs-and-journey.md) | `M20.4.1` |

## Feature exit criteria

- [ ] Docs updated, and the diagnostic catalogue matches `DiagnosticCodes`.
- [ ] The E2E journey exists, collects, and runs (or its execution caveat is recorded, as in M15.6).

## Dependencies

`M20.1`–`M20.4`.
