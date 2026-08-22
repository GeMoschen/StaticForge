# Feature: CDL compiler

**Spec:** §14 (entire).
**Area:** backend. **Epic:** M2.

## Goal

Build the Content Definition Language lexer/parser/compiler (§14.7) that turns CDL
source into a normalized JSON `ContentDefinition` plus editor diagnostics.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-cdl-lexer.md](001-cdl-lexer.md) | — |
| 2 | [002-cdl-parser.md](002-cdl-parser.md) | 1 |
| 3 | [003-cdl-validator.md](003-cdl-validator.md) | 2 |
| 4 | [004-cdl-validate-api.md](004-cdl-validate-api.md) | 3 |

## Feature exit criteria

- [ ] A CDL source compiles to a normalized `ContentDefinition` JSON.
- [ ] Diagnostics carry `line, col, severity, code, message` (§14.7).
- [ ] `/cdl/validate` returns diagnostics for Monaco squiggles.

## Dependencies

`M0` modules (`sf-template` module exists). Parser is ANTLR-free (§14.7).
