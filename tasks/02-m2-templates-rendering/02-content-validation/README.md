# Feature: Content validation & expression evaluator

**Spec:** §14.4 (validation, `visibleWhen`), §10.5 (publish-time validation).
**Area:** backend. **Epic:** M2.

## Goal

Validate content values against a `ContentDefinition`, implement the shared
`visibleWhen` expression grammar (one grammar, back + front implementations), and
materialize content references for the `asset_reference` table.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-expression-evaluator.md](001-expression-evaluator.md) | — |
| 2 | [002-content-validator.md](002-content-validator.md) | M2.1.3, 1 |
| 3 | [003-reference-materialization.md](003-reference-materialization.md) | 2 |

## Feature exit criteria

- [ ] Required/maxLength/pattern/`visibleWhen` validation works; ERROR vs publish-only
      severity honoured (§10.5).
- [ ] The expression grammar has one shared test-fixture file consumed by back + front.
- [ ] Content/media/template references are materialized into `asset_reference`.

## Dependencies

`M2:cdl`, `M1` (asset_reference table groundwork).
