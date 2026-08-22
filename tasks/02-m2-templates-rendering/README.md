# M2 — Templates & Rendering

**Spec:** §12 (section template), §13 (page template), §14 (CDL), §16 (OCTL).
Roadmap M2 (§27): 4 weeks.

## Goal

Implement the two domain-specific languages and the render engine: CDL (declare what's
editable), OCTL (render per channel), their compilers/validators/diagnostics, the
section/page template assets, and the golden-file test harness that pins rendering
correctness.

## Exit criteria (epic is done when)

- [x] Golden-file render suite (§25.4) is green, including the `escaping-xss` corpus.
- [x] A page renders end-to-end (content → template → HTML output) via the API.
- [x] CDL and OCTL diagnostics are returned by `/cdl/validate` and `/octl/validate`.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [cdl](01-cdl/README.md) | backend | — |
| 2 | [content-validation](02-content-validation/README.md) | backend | 1 |
| 3 | [octl](03-octl/README.md) | backend | 1 |
| 4 | [renderer](04-renderer/README.md) | backend | 3 |
| 5 | [filters](05-filters/README.md) | backend | 3 |
| 6 | [template-assets](06-template-assets/README.md) | backend | 1, 3 |
| 7 | [render-tests](07-render-tests/README.md) | qa | 4, 5 |

## Dependencies

`M1-identity-revisions` (Asset/AssetVersion, revisions, page payload + section
instances, `asset_reference` readiness).
