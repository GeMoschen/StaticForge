---
id: M2.1.2
status: done
depends: [M2.1.1]
epic: m2-templates-rendering
feature: cdl
area: backend
---

# M2.1.2 — CDL parser (AST)

## Context

Second stage of §14.7: recursive-descent parser building an AST.

## Goals

- Implement `CdlParser` (recursive descent) producing an AST representing `content`,
  `group`s, `editor`s of every type (§14.3), attributes/validators (§14.4), the
  `bodies` block (§14.6), and `list … item` nesting.
- Preserve source positions on every node for later diagnostics.
- Reject structural errors (unbalanced braces, unknown constructs) with positions.

## Acceptance criteria

- [ ] The §14.2 and §14.6 examples parse into the expected AST shape.
- [ ] Malformed source yields positioned parse errors.

## Out of scope

- Semantic validation (next task).

## Notes / hazards

- Keep AST immutable; it feeds both validation and (later) the frontend form engine.
