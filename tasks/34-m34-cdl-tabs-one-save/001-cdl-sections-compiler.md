---
id: M34.1
status: done
depends: []
epic: m34-cdl-tabs-one-save
feature: cdl
area: backend
---

# M34.1 — CDL sections in the compiler

## Context

`sf-template` `CdlCompiler`, `CdlLexer`, `CdlParser`, `Diagnostic`. User decisions 1 and 6.

## Goals

- `CdlSources(content, bodies, rules)`: payload read/write (`contentCdl`, `bodiesCdl`, `rulesCdl`), `split(text)`
  for fixtures and tests, `text()` for search.
- `CdlCompiler.compile(CdlSources)`: each section lexed alone and wrapped in its keyword and braces; a section can't
  close itself (unmatched `}` reported and dropped, unclosed `{` reported and closed); empty bodies/rules left out.
- Positions encode their section (`section × 1 000 000 + line`); `Diagnostic` gains `field` and decodes such a line
  in its constructor, so later rule checks keep the section.

## Acceptance criteria

- [x] Sections compile to the same definition as the whole text (`CdlSourcesTest`).
- [x] Diagnostics carry `field` and a section-relative line; a stray `}` can't open another section.
- [x] `split` dedents and drops braces; payload round trip.
