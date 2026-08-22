# Feature: OCTL engine (lexer/parser/compiler)

**Spec:** §16.1–16.4, §16.9 (grammar), §16.11 (diagnostics).
**Area:** backend. **Epic:** M2.

## Goal

Build the OCTL lexer/parser/compiler that turns template source into an immutable
`CompiledTemplate` with references resolved and diagnostics emitted.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-octl-lexer.md](001-octl-lexer.md) | — |
| 2 | [002-octl-parser.md](002-octl-parser.md) | 1 |
| 3 | [003-octl-compiler-refs.md](003-octl-compiler-refs.md) | 2 |
| 4 | [004-octl-diagnostics-api.md](004-octl-diagnostics-api.md) | 3 |

## Feature exit criteria

- [ ] `$CMS_…$` constructs parse per §16.9 EBNF; all other text passes through untouched.
- [ ] References resolve to UUIDs at compile time and are recorded in `asset_reference`.
- [ ] Diagnostics (§16.11) are returned by `/octl/validate`.

## Dependencies

`M2:cdl` (for scope awareness), `M1` (asset_reference).
