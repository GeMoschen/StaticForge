# Feature: Language (OCTL inheritance syntax + compiler)

**Spec:** Extends §16.2 (instructions), §16.9 (EBNF), §16.10 (engine), §16.11 (diagnostics).

## Goal

Teach `sf-template` the three new instructions and how to compile a template **against its ancestor
chain**. The output is a linked compiled form that the renderer (feature 3) can walk without knowing
where the sources came from.

- **`OctlLexer`**: no change expected. It already turns any `$CMS_…$` into an instruction token.
  Confirm this for `$CMS_PARENT$` (no parentheses) and `$CMS_END_BLOCK$`.
- **`OctlParser.parseInstruction`**: add the `EXTENDS`, `BLOCK` and `PARENT` cases. `BLOCK` parses a
  body via `parseSequence(Set.of("END_BLOCK"))`, the same way `parseIf`/`parseFor` do.
- **`OctlNode`** (sealed): add `Extends(accessor)`, `Block(name, body)` and `Parent`. Every
  exhaustive switch (`OctlCompiler.validate`, `OctlRenderer.renderNodes`) must handle them. The
  compiler forces this.
- **`OctlCompiler`**: a new overload that takes a `ParentTemplateLoader` SPI. The SPI loads an
  ancestor's channel source and its own `ContentDefinition` by UUID. The overload resolves the
  chain, detects cycles, enforces the depth cap, builds the block table, and returns a
  `CompiledTemplate` carrying the chain (per-ancestor node lists, block table, combined hash,
  combined references).

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-parser-ast-diagnostics.md](001-parser-ast-diagnostics.md) | — |
| 2 | [002-chain-compilation-golden.md](002-chain-compilation-golden.md) | 1; `M16.1.1` |

## Feature exit criteria

- [x] Parser and AST support the three instructions. Single-template structural diagnostics are
      emitted by `OctlCompiler.compile(...)` with no loader.
- [x] Chain compilation with a `ParentTemplateLoader` detects cycles and depth overflow, merges
      blocks, and exposes a combined hash and references.
- [x] `GoldenFileRenderTest` supports inheritance fixtures, and the new golden cases pass.

## Dependencies

`M2:octl` (lexer/parser/compiler/renderer), `M16.1.1` (cache-key contract for multi-source
compiled templates).
