---
id: M2.2.1
status: done
depends: []
epic: m2-templates-rendering
feature: content-validation
area: backend
---

# M2.2.1 — Expression evaluator (shared grammar)

## Context

Implement the tiny `visibleWhen` expression grammar of §14.4 once, with **one shared
test-fixture file** so backend and frontend evaluators are semantically identical
(§23.5).

## Goals

- Implement the grammar: `identifier (== | != | > | < | >= | <= | in) literal`,
  combined with `&&`, `||`, `!`, parentheses.
- Backend evaluator in `sf-template`.
- Publish a shared JSON test-fixtures file of cases that both implementations consume.

## Acceptance criteria

- [ ] All operators + precedence + truthiness cases pass.
- [ ] The JSON fixture file is the single source of truth for cases.

## Out of scope

- The frontend evaluator implementation (M3); here just authoring the shared fixture +
      interface contract.

## Notes / hazards

- Truthiness is defined separately in §16.9 for OCTL; here it's the `visibleWhen` subset.
      Keep the shared file versioned so both sides stay in lockstep.
