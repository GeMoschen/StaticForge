---
id: M2.3.2
status: done
depends: [M2.3.1]
epic: m2-templates-rendering
feature: octl
area: backend
---

# M2.3.2 — OCTL parser (AST per EBNF)

## Context

Second stage of §16.10: parse tokens into an AST following the §16.9 grammar.

## Goals

- Implement `OctlParser` producing an AST: `template`, `value` (accessor + filters +
  namedArgs), `ref`, `body`, `include`, `nav`, `if/elseif/else`, `for`, `set`, `meta`,
  `comment`, `nav_recurse`.
- Implement `accessor` (assetRef vs path) and `expr` (or/and/cmp/unary with `in`) per
  §16.9.
- Report structural errors with positions (unknown instruction, unbalanced block).

## Acceptance criteria

- [ ] The §16.6–16.8 examples parse into the correct AST.
- [ ] `SF-TPL-0101/0102` (unknown instruction / unbalanced block) are produced.

## Out of scope

- Reference resolution (next task), rendering (feature 4).

## Notes / hazards

- Keep truthiness semantics documented (§16.9) even though evaluation is at render time.
