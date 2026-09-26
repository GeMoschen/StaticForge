# Feature: Docs and journey

**Spec:** §2.1, §8.3, §8.4, §18.1, §18.5, §20.2, §24, §26.3, Appendix B.

## Goal

Bring the spec and docs in line with the implemented behaviour and prove the editor publishing flow end to end.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docs-and-spec.md](001-docs-and-spec.md) | `M28.2.3`, `M28.3.3` |
| 2 | [002-editor-publishing-journey.md](002-editor-publishing-journey.md) | `M28.3.2`, `M28.3.3` |

## Feature exit criteria

- [x] Spec and docs describe the policy, the endpoint roles and the new audit actions as implemented.
- [x] `ui/e2e/m28-journeys.spec.ts` green twice on a clean dev stack.

## Dependencies

Features 1–3.
