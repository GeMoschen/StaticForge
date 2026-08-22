# Feature: Quality gates

**Spec:** §25.7 (quality gates).
**Area:** qa. **Epic:** M7.

## Goal

Enforce every CI quality gate and the complete 12-journey E2E suite.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-quality-gates-ci.md](001-quality-gates-ci.md) | M0.1.3 |
| 2 | [002-full-e2e-suite.md](002-full-e2e-suite.md) | all prior journeys |

## Feature exit criteria

- [ ] Coverage/branch/axe/OWASP/Liquibase-status/bundle gates all enforced and green.
- [ ] All 12 journeys pass.

## Dependencies

`M0:ci-pipeline`, all epics.
