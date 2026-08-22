---
id: M2.1.1
status: done
depends: []
epic: m2-templates-rendering
feature: cdl
area: backend
---

# M2.1.1 — CDL lexer

## Context

The first stage of §14.7: a dependency-free lexer producing tokens from CDL source.

## Goals

- Implement `CdlLexer` producing tokens (identifiers, keywords, strings, arrays,
  braces, numbers, `:`) with line/column tracking for diagnostics.
- Support the brace-based syntax in §14.2: `content`, `group`, `editor`, attributes,
  nested `list … item`, string and identifier literals, arrays.
- Emit lexical diagnostics (unterminated string, illegal char) with positions.

## Acceptance criteria

- [ ] Token stream for the §14.2 example is correct and position-tracked.
- [ ] Lexical errors carry line/column.

## Out of scope

- Parsing/validation (next tasks).

## Notes / hazards

- No ANTLR; keep IDEs/format tooling out of the lexer's dependencies.
